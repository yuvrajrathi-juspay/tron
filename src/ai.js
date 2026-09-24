import { rand } from './rng.js';
import * as C from './config.js';
import { angleDiff } from './sim.js';

// Personality multipliers layered on top of the difficulty preset.
const PERSONA = {
  hunter:   { aggro: 1.35, blunder: 1.0,  space: 1.0,  boost: 1.15, wander: 0.8, jump: 1.0, focusPlayer: 0.7, chase: 1.0 },
  survivor: { aggro: 0.55, blunder: 0.75, space: 1.25, boost: 0.8,  wander: 0.6, jump: 1.0, focusPlayer: 0.45, chase: 0.35 },
  wild:     { aggro: 1.0,  blunder: 1.3,  space: 0.9,  boost: 1.6,  wander: 1.8, jump: 1.3, focusPlayer: 0.55, chase: 0.7 },
};

const OFFSETS = [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9, -1.25, 1.25, -1.65, 1.65];

// A bot drives a rider through the same controls the player has: steer, throttle, brake,
// boost, jump. It picks a heading from ray casts and flood fills, steers toward it with a
// little reaction lag, and now and then misjudges, so it plays like a decent but fallible human.
export class Bot {
  constructor(sim, rider, difficulty = 'pilot', persona = rider.persona) {
    this.sim = sim;
    this.r = rider;
    this.persona = persona;
    this.setDifficulty(difficulty);
    this.reset();
  }

  setDifficulty(key) {
    this.d = C.DIFFICULTY[key] || C.DIFFICULTY.pilot;
    this.p = PERSONA[this.persona] || PERSONA.survivor;
  }

  reset() {
    this.thinkT = rand() * this.d.think;
    this.desired = this.r.heading;
    this.pending = null;
    this.frozenUntil = 0;
    this.inDanger = false;
    this.startAt = 0.05 + rand() * 0.35;
    this.scanAt = 0.8 + rand() * 0.8;
    this.boostUntil = 0;
    this.brakeUntil = 0;
    this.cutReadyAt = 2 + rand() * 3;
    this.target = null;
    this.targetAt = 0;
  }

  update(h) {
    const r = this.r, sim = this.sim, t = sim.time;
    if (!r.alive) { r.wantBoost = r.wantBrake = r.wantThrottle = false; r.steer = 0; return; }

    if (this.pending && t >= this.pending.at) {
      this.desired = this.pending.heading;
      this.pending = null;
    }
    const diff = angleDiff(this.desired, r.heading);
    r.steer = Math.max(-1, Math.min(1, diff * this.d.steerGain));
    r.wantThrottle = t >= this.startAt;
    r.wantBoost = t < this.boostUntil && r.boost > 0.05;
    r.wantBrake = t < this.brakeUntil && !r.wantBoost && r.speed > 9;

    this.thinkT -= h;
    if (this.thinkT > 0) return;
    this.thinkT = this.d.think * (0.8 + rand() * 0.4);
    this.think();
  }

  // Commit to a new heading after a human-ish reaction delay. Re-planning while a decision is
  // still pending only refines the target; it never pushes the reaction back.
  aim(heading, urgent = false) {
    const at = this.sim.time + this.d.react * (0.5 + rand()) * (urgent ? 1 : 1.5);
    if (this.pending) {
      this.pending.heading = heading;
      if (at < this.pending.at) this.pending.at = at;
    } else {
      this.pending = { heading, at };
    }
  }

  ray(a, max = 90) {
    const r = this.r;
    return this.sim.rayDist(r, r.x, r.z, a, max, true);
  }

  // Free cells reachable from a point a few metres out along heading a.
  space(a, dist) {
    const r = this.r, g = this.sim.grid;
    const k = Math.max(2.2, Math.min(dist * 0.5, 7));
    return g.flood(r.x + Math.sin(a) * k, r.z - Math.cos(a) * k, this.d.spaceCap * this.p.space, this.sim.half);
  }

  think() {
    const r = this.r, sim = this.sim, d = this.d, t = sim.time;
    if (r.air > 0 || t < this.startAt) return;

    const sp = Math.max(r.speed, 12);
    const look = sp * (d.look + d.react) + 3 + (sim.sudden ? sim.shrinkRate : 0);
    // danger along both where we're pointed and where we're turning to
    const dNow = this.ray(r.heading);
    const dAim = Math.abs(angleDiff(this.desired, r.heading)) > 0.05 ? this.ray(this.desired) : dNow;
    if (Math.min(dNow, dAim) < look) {
      if (!this.inDanger) {
        this.inDanger = true;
        if (rand() < d.late) this.frozenUntil = t + 0.12 + rand() * 0.3;
      }
      if (t < this.frozenUntil) return;
      this.evade(look);
      return;
    }
    this.inDanger = false;

    if (t >= this.scanAt) {
      this.scanAt = t + 0.3 + rand() * 0.45;
      if (this.strategic()) return;
    }
    this.boostLogic(dNow);
  }

  evade(look) {
    const r = this.r, d = this.d, p = this.p, t = this.sim.time;
    const opts = OFFSETS.map((off) => {
      const a = r.heading + off;
      const dist = this.ray(a);
      // commit: once a way out is chosen, stick with it instead of flip-flopping
      const keep = dist > look && Math.abs(angleDiff(a, this.desired)) < 0.45 ? 9 : 0;
      return { off, a, dist, space: 0, score: Math.min(dist, 60) - Math.abs(off) * 3 + keep };
    });
    opts.sort((x, y) => y.score - x.score);
    const blunder = rand() < d.blunder * p.blunder;
    if (!blunder) {
      for (let i = 0; i < 4; i++) {
        const o = opts[i];
        o.space = o.dist < 2 ? 0 : this.space(o.a, o.dist);
        o.score += o.space * 0.09;
      }
      opts.sort((x, y) => y.score - x.score);
    }
    const best = opts[0];

    // boxed in: try to jump the wall ahead
    if (best.dist < look * 0.45 && r.jump >= 1 && rand() < d.jumpSense * p.jump) {
      const jd = r.speed * C.JUMP_TIME + 1.5;
      const lx = r.x + r.fx * jd, lz = r.z + r.fz * jd;
      const lim = this.sim.half - 3;
      if (Math.abs(lx) < lim && Math.abs(lz) < lim) {
        const land = this.sim.grid.flood(lx, lz, d.spaceCap * p.space, this.sim.half);
        if (land > best.space * 1.5 + 25) {
          r.wantJump = true;
          return;
        }
      }
    }
    // Can we swing round in time? The turn needs about R*sin(angle) of road ahead (R = speed / turn rate).
    // If not, brake: a slower bike turns tighter.
    const need = (r.speed / C.TURN_RATE) * Math.sin(Math.min(Math.abs(best.off), Math.PI / 2)) + r.speed * d.react + 2;
    const ahead = this.ray(r.heading);
    if (ahead < need || (best.dist < look * 0.7 && Math.abs(best.off) > 0.5)) this.brakeUntil = t + 0.25;
    this.boostUntil = 0;
    this.aim(best.a, true);
  }

  strategic() {
    const r = this.r, sim = this.sim, d = this.d, p = this.p;
    const cap = d.spaceCap * p.space;

    // Don't ride into a pocket: if another direction offers much more room, take it.
    if (rand() > d.blunder * p.blunder) {
      const here = this.space(r.heading, this.ray(r.heading));
      if (here < cap * 0.9) {
        let best = null;
        for (const off of [-0.9, 0.9, -1.5, 1.5]) {
          const a = r.heading + off, dist = this.ray(a);
          if (dist < 10) continue;
          const s = this.space(a, dist);
          if (!best || s > best.s) best = { a, s };
        }
        if (best && best.s > here * 1.6 + 20) { this.aim(best.a); return true; }
      }
    }

    // Sudden death: steer back toward the middle before the walls reach you.
    if (sim.sudden) {
      const edge = Math.max(Math.abs(r.x), Math.abs(r.z));
      if (edge > sim.half * 0.55) {
        const toCenter = Math.atan2(-r.x, r.z);
        if (Math.abs(angleDiff(toCenter, r.heading)) > 0.6 && this.ray(toCenter) > 10) { this.aim(toCenter); return true; }
      }
    }

    if (this.tryIntercept()) return true;

    // Wander a little so lines aren't predictable.
    if (rand() < 0.12 * p.wander) {
      const a = r.heading + (rand() - 0.5) * 1.6;
      if (this.ray(a) > 30) { this.aim(a); return true; }
    }
    return false;
  }

  pickTarget() {
    const r = this.r, sim = this.sim, t = sim.time;
    if (this.target && this.target.alive && t < this.targetAt) return this.target;
    this.targetAt = t + 2 + rand() * 3;
    const player = sim.riders[sim.playerIndex];
    if (player !== r && player.alive && rand() < this.p.focusPlayer) return (this.target = player);
    let best = null, bd = Infinity;
    for (const o of sim.riders) {
      if (o === r || !o.alive) continue;
      const dd = (o.x - r.x) ** 2 + (o.z - r.z) ** 2;
      if (dd < bd) { bd = dd; best = o; }
    }
    return (this.target = best);
  }

  // Aim for a point ahead of the target's nose: close in from afar, cut across their line up close.
  tryIntercept() {
    const r = this.r, sim = this.sim, d = this.d, p = this.p, t = sim.time;
    if (t < this.cutReadyAt || rand() > d.aggro * p.aggro * p.chase) return false;
    const o = this.pickTarget();
    if (!o || o.air > 0) return false;
    const dist = Math.hypot(o.x - r.x, o.z - r.z);
    const lead = Math.max(6, Math.min(24, dist * 0.55));
    const px = o.x + o.fx * lead, pz = o.z + o.fz * lead;
    const a = Math.atan2(px - r.x, -(pz - r.z));
    if (Math.abs(angleDiff(a, r.heading)) > 1.9) return false;
    const need = Math.min(Math.hypot(px - r.x, pz - r.z), 35);
    if (this.ray(a) < need + 4) return false;
    if (this.space(a, need) < 60) return false;
    this.aim(a);
    if (dist < 30 && r.boost > 0.35 && rand() < d.boostUse) this.boostUntil = t + 0.6;
    this.cutReadyAt = t + (dist < 30 ? 1.5 : 0.6) + rand() * 1.5;
    return true;
  }

  boostLogic(dNow) {
    const r = this.r, t = this.sim.time, d = this.d, p = this.p;
    if (t < this.boostUntil) {
      if (dNow < r.speed * 0.9 + 10) this.boostUntil = 0;
      return;
    }
    if (r.boost > 0.55 && dNow > 45 && rand() < 0.07 * d.boostUse * p.boost) {
      this.boostUntil = t + 0.6 + rand() * 1.4;
    }
  }
}
