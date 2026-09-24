import * as C from './config.js';
import { Grid } from './grid.js';
import { SegIndex, sweepHit, rayHit, distSq } from './spatial.js';
import { Terrain, VOID, inRect } from './terrain.js';
import { MAPS } from './maps.js';
import { rand } from './rng.js';

// A straight piece of light wall standing on the terrain. The rider's current piece grows
// from its anchor to the bike; once the heading (or the ground's slope) drifts enough it is
// committed and a new piece starts, so curves and hills become chains of short straight walls.
class Wall {
  constructor(owner, x, z) {
    this.owner = owner;
    this.ax = x; this.az = z; this.ay = owner.y;
    this.bx = x; this.bz = z; this.by = owner.y;
    this.slope = owner.speed > 1 ? owner.vy / owner.speed : 0; // rise per metre along the wall
    this.s0 = owner.odo;             // odometer reading where the wall starts / ends
    this.s1 = owner.odo;
    this.index = owner.walls.length; // instance slot for the renderer
    this.dirty = true;
    this.seen = 0;
  }
}

class Rider {
  constructor(id, def) {
    this.id = id;
    this.name = def.name;
    this.color = def.color;
    this.css = def.css;
    this.bot = def.bot;
    this.persona = def.persona || null;
    this.score = 0;
    this.roundsWon = 0;
    this.totalKills = 0;
    this.walls = [];
    this.reset(0, 0, 0, 0);
  }

  reset(x, z, heading, y) {
    this.alive = true;
    this.x = x; this.z = z; this.y = y; this.vy = 0;
    this.heading = heading;
    this.fx = Math.sin(heading); this.fz = -Math.cos(heading);
    this.speed = 0;
    this.steer = 0;          // input: -1 full left .. +1 full right
    this.turn = 0;           // smoothed steering actually applied
    this.boost = 1;
    this.jump = 1;           // 1 = ready
    this.air = 0;            // 1 while airborne
    this.airT = 0;           // how long this flight has lasted
    this.wantThrottle = false;
    this.wantBrake = false;
    this.wantBoost = false;
    this.wantJump = false;
    this.boosting = false;
    this.walls = [];
    this.cur = null;
    this.grind = 0;
    this.grindSide = 0;
    this.grindDist = 0;
    this.stillT = 0;
    this.ghostT = 0;
    this.padT = 0;
    this.portalT = 0;
    this.nearT = 0;
    this.onRamp = false;
    this.deathTime = -1;
    this.derez = 0;
    this.killer = null;
    this.cause = '';
    this.roundKills = 0;
    this.halted = false;
    this.odo = 0;                  // total distance ridden this round
    this.path = [{ x, z, s: 0 }];  // corners of the ridden path, for the renderer's tail-follow
    this.pathStart = 0;            // odometer at the start of the current path (portals restart it)
    this.pathHeading = heading;
    this.gx = x; this.gz = z;      // last point rasterised into the bot grid
  }
}

export class Sim {
  constructor(map = MAPS.grid) {
    this.riders = C.RIDERS.map((d, i) => new Rider(i, d));
    this.walls = [];
    this.events = [];
    this.round = 0;
    this.time = 0;
    this.over = false;
    this.overTime = 0;
    this.winner = null;
    this.matchWinner = null;
    this.rebuild = false;
    this.playerIndex = 0;
    this.setMap(map);
  }

  setMap(map) {
    this.map = map;
    this.terrain = new Terrain(map);
    this.index = new SegIndex(map.half + 6, 4);
    this.hazIndex = new SegIndex(map.half + 6, 4);
    for (const h of this.terrain.hazards) this.hazIndex.insert(h);
    this.grid = new Grid(map.half, 2);
    this.grid.setStatic((x, z) => {
      const h = this.terrain.height(x, z);
      return h === VOID || h > 10;
    });
    this.pickups = map.pickups.map((p) => ({ ...p, y: this.terrain.height(p.x, p.z) + 1.3, active: true, t: 0 }));
    this.portals = map.portals;
    this.sweepers = map.sweepers.map((s) => ({ ...s, angles: new Array(s.arms).fill(0) }));
    this.half = map.half;
    this.updateSweepers();
  }

  resetMatch() {
    for (const r of this.riders) { r.score = 0; r.roundsWon = 0; r.totalKills = 0; }
    this.round = 0;
    this.matchWinner = null;
  }

  startRound() {
    const m = this.map;
    this.round++;
    this.time = 0;
    this.half = m.half;
    this.sudden = false;
    this.suddenAt = m.suddenAt;
    this.shrinkRate = m.shrinkRate;
    this.over = false;
    this.overTime = 0;
    this.winner = null;
    this.walls = [];
    this.index.clear();
    this.grid.clear();
    this.events.length = 0;
    for (const p of this.pickups) { p.active = true; p.t = 0; }
    this.updateSweepers();

    // Pinwheel spawn: everyone starts on a ring facing counter-clockwise, standing still.
    const rot = Math.floor(rand() * 4);
    this.riders.forEach((r, i) => {
      const a = m.spawnA0 + ((i + rot) % 4) * (Math.PI / 2);
      const x = Math.cos(a) * m.spawnR, z = Math.sin(a) * m.spawnR;
      r.reset(x, z, a, this.terrain.height(x, z));
      this.startWall(r);
    });
  }

  startWall(r) {
    const w = new Wall(r, r.x, r.z);
    r.walls.push(w);
    this.walls.push(w);
    r.cur = w;
  }

  endWall(r) {
    const w = r.cur;
    if (!w) return;
    w.bx = r.x; w.bz = r.z; w.by = r.y;
    w.s1 = r.odo;
    w.dirty = true;
    this.grid.markLine(r.gx, r.gz, w.bx, w.bz);
    r.gx = r.x; r.gz = r.z;
    if (w.s1 - w.s0 > 1e-4) this.index.insert(w);
    r.cur = null;
  }

  emit(e) { this.events.push(e); }

  // Move a rider instantly (used by the trailer director): ends its wall here, starts fresh there.
  teleport(r, x, z, heading, speed = r.speed) {
    this.endWall(r);
    r.x = x; r.z = z;
    r.y = Math.max(0, this.terrain.height(x, z));
    r.vy = 0; r.air = 0; r.airT = 0;
    r.heading = heading;
    r.fx = Math.sin(heading); r.fz = -Math.cos(heading);
    r.speed = speed;
    r.turn = 0;
    r.path = [{ x, z, s: r.odo }];
    r.pathStart = r.odo;
    r.pathHeading = heading;
    r.gx = x; r.gz = z;
    r.stillT = 0;
    this.startWall(r);
  }

  alive() {
    let n = 0;
    for (const r of this.riders) if (r.alive) n++;
    return n;
  }

  updateSweepers() {
    for (const s of this.sweepers) {
      for (let k = 0; k < s.arms; k++) s.angles[k] = s.phase + s.speed * this.time + (k * 2 * Math.PI) / s.arms;
    }
  }

  // Distance from (x, z) along heading `a` until the ray meets something that would stop you:
  // light walls, terrain cliffs you'd ride into, pit rims, the arena edge. With `forAI`, the
  // stretch just ahead of every other bike and the reactor lasers count as walls too.
  rayDist(self, x, z, a, maxD, forAI = false) {
    const dx = Math.sin(a), dz = -Math.cos(a);
    const h = this.half;
    let best = maxD;
    if (dx > 1e-6) best = Math.min(best, (h - x) / dx);
    else if (dx < -1e-6) best = Math.min(best, (-h - x) / dx);
    if (dz > 1e-6) best = Math.min(best, (h - z) / dz);
    else if (dz < -1e-6) best = Math.min(best, (-h - z) / dz);
    if (best < 0) best = 0;
    const skip = self ? self.odo - C.OWN_SKIP : 0;
    const pad = 0.3;
    this.index.along(x, z, dx, dz, best, (w) => {
      if (w.owner === self && w.s1 > skip) return;
      const t = rayHit(x, z, dx, dz, w.ax, w.az, w.bx, w.bz, pad);
      if (t >= 0 && t < best) best = t;
    });
    // terrain: one-way cliffs block only when riding into the high side; pits block unless you're launching
    const launching = self && (self.air > 0 || (self.onRamp && self.speed > 18));
    this.hazIndex.along(x, z, dx, dz, best, (s) => {
      if (s.kind === 'pit' && launching) return;
      if ((s.nx || s.nz) && dx * s.nx + dz * s.nz <= 0) return;
      const t = rayHit(x, z, dx, dz, s.ax, s.az, s.bx, s.bz, 0.5);
      if (t >= 0 && t < best) best = t;
    });
    for (const o of this.riders) {
      const w = o.cur;
      if (w && o !== self) {
        const t = rayHit(x, z, dx, dz, w.ax, w.az, o.x, o.z, pad);
        if (t >= 0 && t < best) best = t;
      }
      if (forAI && o !== self && o.alive && o.air <= 0) {
        const ahead = Math.max(3, o.speed * 0.5);
        const t = rayHit(x, z, dx, dz, o.x, o.z, o.x + o.fx * ahead, o.z + o.fz * ahead, 1.1);
        if (t >= 0 && t < best) best = t;
      }
    }
    if (forAI && (!self || self.air <= 0)) {
      for (const s of this.sweepers) {
        for (let k = 0; k < s.arms; k++) {
          for (const lead of [0, 0.5]) {
            const ang = s.angles[k] + s.speed * lead;
            const c = Math.cos(ang), sn = Math.sin(ang);
            const t = rayHit(x, z, dx, dz, s.x + c * s.inner, s.z + sn * s.inner, s.x + c * s.len, s.z + sn * s.len, 1.2);
            if (t >= 0 && t < best) best = t;
          }
        }
      }
    }
    return best;
  }

  step(h) {
    this.time += h;
    if (this.over) this.overTime += h;
    this.updateSweepers();

    if (!this.over) {
      if (!this.sudden && this.time >= this.suddenAt) {
        this.sudden = true;
        this.emit({ type: 'sudden' });
      }
      if (this.sudden) this.half = Math.max(this.map.minHalf, this.half - this.shrinkRate * h);
    }

    for (const p of this.pickups) {
      if (!p.active && (p.t -= h) <= 0) { p.active = true; this.emit({ type: 'pickupSpawn', pickup: p }); }
    }

    for (const r of this.riders) if (r.alive) this.moveRider(r, h);

    // bike-to-bike collisions
    const rs = this.riders;
    for (let i = 0; i < rs.length && !this.over; i++) {
      const a = rs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < rs.length; j++) {
        const b = rs[j];
        if (!b.alive) continue;
        if (Math.abs(a.y - b.y) > 1.1) continue;
        const ddx = a.x - b.x, ddz = a.z - b.z;
        if (ddx * ddx + ddz * ddz < C.BIKE_HIT_RADIUS * C.BIKE_HIT_RADIUS) {
          this.crash(a, b, 'collide');
          this.crash(b, a, 'collide');
        }
      }
    }

    // dissolve the walls of fallen riders
    for (const r of rs) {
      if (r.alive || r.derez >= 1) continue;
      r.derez = Math.min(1, r.derez + h / C.DEREZ_TIME);
      if (r.derez >= 1) {
        this.walls = this.walls.filter((w) => w.owner !== r);
        this.rebuild = true;
      }
    }
    if (this.rebuild) {
      this.rebuild = false;
      this.index.clear();
      this.grid.clear();
      for (const w of this.walls) {
        const growing = w.owner.cur === w;
        if (!growing && w.s1 - w.s0 > 1e-4) this.index.insert(w);
        this.grid.markLine(w.ax, w.az, growing ? w.owner.x : w.bx, growing ? w.owner.z : w.bz);
      }
    }

    if (!this.over && this.alive() <= 1) this.finishRound();
  }

  moveRider(r, h) {
    if (r.halted) return;
    const T = this.terrain;

    // steering: smoothed toward the input, weaker at crawling speed (no spinning on the spot) and in the air
    r.turn += (r.steer - r.turn) * Math.min(1, C.STEER_RESPONSE * h);
    const lock = Math.min(1, r.speed / C.TURN_FULL_SPEED) * (r.boosting ? 0.85 : 1) * (r.air > 0 ? 0.55 : 1);
    r.heading += r.turn * C.TURN_RATE * lock * h;
    r.fx = Math.sin(r.heading); r.fz = -Math.cos(r.heading);

    // throttle / brake / boost (pads can push you past boost speed; that bleeds off)
    const canBoost = r.wantBoost && r.boost > 0.02 && !r.wantBrake;
    if (canBoost && !r.boosting) this.emit({ type: 'boost', rider: r });
    r.boosting = canBoost;
    const cruise = C.BASE_SPEED, top = C.BASE_SPEED * C.BOOST_MULT;
    if (r.wantBrake && r.air <= 0) r.speed = Math.max(0, r.speed - C.BRAKE_DECEL * h);
    else if (r.boosting) r.speed = r.speed < top ? Math.min(top, r.speed + C.BOOST_ACCEL * h) : Math.max(top, r.speed - 10 * h);
    else if (r.wantThrottle) r.speed = r.speed < cruise ? Math.min(cruise, r.speed + C.ACCEL * h) : Math.max(cruise, r.speed - 10 * h);
    else if (r.air <= 0) r.speed = Math.max(0, r.speed - (r.speed > cruise ? 10 : C.COAST_DRAG) * h);
    if (r.boosting) r.boost = Math.max(0, r.boost - C.BOOST_DRAIN * h);

    // timers
    if (r.ghostT > 0) r.ghostT = Math.max(0, r.ghostT - h);
    if (r.padT > 0) r.padT -= h;
    if (r.portalT > 0) r.portalT -= h;
    if (r.nearT > 0) r.nearT -= h;

    // jump
    if (r.wantJump) {
      r.wantJump = false;
      if (r.jump >= 1 && r.air <= 0 && r.speed > 3) {
        this.takeOff(r, Math.max(r.vy, 0) + C.JUMP_V);
        r.jump = 0;
        this.emit({ type: 'jump', rider: r });
      }
    }
    if (r.jump < 1) {
      r.jump = Math.min(1, r.jump + h / C.JUMP_RECHARGE);
      if (r.jump >= 1) this.emit({ type: 'jumpReady', rider: r });
    }

    // classic rule: stand still too long and you derez
    if (r.speed < C.IDLE_SPEED && r.air <= 0 && !this.over) {
      r.stillT += h;
      if (r.stillT >= C.IDLE_LIMIT) { this.crash(r, null, 'idle'); return; }
    } else {
      r.stillT = 0;
    }

    // a new trail corner whenever the heading (or the slope under the wall) has drifted enough
    const w0 = r.cur;
    const bent = w0 && Math.abs(r.y - (w0.ay + w0.slope * (r.odo - w0.s0))) > 0.12;
    if (bent || Math.abs(angleDiff(r.heading, r.pathHeading)) > C.COMMIT_ANGLE) {
      r.path.push({ x: r.x, z: r.z, s: r.odo });
      r.pathHeading = r.heading;
      if (r.cur && r.odo - r.cur.s0 > 1e-3) {
        this.endWall(r);
        this.startWall(r);
      }
    }

    const hf = this.half;
    if (Math.abs(r.x) > hf || Math.abs(r.z) > hf) {
      if (this.over) r.halted = true;
      else this.crash(r, null, 'boundary');
      return;
    }

    const dist = r.speed * h;
    const px = r.x, pz = r.z;
    const qx = px + r.fx * dist, qz = pz + r.fz * dist;
    let hitT = 2, hitOwner = null, hitBoundary = false;

    if (dist > 0) {
      // arena edge
      const edgeT = (p, q) => (Math.abs(q) > hf ? (Math.sign(q) * hf - p) / (q - p) : 2);
      const bt = Math.min(edgeT(px, qx), edgeT(pz, qz));
      if (bt <= 1) { hitT = Math.max(0, bt); hitBoundary = true; }

      if (r.ghostT <= 0) {
        const pad = C.HIT_PAD;
        const skip = r.odo - C.OWN_SKIP;
        const test = (owner, ax, az, ay, bx, bz, by) => {
          if (distSq(px, pz, ax, az, bx, bz) < pad * pad) return; // already touching (e.g. landed on it): ignore
          const t = sweepHit(px, pz, qx, qz, ax, az, bx, bz, pad);
          if (t < 0 || t >= hitT) return;
          if (r.air > 0) {
            // airborne: only a hit if we're lower than the wall's top where we cross it
            const hx = px + (qx - px) * t, hz = pz + (qz - pz) * t;
            const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
            const u = L2 > 1e-9 ? Math.min(1, Math.max(0, ((hx - ax) * vx + (hz - az) * vz) / L2)) : 0;
            const base = ay + (by - ay) * u;
            if (r.y > base + C.WALL_HEIGHT - 0.1 || r.y < base - 1.5) return;
          }
          hitT = t; hitOwner = owner; hitBoundary = false;
        };
        this.index.near(qx, qz, 1, (w) => {
          if (w.owner === r && w.s1 > skip) return;
          test(w.owner, w.ax, w.az, w.ay, w.bx, w.bz, w.by);
        });
        for (const o of this.riders) {
          if (o === r || !o.cur) continue;
          test(o, o.cur.ax, o.cur.az, o.cur.ay, o.x, o.z, o.y);
        }
      }
    }

    if (hitT <= 1) {
      const d = dist * hitT;
      r.x = px + r.fx * d; r.z = pz + r.fz * d;
      r.odo += d;
      this.syncCur(r);
      if (this.over) { r.halted = true; r.speed = 0; r.boosting = false; return; }
      if (hitBoundary) this.crash(r, null, 'boundary');
      else this.crash(r, hitOwner, hitOwner === r ? 'self' : 'wall');
      return;
    }

    // terrain: ride the surface, launch off lips and crests, crash into cliffs, fall into the void
    const gq = T.height(qx, qz);
    if (r.air <= 0) {
      const rise = gq - r.y;
      if (rise > Math.max(C.CLIMB_STEP, dist * 1.3)) {
        if (this.over) { r.halted = true; r.speed = 0; return; }
        this.crash(r, null, 'terrain');
        return;
      }
      const ballistic = r.y + r.vy * h - 0.5 * C.GRAVITY * h * h;
      if (gq < ballistic - 0.03) {
        this.takeOff(r, r.vy);
      } else {
        r.y = gq;
        r.vy = this.slopeAt(qx, qz, r) * r.speed;
      }
    }
    let landed = false;
    if (r.air > 0) {
      const prevY = r.y;
      r.vy -= C.GRAVITY * h;
      const ny = r.y + r.vy * h;
      r.airT += h;
      if (ny <= gq) {
        if (gq - prevY > 0.7) {
          if (this.over) { r.halted = true; r.speed = 0; return; }
          this.crash(r, null, 'terrain');
          return;
        }
        r.y = gq;
        landed = true;
      } else {
        r.y = ny;
        if (r.y < -9) { this.crash(r, null, 'void'); return; }
      }
    }

    r.x = qx; r.z = qz;
    r.odo += dist;
    if (landed) this.land(r);
    this.syncCur(r);
    r.onRamp = r.air <= 0 && !!T.rampAt(r.x, r.z);

    this.features(r);
    if (!r.alive) return;
    this.updateGrind(r);
    this.nearMiss(r);
    r.boost = Math.min(1, r.boost + (C.BOOST_REGEN + C.GRIND_REGEN * r.grind) * h);
  }

  takeOff(r, vy) {
    this.endWall(r);
    r.air = 1;
    r.airT = 0;
    r.vy = vy;
  }

  land(r) {
    const air = r.airT;
    r.air = 0;
    r.airT = 0;
    r.vy = this.slopeAt(r.x, r.z, r) * r.speed;
    r.path.push({ x: r.x, z: r.z, s: r.odo });
    r.pathHeading = r.heading;
    r.gx = r.x; r.gz = r.z;
    this.startWall(r);
    this.emit({ type: 'land', rider: r, air });
    if (air > 0.75 && !this.over) {
      r.boost = Math.min(1, r.boost + 0.3);
      this.emit({ type: 'bigAir', rider: r, air });
    }
  }

  // Rise of the ground per metre along the rider's heading (cliff steps don't count as slope).
  slopeAt(x, z, r) {
    const T = this.terrain;
    const a = T.height(x - r.fx * 0.4, z - r.fz * 0.4), b = T.height(x + r.fx * 0.4, z + r.fz * 0.4);
    if (a === VOID || b === VOID) return 0;
    const s = (b - a) / 0.8;
    return Math.abs(s) > 1.2 ? 0 : s;
  }

  // Boost pads, portals, pickups and reactor lasers.
  features(r) {
    const m = this.map;
    const ground = r.air > 0 ? this.terrain.height(r.x, r.z) : r.y;

    if (r.air <= 0 && r.padT <= 0) {
      for (const p of m.pads) {
        if (!inRect(r.x, r.z, p.x, p.z, p.heading, p.length, p.width)) continue;
        r.speed = Math.max(r.speed, C.PAD_SPEED);
        r.boost = Math.min(1, r.boost + 0.35);
        r.padT = 0.8;
        this.emit({ type: 'pad', rider: r, pad: p });
        break;
      }
    }

    if (r.portalT <= 0 && r.y - ground < 4) {
      for (const pr of this.portals) {
        for (const [from, to] of [[pr.a, pr.b], [pr.b, pr.a]]) {
          if (Math.hypot(r.x - from[0], r.z - from[1]) > C.PORTAL_R) continue;
          const lift = r.y - ground;
          this.endWall(r);
          r.x = to[0] + r.fx * (C.PORTAL_R + 1.2);
          r.z = to[1] + r.fz * (C.PORTAL_R + 1.2);
          r.y = this.terrain.height(r.x, r.z) + lift;
          r.path = [{ x: r.x, z: r.z, s: r.odo }];
          r.pathStart = r.odo;
          r.pathHeading = r.heading;
          r.gx = r.x; r.gz = r.z;
          r.portalT = 1.2;
          if (r.air <= 0) this.startWall(r);
          this.emit({ type: 'portal', rider: r, from, to, color: pr.color });
          return this.features(r);
        }
      }
    }

    for (const p of this.pickups) {
      if (!p.active) continue;
      const dx = r.x - p.x, dz = r.z - p.z;
      if (dx * dx + dz * dz > 2.8 * 2.8 || Math.abs(r.y + 0.6 - p.y) > 2.4) continue;
      p.active = false;
      p.t = C.PICKUP_RESPAWN;
      if (p.type === 'boost') r.boost = 1;
      else if (p.type === 'jump') r.jump = 1;
      else if (p.type === 'ghost') r.ghostT = C.GHOST_TIME;
      this.emit({ type: 'pickup', rider: r, pickup: p });
    }

    if (r.y - ground < 1.25 && !this.over) {
      for (const s of this.sweepers) {
        const dx = r.x - s.x, dz = r.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < s.inner - 0.5 || d > s.len + 0.6) continue;
        const a = Math.atan2(dz, dx);
        for (let k = 0; k < s.arms; k++) {
          if (Math.abs(angleDiff(a, s.angles[k])) * d < 0.45) { this.crash(r, null, 'laser'); return; }
        }
      }
    }
  }

  // Grazing past a wall at speed refills a little boost and earns a "close call".
  nearMiss(r) {
    if (r.nearT > 0 || r.air > 0 || r.speed < 16 || this.over) return;
    const skip = r.odo - 4;
    let hit = false;
    const probe = (ax, az, bx, bz) => {
      if (hit) return;
      const vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz);
      if (L < 0.3) return;
      if (Math.abs((vx * r.fx + vz * r.fz) / L) > 0.85) return; // that's grinding, not a near miss
      if (distSq(r.x, r.z, ax, az, bx, bz) < 1.3 * 1.3) hit = true;
    };
    this.index.near(r.x, r.z, 1, (w) => { if (!(w.owner === r && w.s1 > skip)) probe(w.ax, w.az, w.bx, w.bz); });
    for (const o of this.riders) if (o !== r && o.cur) probe(o.cur.ax, o.cur.az, o.x, o.z);
    if (hit) {
      r.nearT = 1.4;
      r.boost = Math.min(1, r.boost + 0.2);
      this.emit({ type: 'nearMiss', rider: r });
    }
  }

  syncCur(r) {
    const w = r.cur;
    if (!w) return;
    w.bx = r.x; w.bz = r.z; w.by = r.y; w.s1 = r.odo; w.dirty = true;
    // rasterise the fresh stretch for the bots once it has moved a little
    const dx = r.x - r.gx, dz = r.z - r.gz;
    if (dx * dx + dz * dz > 0.64) {
      this.grid.markLine(r.gx, r.gz, r.x, r.z);
      r.gx = r.x; r.gz = r.z;
    }
  }

  // Riding close alongside a roughly parallel wall recharges boost.
  updateGrind(r) {
    r.grind = 0;
    if (r.air > 0 || r.speed < 4) return;
    const rx = -r.fz, rz = r.fx;
    let near = C.GRIND_DIST, side = 0;
    const hf = this.half;
    const edge = (d, nx, nz) => {
      if (d < near && Math.abs(r.fx * nz - r.fz * nx) > 0.8) { near = d; side = Math.sign(nx * rx + nz * rz) || 1; }
    };
    edge(hf - r.x, 1, 0); edge(r.x + hf, -1, 0); edge(hf - r.z, 0, 1); edge(r.z + hf, 0, -1);
    const skip = r.odo - 3.5;
    const probe = (ax, az, bx, bz, ay) => {
      if (Math.abs(ay - r.y) > 2) return;
      const vx = bx - ax, vz = bz - az;
      const L = Math.hypot(vx, vz);
      if (L < 0.3) return;
      if (Math.abs((vx * r.fx + vz * r.fz) / L) < 0.8) return;
      const t = ((r.x - ax) * vx + (r.z - az) * vz) / (L * L);
      if (t < 0 || t > 1) return;
      const cx = ax + vx * t - r.x, cz = az + vz * t - r.z;
      const d = Math.hypot(cx, cz);
      if (d < near && d > 0.2) { near = d; side = Math.sign(cx * rx + cz * rz) || 1; }
    };
    this.index.near(r.x, r.z, 1, (w) => {
      if (w.owner === r && w.s1 > skip) return;
      probe(w.ax, w.az, w.bx, w.bz, w.ay);
    });
    for (const o of this.riders) if (o !== r && o.cur) probe(o.cur.ax, o.cur.az, o.x, o.z, o.cur.ay);
    if (side !== 0 && near < C.GRIND_DIST) {
      const s = 1 - near / C.GRIND_DIST;
      r.grind = s * s * Math.min(1.4, r.speed / C.BASE_SPEED);
      r.grindSide = side;
      r.grindDist = near;
    }
  }

  crash(r, killer, cause) {
    if (!r.alive) return;
    r.alive = false;
    r.deathTime = this.time;
    r.killer = killer;
    r.cause = cause;
    r.boosting = false;
    this.endWall(r);
    if (killer && killer !== r && cause === 'wall' && !this.over) {
      killer.score += C.KILL_POINTS;
      killer.roundKills++;
      killer.totalKills++;
    }
    this.emit({ type: 'crash', rider: r, killer, cause, x: r.x, y: r.y, z: r.z });
  }

  finishRound() {
    this.over = true;
    this.overTime = 0;
    let winner = null;
    for (const r of this.riders) if (r.alive) winner = r;
    this.winner = winner;
    if (winner) {
      winner.score += C.WIN_POINTS;
      winner.roundsWon++;
    }
    // Match ends when someone reaches the target and is strictly ahead of everyone else.
    const sorted = [...this.riders].sort((a, b) => b.score - a.score);
    if (sorted[0].score >= C.MATCH_POINTS && sorted[0].score > sorted[1].score) this.matchWinner = sorted[0];
    this.emit({ type: 'roundOver', winner });
  }

  // Called once the player is out, so the remaining bots don't keep you waiting.
  hurry() {
    if (this.over) return;
    this.suddenAt = Math.min(this.suddenAt, this.time + 3);
    this.shrinkRate = C.SHRINK_RATE_FAST * (this.map.half / 92);
  }
}

export function angleDiff(a, b) {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}
