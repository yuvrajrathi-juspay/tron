import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, color, mix, smoothstep, fract, abs, positionWorld, positionGeometry, time, sin, pow, normalWorld, exp,
  normalView, positionView, normalize, dot, max, uv, clamp, hash, floor,
} from 'three/tsl';
import { makeGroundMaterial } from '../materials.js';
import { rim, scatter, beam } from '../scenery.js';
import { buildFeatures, terrainGround } from '../features.js';
import { vrand } from '../../rng.js';

export const ORBITAL_PALETTE = {
  edge: 0x8a6bff, hazard: 0xffb020, slab: 0x0b0d18, slabLine: 0x5ad8ff, top: [0x080a14], pad: 0x2ef2d0, laser: 0xff3355,
  voidGlow: 0x3a1aa0, pickup: { boost: 0x3df0ff, jump: 0x9dff4a, ghost: 0xc77dff },
};

// ORBITAL RIFT: a station deck floating in deep space under a ringed gas giant.
export function buildOrbital(map, u, terrain) {
  const group = new THREE.Group();
  const H = map.half;
  const pits = terrain.features.filter((f) => f.type === 'pit').map((f) => ({ x: f.x, z: f.z, w: f.w, d: f.d }));
  const groundMat = makeGroundMaterial(u, {
    half: H, pattern: 'hex', baseA: 0x06080e, baseB: 0x0c1020, lineMinor: [0.1, 0.9, 0.8], lineMajor: [0.32, 0.26, 1.0],
    minorGain: 0.3, majorGain: 0.45, heightGlow: 0.3, outsideGain: 0.0, poolGain: 0.4, pits, fadeK: 0.005,
  });
  group.add(terrainGround(map, terrain, groundMat, 1.5));

  const feats = buildFeatures(map, terrain, ORBITAL_PALETTE, groundMat);
  group.add(feats.group);

  for (const m of rim(H, { body: 0x0b0d18, stripe: [0.45, 0.35, 1.4], height: 0.7 })) group.add(m);
  group.add(deckSlab(H));
  group.add(trusses(H));
  const towers = antennaTowers(H);
  group.add(towers);
  const planet = gasGiant();
  group.add(planet.group);
  const belt = asteroids();
  group.add(belt);

  return {
    group,
    reflect: [],
    update(dt, t, sim) {
      feats.update(dt, t, sim);
      planet.ring.rotation.z += dt * 0.004;
      planet.body.rotation.y += dt * 0.006;
      belt.rotation.y += dt * 0.004;
    },
  };
}

// The deck is a slab floating in space: its edges show thickness and running lights.
function deckSlab(H) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x0a0c16, metalness: 0.8, roughness: 0.4 });
  mat.emissiveNode = Fn(() => {
    const y = positionWorld.y;
    const along = positionWorld.x.add(positionWorld.z);
    const lights = smoothstep(0.3, 0.0, abs(y.add(2.2))).mul(step01(fract(along.div(6).sub(time.mul(0.5)))));
    const band = smoothstep(0.08, 0.0, abs(y.add(0.6))).mul(0.6);
    return vec3(0.3, 0.8, 1.2).mul(lights.mul(1.8).add(band));
  })();
  const T = 5, L = H * 2 + 6;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, T, 3), mat);
    m.position.set(Math.sin(a) * (H + 1.5), -T / 2, Math.cos(a) * (H + 1.5));
    m.rotation.y = a;
    g.add(m);
  }
  // underside panel so the deck reads as solid from the edge
  const under = new THREE.Mesh(new THREE.PlaneGeometry(L, L), new THREE.MeshBasicNodeMaterial({ color: 0x04050a }));
  under.rotation.x = Math.PI / 2;
  under.position.y = -T;
  g.add(under);
  return g;
}
const step01 = (x) => smoothstep(0.45, 0.5, x).mul(smoothstep(0.62, 0.57, x));

// Structural trusses hanging below the deck edge.
function trusses(H) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x131726, metalness: 0.9, roughness: 0.35 });
  mat.emissiveNode = Fn(() => vec3(0.12, 0.1, 0.4).mul(smoothstep(0.9, 1.0, fract(positionWorld.y.mul(0.5).sub(time.mul(0.3))))))();
  const d = H + 9, y0 = -9, y1 = -17;
  const strut = new THREE.BoxGeometry(0.6, 0.6, 1);
  const pts = [];
  for (let side = 0; side < 4; side++) {
    const a = (side * Math.PI) / 2;
    const ox = Math.sin(a), oz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
    for (const yy of [y0, y1]) g.add(beam(new THREE.Vector3(ox * d - tx * d, yy, oz * d - tz * d), new THREE.Vector3(ox * d + tx * d, yy, oz * d + tz * d), 0.9, mat));
    for (let s = -d; s < d; s += 10) {
      const p0 = new THREE.Vector3(ox * d + tx * s, y0, oz * d + tz * s);
      const p1 = new THREE.Vector3(ox * d + tx * (s + 10), y1, oz * d + tz * (s + 10));
      pts.push([p0, p1]);
      const p2 = new THREE.Vector3(ox * (H + 2) + tx * s, -5, oz * (H + 2) + tz * s);
      pts.push([p2, p0]);
    }
  }
  const tmp = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(strut, mat, pts.length);
  pts.forEach(([a, b], i) => {
    tmp.position.copy(a).lerp(b, 0.5);
    tmp.lookAt(b);
    tmp.scale.set(1, 1, a.distanceTo(b));
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
  });
  mesh.frustumCulled = false;
  g.add(mesh);
  return g;
}

// Corner antenna masts with blinking beacons.
function antennaTowers(H) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardNodeMaterial({ color: 0x10131f, metalness: 0.9, roughness: 0.3 });
  body.emissiveNode = Fn(() => vec3(0.35, 0.3, 1.2).mul(smoothstep(0.12, 0.0, abs(fract(positionWorld.y.div(8)).sub(0.5)).sub(0.4))))();
  const blink = new THREE.MeshBasicNodeMaterial({ fog: false });
  blink.colorNode = Fn(() => vec3(1.0, 0.2, 0.3).mul(step01(fract(time.mul(0.8))).mul(8).add(0.3)))();
  const d = H + 16;
  for (const [x, z] of [[d, d], [-d, d], [d, -d], [-d, -d]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.8, 70, 8), body);
    mast.position.set(x, 30, z);
    g.add(mast);
    for (const yy of [18, 36, 52]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.25, 6, 24), body);
      ring.position.set(x, yy, z);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), blink);
    bulb.position.set(x, 66, z);
    g.add(bulb);
  }
  return g;
}

// A banded gas giant with an atmosphere rim and a tilted ring system.
function gasGiant() {
  const group = new THREE.Group();
  group.position.set(-820, 420, -1250);
  const bodyMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  const sun = new THREE.Vector3(0.55, 0.3, 0.6).normalize();
  bodyMat.colorNode = Fn(() => {
    const p = normalize(positionGeometry);
    const lat = p.y;
    const wob = sin(p.x.mul(6).add(p.z.mul(4))).mul(0.05).add(sin(lat.mul(40).add(p.x.mul(3))).mul(0.02));
    const bands = sin(lat.add(wob).mul(22)).mul(0.5).add(0.5);
    const bands2 = sin(lat.add(wob.mul(2)).mul(57)).mul(0.5).add(0.5);
    const a = mix(vec3(0.28, 0.1, 0.42), vec3(0.85, 0.38, 0.2), bands);
    const col = mix(a, vec3(0.12, 0.06, 0.25), bands2.mul(0.45));
    const n = normalize(normalWorld);
    const lit = smoothstep(-0.25, 0.6, dot(n, vec3(sun.x, sun.y, sun.z)));
    const fres = pow(float(1).sub(max(dot(normalize(normalView), normalize(positionView.negate())), 0)), 3);
    return col.mul(lit.mul(0.75).add(0.03)).add(vec3(0.45, 0.3, 1.0).mul(fres.mul(0.9).mul(lit.add(0.2))));
  })();
  const body = new THREE.Mesh(new THREE.SphereGeometry(360, 64, 48), bodyMat);
  group.add(body);
  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  ringMat.colorNode = Fn(() => {
    const r = positionGeometry.xy.length().div(760);
    const bands = sin(r.mul(180)).mul(0.5).add(0.5).mul(sin(r.mul(47)).mul(0.3).add(0.7));
    return mix(vec3(0.7, 0.5, 0.4), vec3(0.4, 0.3, 0.8), r).mul(bands.mul(0.7).add(0.08));
  })();
  ringMat.opacityNode = Fn(() => {
    const r = positionGeometry.xy.length().div(760);
    const gap = smoothstep(0.02, 0.0, abs(r.sub(0.83)));
    return smoothstep(0.62, 0.66, r).mul(smoothstep(1.0, 0.95, r)).mul(float(1).sub(gap)).mul(0.75);
  })();
  const ring = new THREE.Mesh(new THREE.RingGeometry(470, 760, 160, 1), ringMat);
  ring.rotation.set(-1.25, 0.25, 0);
  group.add(ring);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 24), new THREE.MeshBasicNodeMaterial({ fog: false }));
  moon.material.colorNode = Fn(() => {
    const n = normalize(normalWorld);
    return vec3(0.42, 0.42, 0.52).mul(smoothstep(-0.1, 0.7, dot(n, vec3(sun.x, sun.y, sun.z))).mul(0.8).add(0.02));
  })();
  moon.position.set(620, -120, 380);
  group.add(moon);
  return { group, body, ring };
}

// A slow belt of rocks drifting around the station.
function asteroids() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 0.75 + 0.35 * Math.abs(Math.sin(v.x * 4.1 + v.y * 2.3) * Math.cos(v.z * 3.7));
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2630, metalness: 0.2, roughness: 0.9 });
  mat.emissiveNode = Fn(() => {
    const fres = pow(float(1).sub(max(dot(normalize(normalView), normalize(positionView.negate())), 0)), 3);
    return vec3(0.25, 0.15, 0.55).mul(fres.mul(0.6));
  })();
  return scatter(geo, mat, 160, () => {
    const a = vrand() * Math.PI * 2;
    const r = 330 + vrand() * 700;
    const s = 3 + Math.pow(vrand(), 2.5) * 30;
    return { x: Math.cos(a) * r, y: -140 + vrand() * 380, z: Math.sin(a) * r, s: [s, s * (0.6 + vrand() * 0.6), s * (0.7 + vrand() * 0.5)], rot: [vrand() * 6, vrand() * 6, vrand() * 6] };
  });
}

export { color, exp, uv, clamp, hash, floor };
