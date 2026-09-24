import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, color, mix, smoothstep, fract, abs, exp, max, positionWorld, positionGeometry, attribute, time,
  sin, cos, step, uv, pow, normalWorld, hash, floor,
} from 'three/tsl';
import { beam, glowDisc } from './scenery.js';
import { gridLine } from './materials.js';

// Builds the meshes for a map's terrain features and interactive props.
// Returns { group, update(dt, t, sim) }.
//
// pal: { edge, hazard, slab, slabLine, top: [baseA, baseB, line], pad, pickup: {boost, jump, ghost}, laser }
export function buildFeatures(map, terrain, pal, groundMat) {
  const group = new THREE.Group();
  const updaters = [];
  const edgeMat = neon(pal.edge, 3.2);
  const hazardMat = neon(pal.hazard, 3.0);
  const slab = slabMat(pal.slab, pal.slabLine);

  for (const f of terrain.features) {
    if (f.type === 'ramp') group.add(ramp(f, pal, edgeMat, hazardMat, slab));
    else if (f.type === 'mesa') group.add(mesa(f, groundMat, edgeMat, slab, pal));
    else if (f.type === 'pillar') updaters.push(reactor(f, group, pal));
    else if (f.type === 'pit') group.add(pit(f, hazardMat, pal));
  }
  for (const p of map.pads) group.add(pad(p, terrain, pal));
  for (const pr of map.portals) updaters.push(portal(pr, terrain, group));
  for (const s of map.sweepers) updaters.push(sweeper(s, group, pal));
  updaters.push(pickups(map, terrain, group, pal));

  return {
    group,
    update(dt, t, sim) {
      for (const u of updaters) u(dt, t, sim);
    },
  };
}

function neon(hex, gain) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(new THREE.Color(hex)).mul(gain);
  return m;
}

function slabMat(base, lineHex) {
  const m = new THREE.MeshStandardNodeMaterial({ color: base, metalness: 0.55, roughness: 0.55 });
  m.envMapIntensity = 0.2;
  const lc = new THREE.Color(lineHex);
  m.emissiveNode = Fn(() => {
    const y = positionWorld.y;
    const side = float(1).sub(abs(normalWorld.y));
    const strata = smoothstep(0.05, 0.0, abs(fract(y.div(1.5)).sub(0.5)).sub(0.45)).mul(0.5);
    const ribs = smoothstep(0.04, 0.0, abs(fract(positionWorld.x.add(positionWorld.z).div(4)).sub(0.5)).sub(0.46)).mul(0.25);
    return color(lc).mul(strata.add(ribs).mul(side));
  })();
  return m;
}

// ---------------------------------------------------------------- ramps

function ramp(f, pal, edgeMat, hazardMat, slab) {
  const g = new THREE.Group();
  const L = f.length, W = f.width, H = f.hgt;
  const at = (u, v, y) => new THREE.Vector3(f.x + f.fx * u + f.rx * v, y, f.z + f.fz * u + f.rz * v);
  const L2 = L / 2, W2 = W / 2;
  const A0 = at(-L2, -W2, 0), A1 = at(-L2, W2, 0), B0 = at(L2, -W2, 0), B1 = at(L2, W2, 0);
  const T0 = at(L2, -W2, H), T1 = at(L2, W2, H);

  // sloped deck with its own (u along, v across) coordinates for the chevrons
  const top = new THREE.BufferGeometry();
  const tp = [], tuv = [];
  const push = (p, u, v) => { tp.push(p.x, p.y, p.z); tuv.push(u, v); };
  const faceUp = (a, b, c, ua, ub, uc) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.y < 0) { push(a, ...ua); push(c, ...uc); push(b, ...ub); } else { push(a, ...ua); push(b, ...ub); push(c, ...uc); }
  };
  faceUp(A0, T0, T1, [0, -1], [1, -1], [1, 1]);
  faceUp(A0, T1, A1, [0, -1], [1, 1], [0, 1]);
  top.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  top.setAttribute('ruv', new THREE.Float32BufferAttribute(tuv, 2));
  top.computeVertexNormals();
  const deck = new THREE.MeshBasicNodeMaterial();
  const accent = new THREE.Color(pal.edge), base = new THREE.Color(pal.top[0]);
  const ruv = attribute('ruv', 'vec2');
  deck.colorNode = Fn(() => {
    const u = ruv.x, v = ruv.y;
    const chev = smoothstep(0.55, 0.62, fract(u.mul(L / 3).sub(abs(v).mul(0.9)).sub(time.mul(1.1))))
      .mul(smoothstep(1.0, 0.8, abs(v)));
    const rails = smoothstep(0.86, 0.97, abs(v));
    const grid = gridLine(positionWorld.xz, 4, 1.0).mul(0.25);
    return color(base).add(color(accent).mul(chev.mul(0.55).add(rails.mul(0.7)).add(grid).mul(u.mul(0.6).add(0.4))));
  })();
  g.add(new THREE.Mesh(top, deck));

  // sides (+ back when it stands free)
  const sides = new THREE.BufferGeometry();
  const sp = [];
  const tri = (a, b, c, out) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const o = [a, b, c];
    if (n.dot(out) < 0) o.reverse();
    for (const p of o) sp.push(p.x, p.y, p.z);
  };
  const right = new THREE.Vector3(f.rx, 0, f.rz), fwd = new THREE.Vector3(f.fx, 0, f.fz);
  tri(A0, B0, T0, right.clone().negate());
  tri(A1, T1, B1, right);
  if (!f.attach) { tri(B0, B1, T1, fwd); tri(B0, T1, T0, fwd); }
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sides.computeVertexNormals();
  g.add(new THREE.Mesh(sides, slab));

  // neon edges: rails along the top sides, and a hazard-coloured lip on free-standing kickers
  g.add(beam(A0.clone().setY(0.03), T0, 0.12, edgeMat), beam(A1.clone().setY(0.03), T1, 0.12, edgeMat));
  if (!f.attach) {
    g.add(beam(T0, T1, 0.16, hazardMat));
    g.add(beam(B0.clone().setY(0.05), B1.clone().setY(0.05), 0.1, hazardMat));
  }
  return g;
}

// ---------------------------------------------------------------- mesa

function mesa(f, groundMat, edgeMat, slab, pal) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(f.w, f.hgt, f.d);
  const m = new THREE.Mesh(geo, [slab, slab, groundMat, slab, slab, slab]);
  m.position.set(f.x, f.hgt / 2, f.z);
  g.add(m);
  const y = f.hgt + 0.02;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(f.x + (sx * f.w) / 2, y, f.z + (sz * f.d) / 2));
  for (let i = 0; i < 4; i++) g.add(beam(c[i], c[(i + 1) % 4], 0.18, edgeMat));
  // corner beacons
  const bm = neon(pal.hazard, 4);
  for (const p of c) {
    const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), bm);
    b.position.copy(p).setY(y + 0.8);
    g.add(b);
  }
  return g;
}

// ---------------------------------------------------------------- reactor pillar

function reactor(f, group, pal) {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  const core = new THREE.MeshBasicNodeMaterial();
  const a = new THREE.Color(pal.laser), b = new THREE.Color(pal.edge);
  core.colorNode = Fn(() => {
    const y = positionGeometry.y.add(f.hgt / 2);
    const ang = positionGeometry.z.atan(positionGeometry.x);
    const flow = smoothstep(0.7, 1.0, fract(y.mul(0.18).sub(time.mul(0.9))));
    const ribs = smoothstep(0.85, 1.0, abs(sin(ang.mul(8))));
    const base = mix(color(b).mul(0.25), color(a).mul(0.6), ribs);
    return base.add(color(a).mul(flow.mul(2.2))).add(vec3(1, 1, 1).mul(smoothstep(2.0, 0.0, y).mul(1.2)));
  })();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r * 1.08, f.hgt, 48, 1), core);
  col.position.y = f.hgt / 2;
  g.add(col);
  const ringMat = neon(pal.laser, 3.5);
  const rings = [];
  for (const [yy, r] of [[5, f.r + 1.2], [12, f.r + 2.2], [21, f.r + 1.6]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.14, 8, 64), ringMat);
    ring.position.y = yy;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    rings.push(ring);
  }
  const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  beamMat.colorNode = Fn(() => {
    const y = positionGeometry.y.div(400).add(0.5);
    return color(a).mul(pow(float(1).sub(y), 3).mul(0.35));
  })();
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(9, f.r * 0.8, 400, 24, 1, true), beamMat);
  sky.position.y = f.hgt + 200;
  g.add(sky);
  const disc = glowDisc(f.r * 3, pal.laser, 0.5);
  disc.position.y = 0.04;
  g.add(disc);
  group.add(g);
  return (dt) => {
    rings.forEach((r, i) => {
      r.rotation.z += dt * (i % 2 ? -0.6 : 0.8);
      r.rotation.x = Math.PI / 2 + Math.sin(performance.now() * 0.0007 + i) * 0.12;
    });
  };
}

// ---------------------------------------------------------------- void pits

function pit(f, hazardMat, pal) {
  const g = new THREE.Group();
  const x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
  const depth = 18;
  const wallMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const hz = new THREE.Color(pal.hazard);
  wallMat.colorNode = Fn(() => {
    const y = positionWorld.y.negate(); // 0 at the rim, growing downward
    const diag = fract(positionWorld.x.add(positionWorld.z).add(y).mul(0.5));
    const stripes = step(0.5, diag).mul(smoothstep(1.6, 0.0, y));
    const fadeDown = exp(y.mul(-0.22));
    const bands = smoothstep(0.9, 1.0, fract(y.mul(0.35).add(time.mul(0.3)))).mul(0.35).mul(fadeDown);
    return color(hz).mul(stripes.mul(0.9).add(bands)).add(vec3(0.02, 0.02, 0.05).mul(fadeDown));
  })();
  const quad = (ax, az, bx, bz) => {
    const geo = new THREE.PlaneGeometry(Math.hypot(bx - ax, bz - az), depth);
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set((ax + bx) / 2, -depth / 2, (az + bz) / 2);
    m.rotation.y = Math.atan2(-(bz - az), bx - ax);
    return m;
  };
  g.add(quad(x0, z0, x1, z0), quad(x1, z0, x1, z1), quad(x1, z1, x0, z1), quad(x0, z1, x0, z0));
  const y = 0.05;
  const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => new THREE.Vector3(x, y, z));
  for (let i = 0; i < 4; i++) g.add(beam(c[i], c[(i + 1) % 4], 0.2, hazardMat));
  // a faint glow deep in the void so the drop reads as a drop
  const deep = glowDisc(Math.max(f.w, f.d) * 0.6, pal.voidGlow ?? 0x4020a0, 0.35);
  deep.position.set(f.x, -depth, f.z);
  g.add(deep);
  return g;
}

// ---------------------------------------------------------------- boost pads

function pad(p, terrain, pal) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const c = new THREE.Color(pal.pad);
  mat.colorNode = Fn(() => {
    const q = uv();
    const x = abs(q.x.sub(0.5)).mul(2);
    const chev = smoothstep(0.45, 0.55, fract(q.y.mul(p.length / 3).sub(x.mul(0.8)).sub(time.mul(2.4))));
    const frame = smoothstep(0.86, 0.96, x).add(smoothstep(0.04, 0.0, q.y)).add(smoothstep(0.96, 1.0, q.y));
    return color(c).mul(chev.mul(1.3).add(frame.mul(1.6)).add(0.08));
  })();
  const geo = new THREE.PlaneGeometry(p.width, p.length);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p.x, terrain.height(p.x, p.z) + 0.04, p.z);
  m.rotation.y = -p.heading;
  m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------- portals

function portal(pr, terrain, group) {
  const R = 3.4;
  const c = new THREE.Color(pr.color);
  const swirl = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  swirl.colorNode = Fn(() => {
    const q = positionGeometry.xy.div(R);
    const r = q.length();
    const a = q.y.atan(q.x);
    const arms = smoothstep(0.35, 0.0, abs(fract(a.div(6.2831853).mul(3).add(r.mul(1.4)).sub(time.mul(0.7))).sub(0.5)).sub(0.1));
    const core = exp(r.mul(r).mul(-6));
    const edge = smoothstep(0.08, 0.0, abs(r.sub(0.96)));
    return color(c).mul(arms.mul(float(1).sub(r)).mul(1.4).add(core.mul(1.6)).add(edge.mul(2.5)));
  })();
  const column = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  column.colorNode = Fn(() => {
    const y = positionGeometry.y.add(4).div(8);
    const a = positionGeometry.z.atan(positionGeometry.x);
    const streak = smoothstep(0.8, 1.0, fract(y.mul(2).sub(time.mul(1.2)).add(hash(floor(a.mul(6))).mul(3))));
    return color(c).mul(pow(float(1).sub(y), 2).mul(streak.mul(1.2).add(0.18)));
  })();
  const ringMat = new THREE.MeshBasicNodeMaterial();
  ringMat.colorNode = color(c).mul(3.2);
  const floaters = [];
  for (const [x, z] of [pr.a, pr.b]) {
    const g = new THREE.Group();
    g.position.set(x, terrain.height(x, z), z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), swirl);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 8, 40, 1, true), column);
    col.position.y = 4;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(R * 0.92, 0.07, 8, 64), ringMat);
    halo.position.y = 4.5;
    halo.rotation.x = Math.PI / 2;
    const glow = glowDisc(R * 2.4, pr.color, 0.35);
    glow.position.y = 0.03;
    g.add(glow, disc, ring, col, halo);
    group.add(g);
    floaters.push(halo);
  }
  return (dt, t) => {
    floaters.forEach((h, i) => {
      h.position.y = 4.5 + Math.sin(t * 1.6 + i) * 0.6;
      h.rotation.z += dt * 1.3;
      h.rotation.x = Math.PI / 2 + Math.sin(t * 0.9 + i) * 0.2;
    });
  };
}

// ---------------------------------------------------------------- reactor lasers

function sweeper(s, group, pal) {
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);
  const arms = new THREE.Group();
  g.add(arms);
  const L = s.len - s.inner;
  const lc = new THREE.Color(pal.laser);
  const core = new THREE.MeshBasicNodeMaterial();
  core.colorNode = Fn(() => mix(color(lc), vec3(1, 1, 1), 0.45).mul(sin(time.mul(40)).mul(0.12).add(5.0)))();
  const halo = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  halo.colorNode = Fn(() => {
    const q = positionGeometry.yz.mul(2).length();
    return color(lc).mul(exp(q.mul(q).mul(-4)).mul(0.9));
  })();
  const wake = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  wake.colorNode = Fn(() => {
    const p = positionGeometry.xy;
    const a = p.y.atan(p.x).negate().div(0.7); // 0 at the arm, 1 at the tail of the wake
    const r = p.length().div(s.len);
    return color(lc).mul(pow(float(1).sub(a.clamp(0, 1)), 3).mul(0.35).mul(smoothstep(s.inner / s.len, 0.3, r)));
  })();
  for (let k = 0; k < s.arms; k++) {
    const arm = new THREE.Group();
    arm.rotation.y = -(k * 2 * Math.PI) / s.arms;
    const c = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.14), core);
    c.position.set(s.inner + L / 2, 0.75, 0);
    const h = new THREE.Mesh(new THREE.BoxGeometry(L, 1.3, 1.3), halo);
    h.position.copy(c.position);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), neon(pal.laser, 5));
    tip.position.set(s.len, 0.75, 0);
    const w = new THREE.Mesh(new THREE.CircleGeometry(s.len, 40, -0.7, 0.7), wake);
    w.rotation.x = Math.PI / 2;
    w.position.y = 0.06;
    arm.add(c, h, tip, w);
    arms.add(arm);
  }
  // warning ring painted on the floor at the sweep radius
  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  ringMat.colorNode = Fn(() => {
    const a = positionGeometry.y.atan(positionGeometry.x);
    const dash = step(0.5, fract(a.mul(40 / 6.2831853).add(time.mul(0.4))));
    return color(pal.hazard).mul(dash.mul(1.4).add(0.2));
  })();
  const ring = new THREE.Mesh(new THREE.RingGeometry(s.len + 0.2, s.len + 0.8, 160), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  group.add(g);
  return (dt, t, sim) => {
    const live = sim && sim.sweepers[0];
    const a = live ? live.angles[0] : s.phase + s.speed * t;
    arms.rotation.y = -a;
  };
}

// ---------------------------------------------------------------- pickups

const PICKUP_SHAPES = {
  boost: () => new THREE.OctahedronGeometry(0.8),
  jump: () => { const g = new THREE.ConeGeometry(0.7, 1.4, 4); g.translate(0, 0.1, 0); return g; },
  ghost: () => new THREE.IcosahedronGeometry(0.8, 0),
};

function pickups(map, terrain, group, pal) {
  const items = map.pickups.map((p) => {
    const c = new THREE.Color(pal.pickup[p.type]);
    const g = new THREE.Group();
    const y = terrain.height(p.x, p.z) + 1.3;
    g.position.set(p.x, y, p.z);
    const coreMat = new THREE.MeshBasicNodeMaterial({ transparent: p.type === 'ghost', opacity: 0.85 });
    coreMat.colorNode = Fn(() => color(c).mul(sin(time.mul(4)).mul(0.6).add(3.2)))();
    const core = new THREE.Mesh(PICKUP_SHAPES[p.type](), coreMat);
    const ringMat = new THREE.MeshBasicNodeMaterial();
    ringMat.colorNode = color(c).mul(2.4);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.05, 6, 48), ringMat);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.03, 6, 48), ringMat);
    const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    beamMat.colorNode = Fn(() => color(c).mul(pow(float(1).sub(positionGeometry.y.add(4).div(8)), 2).mul(0.35)))();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 8, 12, 1, true), beamMat);
    shaft.position.y = 4 - 1.3;
    const glow = glowDisc(2.6, pal.pickup[p.type], 0.55);
    glow.position.y = -1.25;
    g.add(core, ring, ring2, shaft, glow);
    group.add(g);
    return { p, g, core, ring, ring2, y, shown: 1 };
  });
  return (dt, t, sim) => {
    const live = sim ? sim.pickups : null;
    items.forEach((it, i) => {
      const active = live ? live[i].active : true;
      it.shown += ((active ? 1 : 0) - it.shown) * Math.min(1, dt * 8);
      it.g.visible = it.shown > 0.02;
      it.g.scale.setScalar(Math.max(0.001, it.shown));
      it.g.position.y = it.y + Math.sin(t * 2.2 + i) * 0.25;
      it.core.rotation.y += dt * 1.6;
      it.core.rotation.x = Math.sin(t + i) * 0.3;
      it.ring.rotation.x = t * 1.1 + i;
      it.ring.rotation.y = t * 0.7;
      it.ring2.rotation.x = -t * 0.8;
      it.ring2.rotation.z = t * 0.5 + i;
    });
  };
}

// Displaced ground mesh for an arena whose floor has swells (bumps); pits are cut in the shader.
export function terrainGround(map, terrain, mat, cell = 1.5) {
  const size = map.half * 2;
  const segs = Math.round(size / cell);
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const bumps = terrain.features.filter((f) => f.type === 'bump');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h = 0;
    for (const b of bumps) h = Math.max(h, b.h(x, z));
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  return m;
}

export { max, cos, vec2 };
