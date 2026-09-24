import { ARENA_HALF } from './config.js';

// Visits every cell of a uniform grid that the segment a->b passes through ("supercover":
// when the walk steps diagonally it also visits the side cell, so thin diagonal walls
// never leave a corner gap).
export function walkCells(ax, az, bx, bz, cell, origin, n, visit) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / (cell * 0.25)));
  let pi = Math.floor((ax + origin) / cell), pj = Math.floor((az + origin) / cell);
  if (pi >= 0 && pj >= 0 && pi < n && pj < n) visit(pi, pj);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const i = Math.floor((ax + (bx - ax) * t + origin) / cell);
    const j = Math.floor((az + (bz - az) * t + origin) / cell);
    if (i === pi && j === pj) continue;
    if (i !== pi && j !== pj && i >= 0 && pj >= 0 && i < n && pj < n) visit(i, pj);
    if (i >= 0 && j >= 0 && i < n && j < n) visit(i, j);
    pi = i; pj = j;
  }
}

// Spatial hash of light-wall segments so collision, grinding and bot ray casts only test nearby walls.
export class SegIndex {
  constructor(half = ARENA_HALF + 6, cell = 4) {
    this.cell = cell;
    this.origin = half;
    this.n = Math.ceil((2 * half) / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.stamp = 1;
  }

  clear() {
    for (const c of this.cells) c.length = 0;
  }

  insert(seg) {
    const cells = this.cells, n = this.n;
    walkCells(seg.ax, seg.az, seg.bx, seg.bz, this.cell, this.origin, n, (i, j) => cells[j * n + i].push(seg));
  }

  rebuild(segs) {
    this.clear();
    for (const s of segs) this.insert(s);
  }

  // Calls fn(seg) once for every segment registered within `r` cells of (x, z).
  near(x, z, r, fn) {
    const n = this.n, c = this.cell;
    const ci = Math.floor((x + this.origin) / c), cj = Math.floor((z + this.origin) / c);
    const st = ++this.stamp;
    for (let j = Math.max(0, cj - r); j <= Math.min(n - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(n - 1, ci + r); i++) {
        const list = this.cells[j * n + i];
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          if (s.seen === st) continue;
          s.seen = st;
          fn(s);
        }
      }
    }
  }

  // Calls fn(seg) once for every segment in the cells a ray from (x, z) along (dx, dz) crosses.
  along(x, z, dx, dz, len, fn) {
    const n = this.n, cells = this.cells;
    const st = ++this.stamp;
    walkCells(x, z, x + dx * len, z + dz * len, this.cell, this.origin, n, (i, j) => {
      const list = cells[j * n + i];
      for (let k = 0; k < list.length; k++) {
        const s = list[k];
        if (s.seen === st) continue;
        s.seen = st;
        fn(s);
      }
    });
  }
}

// Squared distance from point (px, pz) to segment a->b.
export function distSq(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const L = vx * vx + vz * vz;
  let t = L > 1e-9 ? ((px - ax) * vx + (pz - az) * vz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + vx * t - px, dz = az + vz * t - pz;
  return dx * dx + dz * dz;
}

// Parameter t in [0,1] along p->q where it first comes within `pad` of segment a->b, or -1.
// Approximated as: proper crossing of the two segments, else ending within pad of the wall.
export function sweepHit(px, pz, qx, qz, ax, az, bx, bz, pad) {
  const rx = qx - px, rz = qz - pz, sx = bx - ax, sz = bz - az;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) > 1e-12) {
    const t = ((ax - px) * sz - (az - pz) * sx) / den;
    const u = ((ax - px) * rz - (az - pz) * rx) / den;
    if (t >= 0 && t <= 1 && u >= -0.001 && u <= 1.001) {
      // back off so we stop `pad` short of the wall line
      const rl = Math.hypot(rx, rz);
      const sin = Math.abs(den) / (rl * Math.hypot(sx, sz) + 1e-12);
      return Math.max(0, t - (pad / Math.max(0.2, sin)) / (rl + 1e-12));
    }
  }
  if (distSq(qx, qz, ax, az, bx, bz) < pad * pad) return 1;
  return -1;
}

// Distance along the ray from (x, z) in unit direction (dx, dz) to segment a->b (thickened by pad), or -1.
export function rayHit(x, z, dx, dz, ax, az, bx, bz, pad) {
  const sx = bx - ax, sz = bz - az;
  const den = dx * sz - dz * sx;
  let best = -1;
  if (Math.abs(den) > 1e-9) {
    const t = ((ax - x) * sz - (az - z) * sx) / den;
    const u = ((ax - x) * dz - (az - z) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1) {
      const sin = Math.abs(den) / (Math.hypot(sx, sz) + 1e-12);
      best = Math.max(0, t - pad / Math.max(0.2, sin));
    }
  }
  // near-parallel passes: treat as a hit where the ray gets within pad of the endpoints
  for (let e = 0; e < 2; e++) {
    const ex = e ? bx : ax, ez = e ? bz : az;
    const t = (ex - x) * dx + (ez - z) * dz;
    if (t < 0) continue;
    const ox = x + dx * t - ex, oz = z + dz * t - ez;
    if (ox * ox + oz * oz < pad * pad && (best < 0 || t < best)) best = Math.max(0, t - pad);
  }
  return best;
}
