import * as THREE from 'three/webgpu';
import { World } from './world.js';
import { createBike } from './bike.js';
import { Trails, TAIL } from './trails.js';
import { Sparks, Debris } from './particles.js';
import { CameraRig } from './cameraRig.js';
import { BASE_SPEED, BOOST_MULT } from '../config.js';
import { Terrain, VOID } from '../terrain.js';
import { vrand } from '../rng.js';

const WHITE = new THREE.Color(1, 1, 1);
const DANGER = new THREE.Color(0xff2a44);
const PICKUP_COLORS = { boost: 0x3df0ff, jump: 0x9dff4a, ghost: 0xc77dff };

// Everything visual: syncs the simulation into bikes, walls, VFX and camera each frame.
export class View {
  constructor(sim, maps) {
    this.sim = sim;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.world = new World(this.scene);
    for (const m of maps) this.world.build(m, new Terrain(m));
    this.trails = new Trails(this.scene, this.world.reflect, sim.riders);
    this.sparks = new Sparks(this.scene);
    this.debris = new Debris(this.scene);
    this.rig = new CameraRig(this.camera);
    this.rig.groundAt = (x, z) => {
      const h = this.sim.terrain.height(x, z);
      return h === VOID ? -40 : h;
    };
    this.tmp = { x: 0, z: 0 };
    this.target = null;

    this.bikes = sim.riders.map((r) => {
      const b = createBike(r.color);
      this.scene.add(b.root);
      const mirror = b.root.clone();
      mirror.children.forEach((c) => { if (c !== mirror.children[0]) c.visible = false; }); // no glow decal in the mirror
      this.world.reflect.add(mirror);
      const mLean = mirror.children[0];
      const mWheels = b.wheels.map((w) => mLean.children[b.lean.children.indexOf(w)]);
      const mExhaust = mLean.children[b.lean.children.indexOf(b.exhaust)];
      return {
        ...b, rider: r, mirror, mLean, mWheels, mExhaust,
        yaw: 0, roll: 0, pitch: 0, boostK: 0, wheelA: 0, flash: 0, land: 0, visible: true,
        grindColor: new THREE.Color(r.color).lerp(WHITE, 0.55).multiplyScalar(2.4),
        exhaustColor: new THREE.Color(r.color).multiplyScalar(2.2),
        carveColor: new THREE.Color(r.color).lerp(WHITE, 0.3).multiplyScalar(1.8),
        emitA: {}, emitB: {}, emitC: {},
      };
    });
  }

  setMap(map) {
    this.world.setMap(map);
    this.trails.setMirror(!!map.mirror);
    this.rig.orbitR = map.half * 1.3;
    this.rig.orbitH = map.half * 0.5;
  }

  resetRound() {
    for (const b of this.bikes) {
      b.visible = true;
      b.root.visible = true;
      b.roll = b.pitch = b.boostK = b.flash = b.land = 0;
      this.syncBike(b, 0, true);
    }
    this.world.setBarrier(this.sim.map.half);
  }

  // Where the bike is and which way it faces, derived from the ridden path so the tail
  // swings through corners exactly along the wall it lays.
  bikePose(r, out) {
    const p = this.tmp;
    if (r.odo - r.pathStart < TAIL) {
      // just rolled off the start line (or out of a portal): nothing ridden behind us yet
      p.x = r.x - r.fx * TAIL;
      p.z = r.z - r.fz * TAIL;
    } else {
      Trails.pathPoint(r, r.odo - TAIL, p);
      const dx = r.x - p.x, dz = r.z - p.z;
      if (dx * dx + dz * dz < 0.25) { p.x = r.x - r.fx * TAIL; p.z = r.z - r.fz * TAIL; }
    }
    out.yaw = Math.atan2(-(r.x - p.x), -(r.z - p.z));
    out.tx = p.x;
    out.tz = p.z;
    return out;
  }

  syncBike(b, dt, snap = false) {
    const r = b.rider;
    const pose = this.bikePose(r, this._pose || (this._pose = {}));
    let dy = pose.yaw - b.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    b.yaw = snap ? pose.yaw : b.yaw + dy;
    const yawRate = dt > 0 ? dy / dt : 0;

    const k = 1 - Math.exp(-dt * 10);
    b.roll += (THREE.MathUtils.clamp(-yawRate * 0.06, -0.45, 0.45) - b.roll) * (snap ? 1 : k);
    b.boostK += ((r.boosting ? 1 : 0) - b.boostK) * (1 - Math.exp(-dt * 8));
    // pitch follows the ground under both wheels; in the air, the flight path
    let pitchT;
    if (r.air > 0) {
      pitchT = THREE.MathUtils.clamp(Math.atan2(r.vy, Math.max(8, r.speed)) * 0.8, -0.55, 0.55);
    } else {
      let tailY = this.sim.terrain.height(pose.tx, pose.tz);
      if (tailY === VOID) tailY = r.y;
      pitchT = THREE.MathUtils.clamp(Math.atan2(r.y - tailY, TAIL), -0.6, 0.6);
    }
    b.pitch += (pitchT - b.boostK * 0.04 - b.pitch) * (snap ? 1 : 1 - Math.exp(-dt * 14));
    b.land = Math.max(0, b.land - dt * 5);
    b.flash = Math.max(0, b.flash - dt * 3);

    b.root.position.set(r.x, r.y, r.z);
    b.root.rotation.y = b.yaw;
    b.lean.rotation.set(b.pitch, 0, b.roll);
    const squash = 1 - b.land * 0.12;
    b.lean.scale.set(1 + b.land * 0.06, squash, 1);
    b.wheelA -= (r.speed * dt) / 0.5;
    for (const w of b.wheels) w.rotation.x = b.wheelA;
    b.u.wheel.value = -b.wheelA;
    b.u.boost.value = b.boostK;
    // ghosting: the bike flickers white-hot so everyone can see it's phased
    const ghost = r.ghostT > 0 ? 0.35 + 0.35 * Math.sin(this.sim.time * 32) + (r.ghostT < 1 ? 0.3 * Math.sin(this.sim.time * 60) : 0) : 0;
    b.u.flash.value = Math.max(b.flash, ghost);
    b.u.grind.value = r.grind;
    b.u.brake.value = r.wantBrake && !r.boosting ? 1 : 0;
    b.exhaust.visible = b.boostK > 0.02;
    b.exhaust.scale.set(1 + b.boostK * 0.3, 1 + b.boostK * 0.3, 0.3 + b.boostK * 1.1 + Math.sin(this.sim.time * 60) * 0.06);

    // mirror (only drawn on the Grid's reflective floor)
    b.mirror.visible = b.root.visible && !!this.sim.map.mirror;
    b.mirror.position.copy(b.root.position);
    b.mirror.rotation.copy(b.root.rotation);
    b.mLean.rotation.copy(b.lean.rotation);
    b.mLean.scale.copy(b.lean.scale);
    for (const w of b.mWheels) w.rotation.x = b.wheelA;
    b.mExhaust.visible = b.exhaust.visible;
    b.mExhaust.scale.copy(b.exhaust.scale);
  }

  burst(x, y, z, hex, count, speed, life = 0.6, size = 0.18, spread = 1, dy = 1) {
    this.sparks.emit({ x, y, z, dx: 0, dy, dz: 0, count, speed, spread, life, size, gravity: 0.8, color: new THREE.Color(hex).multiplyScalar(2.3) });
  }

  handle(e, focusRider) {
    const r = e.rider;
    const b = r ? this.bikes[r.id] : null;
    const col = r ? new THREE.Color(r.color) : WHITE;
    const me = r && r === focusRider;
    switch (e.type) {
      case 'crash': {
        b.visible = false;
        b.root.visible = false;
        b.mirror.visible = false;
        const x = e.x, y = e.y, z = e.z;
        this.debris.burst(x, y, z, r.color, 54, 1);
        this.sparks.emit({ x, y: y + 0.6, z, count: 800, speed: 19, spread: 1, life: 1.3, size: 0.28, gravity: 0.6, color: col.clone().multiplyScalar(2.2) });
        this.sparks.emit({ x, y: y + 0.6, z, count: 140, speed: 9, spread: 1, life: 0.7, size: 0.34, gravity: 0.2, color: new THREE.Color(2.2, 2.2, 2.2) });
        this.sparks.emit({ x, y: y + 0.2, z, dx: 0, dy: 1, dz: 0, count: 200, speed: 30, spread: 0.18, life: 1.0, size: 0.28, gravity: 0.5, color: col.clone().multiplyScalar(2.6) });
        if (e.cause !== 'void') {
          this.debris.ring(x, z, r.color, 18, 0.7, y + 0.05);
          this.debris.ring(x, z, 0xffffff, 9, 0.35, y + 0.05);
        }
        if (focusRider) {
          const d = Math.hypot(x - focusRider.x, z - focusRider.z);
          this.rig.addTrauma(me ? 0.85 : Math.max(0, 0.6 - d / 60));
          if (me) this.rig.punch(8);
        }
        break;
      }
      case 'jump':
        this.debris.ring(r.x, r.z, r.color, 4, 0.35, r.y - 0.2);
        this.sparks.emit({ x: r.x, y: r.y, z: r.z, dx: 0, dy: -1, dz: 0, count: 80, speed: 9, spread: 0.9, life: 0.5, size: 0.16, color: col.clone().multiplyScalar(2) });
        if (me) this.rig.punch(4);
        break;
      case 'land':
        b.land = Math.min(1, 0.4 + e.air);
        this.debris.ring(r.x, r.z, r.color, 5 + e.air * 6, 0.45, r.y + 0.05);
        this.sparks.emit({ x: r.x, y: r.y + 0.1, z: r.z, dx: 0, dy: 1, dz: 0, count: 50 + e.air * 80, speed: 8, spread: 1, life: 0.45, size: 0.14, gravity: 1.4, color: col.clone().multiplyScalar(2) });
        if (me) this.rig.addTrauma(Math.min(0.5, 0.12 + e.air * 0.3));
        break;
      case 'jumpReady':
        b.flash = 1;
        break;
      case 'boost':
        if (me) this.rig.punch(5);
        break;
      case 'pad':
        this.burst(r.x, r.y + 0.3, r.z, 0xffd070, 70, 10, 0.45, 0.16, 0.7);
        if (me) { this.rig.punch(9); this.rig.addTrauma(0.15); }
        break;
      case 'portal': {
        const c = new THREE.Color(e.color);
        for (const [x, z] of [e.from, e.to]) {
          const y = this.sim.terrain.height(x, z);
          this.debris.ring(x, z, e.color, 9, 0.5, y + 0.1);
          this.sparks.emit({ x, y: y + 1, z, dx: 0, dy: 1, dz: 0, count: 160, speed: 12, spread: 0.6, life: 0.7, size: 0.2, gravity: -0.2, color: c.clone().multiplyScalar(2.5) });
        }
        if (me) { this.rig.punch(12); this.rig.snapBehind = true; }
        break;
      }
      case 'pickup': {
        const p = e.pickup;
        const hex = PICKUP_COLORS[p.type];
        this.burst(p.x, p.y, p.z, hex, 150, 11, 0.7, 0.2, 1, 0.5);
        this.debris.ring(p.x, p.z, hex, 7, 0.4, p.y - 1.2);
        b.flash = 1;
        if (me) this.rig.punch(5);
        break;
      }
      case 'pickupSpawn': {
        const p = e.pickup;
        this.debris.ring(p.x, p.z, PICKUP_COLORS[p.type], 5, 0.5, p.y - 1.2);
        break;
      }
      case 'nearMiss':
        this.burst(r.x, r.y + 0.6, r.z, 0xffffff, 30, 7, 0.3, 0.1, 1);
        break;
      default:
    }
  }

  update(dt, realDt, focusRider, post) {
    const sim = this.sim;
    for (const b of this.bikes) if (b.visible) this.syncBike(b, dt);
    this.trails.update();

    // continuous effects: grind sparks, carve sparks, boost exhaust
    for (const b of this.bikes) {
      const r = b.rider;
      if (!r.alive || dt <= 0) continue;
      const fx = r.fx, fz = r.fz, rx = -fz, rz = fx;
      if (r.grind > 0.06) {
        const n = Math.min(60, r.grind * 520 * dt + vrand());
        const side = r.grindSide;
        const off = Math.min(0.35, (r.grindDist || 1) * 0.5);
        const o = b.emitA;
        o.x = r.x - fx * 2.3 + rx * side * off; o.y = r.y + 0.25; o.z = r.z - fz * 2.3 + rz * side * off;
        o.dx = -fx * 0.8 + rx * side * 0.5; o.dy = 0.7; o.dz = -fz * 0.8 + rz * side * 0.5;
        o.count = n; o.speed = 13; o.spread = 0.35; o.life = 0.42; o.size = 0.11; o.gravity = 1.2; o.color = b.grindColor;
        this.sparks.emit(o);
      }
      const carve = Math.abs(r.turn) * Math.min(1, r.speed / 26);
      if (carve > 0.55 && r.air <= 0 && r.speed > 12) {
        const n = Math.min(12, carve * 110 * dt + vrand());
        const out = -Math.sign(r.turn);
        const o = b.emitC;
        o.x = r.x - fx * 2.45 + rx * out * 0.2; o.y = r.y + 0.08; o.z = r.z - fz * 2.45 + rz * out * 0.2;
        o.dx = -fx * 0.5 + rx * out; o.dy = 0.35; o.dz = -fz * 0.5 + rz * out;
        o.count = n; o.speed = 8; o.spread = 0.4; o.life = 0.3; o.size = 0.09; o.gravity = 1.4; o.color = b.carveColor;
        this.sparks.emit(o);
      }
      if (r.boosting || r.speed > BASE_SPEED * BOOST_MULT + 1) {
        const n = Math.min(20, 90 * dt + vrand());
        const o = b.emitB;
        o.x = r.x - fx * 3.1; o.y = 0.5 + r.y; o.z = r.z - fz * 3.1; o.dx = -fx; o.dy = 0.1; o.dz = -fz;
        o.count = n; o.speed = 9; o.spread = 0.25; o.life = 0.35; o.size = 0.14; o.gravity = 0; o.color = b.exhaustColor;
        this.sparks.emit(o);
      }
    }

    // world uniforms
    const w = this.world;
    w.setBarrier(sim.half);
    const pools = w.u.pools.array, pc = w.u.poolColors.array;
    sim.riders.forEach((r, i) => {
      const b = this.bikes[i];
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      const ground = r.air > 0 ? sim.terrain.height(r.x, r.z) : r.y;
      const lift = Math.max(0, r.y - (ground === VOID ? r.y : ground));
      pools[i].set(r.x - fx * 1.5, r.z - fz * 1.5, r.alive ? (0.55 + b.boostK * 0.5) * Math.max(0, 1 - lift / 4) : 0, r.y - lift);
      pc[i].setHex(r.color);
    });
    const dz = sim.sudden ? 1 : 0;
    w.u.danger.value += (dz - w.u.danger.value) * (1 - Math.exp(-realDt * 3));
    w.u.barrierColor.value.copy(w.calm).lerp(DANGER, w.u.danger.value);
    if (focusRider) w.u.player.value.set(focusRider.x, focusRider.z);
    w.update(realDt, performance.now() / 1000, sim);

    this.sparks.update(post.renderer, dt);
    this.debris.update(dt);

    // camera
    let target = null;
    if (focusRider) {
      const b = this.bikes[focusRider.id];
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      const g = sim.terrain.height(focusRider.x, focusRider.z);
      target = {
        x: focusRider.x, y: focusRider.y, z: focusRider.z, yaw: b.yaw, gy: g === VOID ? focusRider.y : Math.min(g, focusRider.y),
        speedK: Math.max(0, Math.min(1.3, (focusRider.speed - BASE_SPEED) / (BASE_SPEED * (BOOST_MULT - 1)))),
        vx: fx * focusRider.speed, vz: fz * focusRider.speed,
      };
    }
    this.rig.update(realDt, target);
    this.target = target;

    // post uniforms
    const u = post.u;
    const sk = target ? target.speedK : 0;
    u.speedBlur.value += (sk - u.speedBlur.value) * (1 - Math.exp(-realDt * 6));
    u.aberration.value = Math.max(0, u.aberration.value - realDt * 1.6);
    u.flash.value = Math.max(0, u.flash.value - realDt * 3.5);
    u.danger.value = w.u.danger.value * 0.8;
  }
}
