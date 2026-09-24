import * as THREE from 'three/webgpu';
import { Trails } from './render/trails.js';
import { seedRandom } from './rng.js';

// Trailer director: a timed script of real gameplay with a few staged moments and
// cinematic camera shots. Everything runs on the capture clock, so it is deterministic.
export class Director {
  constructor(c) {
    this.c = c;
    this.t = 0;
    this.shot = null;
    this.drive = null;   // scripted player inputs, or null when the autopilot rides
    this.v = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.lookS = new THREE.Vector3();
    seedRandom(20260924);
    c.game.cameraHook = (dt) => this.camera(dt);

    const at = (time, fn) => ({ time, fn, done: false });
    this.cues = [
      // ---- title screen & arena picker
      at(0.0, () => { this.c.applyMap('grid'); }),
      at(1.1, () => this.pick('mesa')),
      at(2.2, () => this.pick('orbital')),
      at(3.3, () => this.pick('grid')),
      // ---- THE GRID
      at(4.1, () => {
        c.audio.uiClick();
        c.game.autopilot = true;
        c.startMatch();
      }),
      at(7.3, () => { c.bots[0].boostUntil = c.sim.time + 1.7; }),
      at(9.6, () => this.killShot()),
      at(11.9, () => this.endShot()),
      // ---- SUNDOWN MESA
      at(13.2, () => this.mesaRun()),
      at(19.8, () => this.orbitShot()),
      // ---- ORBITAL RIFT
      at(23.3, () => this.pitJump()),
      at(26.0, () => this.portalRun()),
      at(28.5, () => this.laserJump()),
      at(32.1, () => this.sudden()),
      at(33.9, () => this.overview()),
      at(37.0, () => this.endShot()),
      at(37.5, () => this.finishBot(1)),
      at(38.2, () => this.finishBot(2)),
      at(38.9, () => this.finishBot(3)),
      at(42.1, () => this.endCard()),
      at(44.1, () => this.fadeOut()),
    ];
  }

  update(t) {
    this.t = t;
    for (const q of this.cues) {
      if (!q.done && t >= q.time) { q.done = true; q.fn(); }
    }
    if (this.tick) this.tick(t);
    const p = this.c.player;
    if (this.drive && p.alive) {
      p.wantThrottle = this.drive.throttle ?? true;
      p.wantBoost = !!this.drive.boost;
      p.wantBrake = false;
      p.steer = this.drive.steer ? this.drive.steer(p) : 0;
    }
  }

  pick(id) {
    this.c.audio.uiHover();
    this.c.audio.uiClick();
    this.c.applyMap(id);
  }

  // Director drives the player (autopilot flag keeps keyboard input out, scripted keeps the bot out).
  takeWheel(drive) {
    const { game } = this.c;
    game.autopilot = true;
    game.scripted.add(0);
    this.drive = drive;
  }

  releaseWheel() {
    this.c.game.scripted.delete(0);
    this.drive = null;
  }

  // Hard cut into a fresh round on another arena, no countdown.
  cutTo(id) {
    const c = this.c;
    c.hud.flash('#ffffff', 0.85, 260);
    c.game.scripted.clear();
    this.drive = null;
    c.applyMap(id);
    c.sim.resetMatch();
    c.startRound();
    c.game.state = 'play';
    c.game.countT = 99;
    c.hud.el.count.textContent = '';
    c.hud.showKeys(false);
    c.view.rig.mode = 'chase';
    c.view.rig.snapBehind = true;
    const m = c.MAPS[id];
    c.hud.banner(m.name, 'good', m.tagline.toUpperCase());
  }

  setShot(shot) {
    this.shot = shot;
    this.lookS.set(NaN, 0, 0);
  }

  endShot() {
    this.shot = null;
    this.tick = null;
    this.c.view.rig.snapBehind = true;
  }

  camera(dt) {
    const s = this.shot;
    if (!s) return;
    const cam = this.c.view.camera;
    const t = this.t - s.t0;
    if (s.type === 'orbit') {
      const a = s.a0 + (s.a1 - s.a0) * Math.min(1, t / s.dur);
      cam.position.set(s.cx + Math.cos(a) * s.r, s.h, s.cz + Math.sin(a) * s.r);
      this.look.set(s.cx, s.ly, s.cz);
    } else {
      cam.position.copy(s.pos);
      if (s.drift) cam.position.addScaledVector(s.drift, t);
      if (s.follow && s.follow.alive) this.look.set(s.follow.x, s.follow.y + 0.8, s.follow.z);
      else this.look.copy(s.look);
    }
    if (Number.isNaN(this.lookS.x)) this.lookS.copy(this.look);
    this.lookS.lerp(this.look, 1 - Math.exp(-dt * (s.snap ?? 8)));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lookS);
    cam.fov = s.fov ?? 55;
    cam.updateProjectionMatrix();
    this.c.pipe.u.speedBlur.value = 0;
  }

  // ---- THE GRID: a rival slams into your fresh wall, seen from a drone
  killShot() {
    const { sim, player: p, game } = this.c;
    const P = Trails.pathPoint(p, p.odo - 9, { x: 0, z: 0 });
    const rx = Math.cos(p.heading), rz = Math.sin(p.heading);
    let side = 1, best = -1;
    for (const s of [1, -1]) {
      const a = Math.atan2(s * rx, -(s * rz));
      const room = sim.rayDist(null, P.x + s * rx, P.z + s * rz, a, 40);
      if (room > best) { best = room; side = s; }
    }
    const volt = sim.riders.find((r) => r.bot && r.alive);
    if (!volt) return;
    const sx = P.x + side * rx * 17, sz = P.z + side * rz * 17;
    sim.teleport(volt, sx, sz, Math.atan2(P.x - sx, -(P.z - sz)), 40);
    game.scripted.add(volt.id);
    volt.wantThrottle = true; volt.wantBoost = true; volt.steer = 0; volt.wantBrake = false;
    this.c.view.syncBike(this.c.view.bikes[volt.id], 0, true);
    const fx = p.fx, fz = p.fz;
    this.setShot({
      type: 'fixed', t0: this.t, fov: 58, snap: 30,
      pos: new THREE.Vector3(P.x - side * rx * 11 - fx * 9, 7, P.z - side * rz * 11 - fz * 9),
      look: new THREE.Vector3(P.x + side * rx * 3, 0.8, P.z + side * rz * 3),
      drift: new THREE.Vector3(fx * 1.5, 0.4, fz * 1.5),
    });
  }

  // ---- SUNDOWN MESA: up the ramp, grab the ghost, launch off the mesa
  mesaRun() {
    const { sim, player: p } = this.c;
    this.cutTo('mesa');
    sim.teleport(p, 0, 74, 0, 36);
    let jumped = false, landedAt = 0;
    this.takeWheel({
      throttle: true, boost: true,
      steer: (r) => {
        const want = r.z < -2 ? 0.34 : 0;
        return Math.max(-1, Math.min(1, (want - r.heading) * 3));
      },
    });
    this.tick = () => {
      if (!jumped && p.z < -21.5) { jumped = true; p.wantJump = true; }
      if (!this.shot && p.z < -8) {
        this.setShot({ type: 'fixed', t0: this.t, fov: 60, pos: new THREE.Vector3(30, 8, -42), follow: p, snap: 10, look: new THREE.Vector3() });
      }
      if (jumped && p.air <= 0 && !landedAt) landedAt = this.t;
      if (landedAt && this.t > landedAt + 0.9 && this.shot) { this.endShot(); this.releaseWheel(); }
    };
  }

  // Beauty shot: the camera glides around the mesa with the sun behind it.
  orbitShot() {
    this.tick = null;
    this.releaseWheel();
    this.setShot({ type: 'orbit', t0: this.t, dur: 3.5, cx: 0, cz: 0, r: 70, h: 20, ly: 4, a0: Math.PI / 2 + 0.75, a1: Math.PI / 2 - 0.35, fov: 55, snap: 50 });
  }

  // ---- ORBITAL RIFT: kicker over a void pit
  pitJump() {
    const { sim, player: p } = this.c;
    this.endShot();
    this.cutTo('orbital');
    sim.teleport(p, -9, -28, 0, 38);
    this.takeWheel({ throttle: true, boost: true, steer: (r) => Math.max(-1, Math.min(1, (0 - r.heading) * 4)) });
    this.setShot({ type: 'fixed', t0: this.t, fov: 44, pos: new THREE.Vector3(-38, 8, -70), follow: p, snap: 12, look: new THREE.Vector3() });
    this.tick = () => {
      if (p.z < -92 && this.drive) this.releaseWheel();
    };
  }

  // Straight into a portal; the camera cuts with the warp.
  portalRun() {
    const { sim, player: p, view } = this.c;
    this.endShot();
    const x = -95, z = -95;
    sim.teleport(p, x, z, Math.atan2(-112 - x, -(-112 - z)), 32);
    view.syncBike(view.bikes[0], 0, true);
    view.rig.snapBehind = true;
    this.takeWheel({ throttle: true, boost: false, steer: () => 0 });
    this.tick = () => {
      if (p.portalT > 0 && p.portalT < 0.5 && this.drive) this.releaseWheel();
    };
  }

  // Hop the reactor laser: time the jump to the arm's sweep, filmed from outside the sweep circle.
  laserJump() {
    const { sim, player: p, view } = this.c;
    this.endShot();
    const sw = sim.sweepers[0];
    const T = 1.45, R = 24, v = 26;
    const qa = sw.angles[0] + sw.speed * T;
    const qx = Math.cos(qa) * R, qz = Math.sin(qa) * R;
    const dx = Math.sin(qa), dz = -Math.cos(qa); // tangent, moving toward decreasing angle (into the arm)
    const sx = qx - dx * v * T, sz = qz - dz * v * T;
    sim.teleport(p, sx, sz, Math.atan2(dx, -dz), v);
    view.syncBike(view.bikes[0], 0, true);
    this.takeWheel({ throttle: true, boost: false, steer: () => 0 });
    const t0 = this.t;
    let jumped = false;
    this.tick = () => {
      if (!jumped && this.t >= t0 + T - 0.42) { jumped = true; p.wantJump = true; }
      if (this.t > t0 + T + 1.0 && this.drive) this.releaseWheel();
    };
    const ca = qa + 0.36, cr = 48;
    this.setShot({
      type: 'fixed', t0: this.t, fov: 36, snap: 14,
      pos: new THREE.Vector3(Math.cos(ca) * cr, 3.2, Math.sin(ca) * cr), follow: p, look: new THREE.Vector3(),
    });
  }

  sudden() {
    const { sim } = this.c;
    this.endShot();
    sim.suddenAt = sim.time;
    sim.shrinkRate = 7;
  }

  // High reveal of the whole station while the barrier closes in.
  overview() {
    this.setShot({ type: 'orbit', t0: this.t, dur: 3.1, cx: 0, cz: 0, r: 150, h: 105, ly: -10, a0: 0.9, a1: 1.35, fov: 50, snap: 50 });
  }

  finishBot(id) {
    const { sim } = this.c;
    const r = sim.riders[id];
    if (r.alive && !sim.over) sim.crash(r, null, 'boundary');
  }

  endCard() {
    this.c.hud.hideResults();
    const el = document.createElement('div');
    el.id = 'endcard';
    el.innerHTML = `<div class="ec-logo">LIGHTWAKE</div><div class="ec-sub">3 ARENAS · 3 RIVAL BOTS · KEYBOARD &amp; TOUCH</div><div class="ec-cta">PLAY FREE IN YOUR BROWSER</div>`;
    const css = document.createElement('style');
    css.textContent = `
      #endcard { position: fixed; inset: 0; z-index: 50; display: grid; place-content: center; justify-items: center; gap: 18px;
        background: radial-gradient(ellipse at center, rgba(2,4,10,0.55), rgba(2,4,10,0.92)); animation: ecIn 0.9s ease forwards; opacity: 0; }
      #endcard .ec-logo { font: 900 120px/1 'Orbitron', sans-serif; letter-spacing: 0.12em; padding-left: 0.12em; color: transparent;
        background: linear-gradient(180deg, #fff 0%, #bff8ff 45%, #22e8ff 55%, #0a6f9a 100%); -webkit-background-clip: text; background-clip: text;
        filter: drop-shadow(0 0 30px rgba(34,232,255,0.6)); }
      #endcard .ec-sub { font: 700 22px/1 'Orbitron', sans-serif; letter-spacing: 0.4em; color: #9fdcf0; }
      #endcard .ec-cta { margin-top: 18px; font: 700 20px/1 'Rajdhani', sans-serif; letter-spacing: 0.5em; color: #fff; padding: 14px 26px;
        border: 1px solid rgba(143,246,255,0.6); box-shadow: 0 0 30px rgba(34,232,255,0.3) inset; }
      @keyframes ecIn { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: none; } }`;
    document.head.appendChild(css);
    document.body.appendChild(el);
  }

  fadeOut() {
    const a = this.c.audio;
    a.master.gain.setTargetAtTime(0.0001, a.now(), 0.28);
  }
}
