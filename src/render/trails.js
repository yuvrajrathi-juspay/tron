import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec3, mix, smoothstep, fract, pow, floor, hash, step, time, positionGeometry, positionWorld, positionLocal,
  normalGeometry, cameraPosition, length,
} from 'three/tsl';
import { WALL_HEIGHT, WALL_THICK } from '../config.js';

const MAX_WALLS = 8000;
export const TAIL = 2.9; // walls emerge from the tail of the bike, this far behind the nose

// One instanced mesh of light walls per rider (plus its mirror image under the floor).
// Each wall is a unit box stretched along its segment; the shader paints the glowing
// top edge, the energy pulses flowing along it, and the dissolve when its rider falls.
export class Trails {
  constructor(scene, reflectGroup, riders) {
    // Unit box without its end caps (and bottom): walls are chains of short pieces on curves,
    // and additive end caps would glow as seams at every joint.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0.5, 0.5, 0);
    const idx = geo.index.array;
    const keep = [];
    for (const g of geo.groups) {
      if (g.materialIndex === 0 || g.materialIndex === 1 || g.materialIndex === 3) continue; // +x, -x, -y
      for (let i = g.start; i < g.start + g.count; i++) keep.push(idx[i]);
    }
    geo.setIndex(keep);
    geo.clearGroups();
    this.sets = riders.map((r) => {
      const u = { color: uniform(new THREE.Color(r.color)), derez: uniform(0), fresh: uniform(0) };
      const main = new THREE.InstancedMesh(geo, this.material(u, 1.0), MAX_WALLS);
      const mirror = new THREE.InstancedMesh(geo, this.material(u, 0.5), MAX_WALLS);
      for (const m of [main, mirror]) {
        m.count = 0;
        m.frustumCulled = false; // instances move constantly; bounds would go stale
      }
      main.renderOrder = 3;
      mirror.renderOrder = -2;
      scene.add(main);
      reflectGroup.add(mirror);
      return { rider: r, main, mirror, u, count: 0, walls: null };
    });
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.yAxis = new THREE.Vector3(0, 1, 0);
  }

  material(u, gain) {
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
    // dissolving walls sink toward their base (which may sit on a ramp or the mesa, so only the top moves)
    mat.positionNode = positionLocal.sub(vec3(0, positionGeometry.y.mul(WALL_HEIGHT * 0.9).mul(u.derez), 0));
    mat.colorNode = Fn(() => {
      const y = positionGeometry.y;
      const along = positionWorld.x.add(positionWorld.z);
      const white = mix(u.color, vec3(1, 1, 1), 0.55);
      const topFace = step(0.5, normalGeometry.y);
      const side = float(1).sub(topFace);
      const body = mix(float(0.05), float(0.3), pow(y, 2.0));
      const base = smoothstep(0.14, 0.0, y).mul(0.45);
      const band = smoothstep(0.8, 0.97, y).mul(side);
      const flow = smoothstep(0.86, 1.0, fract(along.mul(0.06).sub(time.mul(0.85)))).mul(0.3).mul(y);
      const scan = smoothstep(0.92, 1.0, fract(y.mul(5.0))).mul(0.05);
      const c = u.color.mul(body.add(base).add(flow).add(scan).mul(side))
        .add(white.mul(band.mul(1.9)))
        .add(u.color.mul(topFace.mul(0.75)))
        .toVar();
      // walls right beside the camera (your own, mostly) fade so they never white out the view
      const camD = length(positionWorld.sub(cameraPosition));
      c.mulAssign(smoothstep(1.5, 12.0, camD).mul(0.8).add(0.2));
      // dissolve: blocks of the wall wink out, their edges flare white
      const n = hash(floor(positionWorld.x.mul(2.5)).add(floor(positionWorld.z.mul(2.5)).mul(57)).add(floor(y.mul(7)).mul(131)));
      const keep = step(u.derez, n);
      const edge = smoothstep(0.12, 0.0, n.sub(u.derez)).mul(keep).mul(step(0.001, u.derez));
      c.assign(c.mul(keep).add(white.mul(edge.mul(2.5))));
      return c.mul(gain);
    })();
    return mat;
  }

  // Point on the rider's ridden path `s` metres along it (the tail follows the nose's exact path).
  static pathPoint(r, s, out) {
    const path = r.path;
    let i = path.length - 1;
    while (i > 0 && path[i].s > s) i--;
    const a = path[i];
    const bx = i + 1 < path.length ? path[i + 1].x : r.x;
    const bz = i + 1 < path.length ? path[i + 1].z : r.z;
    const bs = i + 1 < path.length ? path[i + 1].s : r.odo;
    const span = bs - a.s;
    const t = span > 1e-6 ? Math.min(1, Math.max(0, (s - a.s) / span)) : 0;
    out.x = a.x + (bx - a.x) * t;
    out.z = a.z + (bz - a.z) * t;
    return out;
  }

  update() {
    for (const set of this.sets) {
      const r = set.rider;
      const walls = r.walls;
      if (set.walls !== walls) {
        // new round: fresh wall list
        set.walls = walls;
        set.count = 0;
      }
      set.u.derez.value = r.alive ? 0 : r.derez;
      const n = !r.alive && r.derez >= 1 ? 0 : Math.min(walls.length, MAX_WALLS);
      const sVis = r.alive ? r.odo - TAIL : Infinity;
      set.lo = Infinity;
      set.hi = -1;
      // Walk back from the newest wall: those are the only ones still growing or being
      // uncovered by the tail. Stop at the first wall that is complete and fully shown.
      for (let i = n - 1, guard = 0; i >= 0 && guard < 600; i--, guard++) {
        const w = walls[i];
        const full = w.s1 - w.s0;
        const len = Math.max(0, Math.min(w.s1, sVis) - w.s0);
        if (w.dirty || w.vlen !== len) {
          w.dirty = false;
          w.vlen = len;
          this.writeMatrix(set, i, w, len);
        } else if (i < set.count - 1 && len >= full) {
          break;
        }
      }
      set.count = n;
      set.main.count = n;
      set.mirror.count = n;
      if (set.hi >= 0) {
        for (const m of [set.main, set.mirror]) {
          m.instanceMatrix.addUpdateRange(set.lo * 16, (set.hi - set.lo + 1) * 16);
          m.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  // Walls are vertical ribbons standing on sloped ground: the instance matrix shears the unit box
  // so its base runs from (ax, ay, az) along the ground to the visible end.
  writeMatrix(set, i, w, len) {
    const vx = w.bx - w.ax, vz = w.bz - w.az;
    const L = Math.hypot(vx, vz);
    const full = Math.max(1e-6, w.s1 - w.s0);
    const dx = L > 1e-6 ? vx / L : w.owner.fx, dz = L > 1e-6 ? vz / L : w.owner.fz;
    const k = Math.min(1, len / full);
    const ex = vx * k, ey = (w.by - w.ay) * k, ez = vz * k;
    const lx = len > 1e-4 ? ex : dx * 1e-4, lz = len > 1e-4 ? ez : dz * 1e-4;
    const t = WALL_THICK;
    // columns: X = along the wall (with rise), Y = up, Z = horizontal normal; translation = base start
    this.m4.set(
      lx, 0, -dz * t, w.ax,
      ey, WALL_HEIGHT, 0, w.ay,
      lz, 0, dx * t, w.az,
      0, 0, 0, 1,
    );
    set.main.setMatrixAt(i, this.m4);
    set.mirror.setMatrixAt(i, this.m4);
    if (i < set.lo) set.lo = i;
    if (i > set.hi) set.hi = i;
  }

  setMirror(on) {
    for (const set of this.sets) set.mirror.visible = on;
  }
}
