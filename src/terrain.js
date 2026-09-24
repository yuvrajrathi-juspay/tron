// Terrain for one arena: a single-valued height field built from features (mesas, ramps,
// dunes, pillars, void pits), plus the static "hazard" lines the bots see as walls:
//   - cliff edges are one-way: they block you riding into them from below, but riding off
//     them from above is a drop (a launch, really), so rays leaving the high side ignore them;
//   - pit rims and pillars block from both sides.

export const VOID = -1000;
const CLIMB = 0.45; // anything taller than this is a cliff, not a slope

export class Terrain {
  constructor(map) {
    this.map = map;
    this.features = map.features.map((f) => prepare(f));
    this.pits = this.features.filter((f) => f.type === 'pit');
    this.flat = this.features.length === 0;
    this.hazards = [];
    this.buildHazards();
  }

  // Ground height at (x, z). VOID inside pits.
  height(x, z) {
    if (this.flat) return 0;
    let h = 0;
    const fs = this.features;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      const v = f.h(x, z);
      if (v === VOID) return VOID;
      if (v > h) h = v;
    }
    return h;
  }

  // Which ramp (if any) the point is on, for "launching" logic.
  rampAt(x, z) {
    for (const f of this.features) {
      if (f.type !== 'ramp') continue;
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      if (f.h(x, z) > 0) return f;
    }
    return null;
  }

  inPit(x, z) {
    for (const f of this.pits) if (Math.abs(x - f.x) < f.w / 2 && Math.abs(z - f.z) < f.d / 2) return true;
    return false;
  }

  buildHazards() {
    const H = this.hazards;
    const seg = (ax, az, bx, bz, nx, nz, kind) => {
      if (Math.hypot(bx - ax, bz - az) < 0.05) return;
      H.push({ ax, az, bx, bz, nx, nz, kind, seen: 0 }); // (nx, nz) points into the high side; 0,0 = two-sided
    };
    const ramps = this.features.filter((f) => f.type === 'ramp');
    for (const f of this.features) {
      if (f.type === 'ramp') {
        const { x, z, fx, fz, rx, rz, length: L, width: W, hgt } = f;
        const at = (u, v) => [x + fx * u + rx * v, z + fz * u + rz * v];
        // sides only where they're taller than a climbable step
        const u0 = -L / 2 + (CLIMB / hgt) * L;
        for (const s of [-1, 1]) {
          const [ax, az] = at(u0, (s * W) / 2), [bx, bz] = at(L / 2, (s * W) / 2);
          seg(ax, az, bx, bz, -rx * s, -rz * s, 'cliff');
        }
        if (!f.attach) {
          const [ax, az] = at(L / 2, -W / 2), [bx, bz] = at(L / 2, W / 2);
          seg(ax, az, bx, bz, -fx, -fz, 'cliff');
        }
      } else if (f.type === 'mesa') {
        const x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
        const edges = [
          [x0, z0, x1, z0, 0, 1], [x1, z0, x1, z1, -1, 0], [x1, z1, x0, z1, 0, -1], [x0, z1, x0, z0, 1, 0],
        ];
        for (const [ax, az, bx, bz, nx, nz] of edges) {
          // cut out the openings where ramps meet the mesa
          const cuts = [];
          for (const r of ramps) {
            if (!r.attach) continue;
            const tx = r.x + r.fx * (r.length / 2), tz = r.z + r.fz * (r.length / 2);
            const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
            const t = ((tx - ax) * dx + (tz - az) * dz) / (L * L);
            const off = Math.abs((tx - ax) * dz - (tz - az) * dx) / L;
            if (off < 0.5 && t > 0 && t < 1) cuts.push([t - r.width / 2 / L, t + r.width / 2 / L]);
          }
          cuts.sort((a, b) => a[0] - b[0]);
          let t0 = 0;
          for (const [c0, c1] of [...cuts, [1, 1]]) {
            if (c0 > t0) seg(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * c0, az + (bz - az) * c0, nx, nz, 'cliff');
            t0 = Math.max(t0, c1);
          }
        }
      } else if (f.type === 'pit') {
        const x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
        seg(x0, z0, x1, z0, 0, 0, 'pit'); seg(x1, z0, x1, z1, 0, 0, 'pit');
        seg(x1, z1, x0, z1, 0, 0, 'pit'); seg(x0, z1, x0, z0, 0, 0, 'pit');
      } else if (f.type === 'pillar') {
        const n = 16;
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
          seg(f.x + Math.cos(a0) * f.r, f.z + Math.sin(a0) * f.r, f.x + Math.cos(a1) * f.r, f.z + Math.sin(a1) * f.r, 0, 0, 'pillar');
        }
      }
    }
  }
}

function prepare(f) {
  const o = { ...f };
  if (f.type === 'ramp') {
    const fx = Math.sin(f.heading), fz = -Math.cos(f.heading);
    const rx = -fz, rz = fx;
    Object.assign(o, { fx, fz, rx, rz, hgt: f.h });
    const L = f.length, W = f.width, H = f.h;
    o.h = (x, z) => {
      const dx = x - f.x, dz = z - f.z;
      const u = dx * fx + dz * fz, v = dx * rx + dz * rz;
      if (u < -L / 2 || u > L / 2 || v < -W / 2 || v > W / 2) return 0;
      return (H * (u + L / 2)) / L;
    };
    const ext = Math.hypot(L, W) / 2;
    Object.assign(o, { minX: f.x - ext, maxX: f.x + ext, minZ: f.z - ext, maxZ: f.z + ext });
  } else if (f.type === 'mesa') {
    const hw = f.w / 2, hd = f.d / 2, H = f.h;
    o.hgt = H;
    o.h = (x, z) => (Math.abs(x - f.x) <= hw && Math.abs(z - f.z) <= hd ? H : 0);
    Object.assign(o, { minX: f.x - hw, maxX: f.x + hw, minZ: f.z - hd, maxZ: f.z + hd });
  } else if (f.type === 'bump') {
    const R = f.r, H = f.h;
    o.hgt = H;
    o.h = (x, z) => {
      const d = Math.hypot(x - f.x, z - f.z);
      return d >= R ? 0 : H * 0.5 * (1 + Math.cos((Math.PI * d) / R));
    };
    Object.assign(o, { minX: f.x - R, maxX: f.x + R, minZ: f.z - R, maxZ: f.z + R });
  } else if (f.type === 'pit') {
    const hw = f.w / 2, hd = f.d / 2;
    o.h = (x, z) => (Math.abs(x - f.x) < hw && Math.abs(z - f.z) < hd ? VOID : 0);
    Object.assign(o, { minX: f.x - hw, maxX: f.x + hw, minZ: f.z - hd, maxZ: f.z + hd });
  } else if (f.type === 'pillar') {
    const R = f.r, H = f.h;
    o.hgt = H;
    o.h = (x, z) => (Math.hypot(x - f.x, z - f.z) <= R ? H : 0);
    Object.assign(o, { minX: f.x - R, maxX: f.x + R, minZ: f.z - R, maxZ: f.z + R });
  }
  return o;
}

// Heading-aligned rectangle test used by boost pads.
export function inRect(x, z, cx, cz, heading, length, width) {
  const fx = Math.sin(heading), fz = -Math.cos(heading);
  const dx = x - cx, dz = z - cz;
  const u = dx * fx + dz * fz, v = dx * -fz + dz * fx;
  return Math.abs(u) <= length / 2 && Math.abs(v) <= width / 2;
}
