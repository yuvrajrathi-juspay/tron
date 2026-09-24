import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, color, mix, smoothstep, fract, abs, positionWorld, positionGeometry, attribute, time, sin, exp,
} from 'three/tsl';
import { vrand } from '../rng.js';

const UP = new THREE.Vector3(0, 1, 0);

// A thin box stretched between two points: neon edges, rails, lasers, struts.
export function beam(a, b, thick, mat, thickY = thick) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.BoxGeometry(thick, thickY, len);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.lookAt(b);
  return m;
}

// A ring of jagged mountains with glowing ridgelines on the horizon.
export function mountainRing({ radius = 1250, base = 70, amp = 55, spikes = 24, seed = 0, body = 0x04050c, ridge = [0.35, 0.3, 1.0], glow = 1.6, lines = 0.06, y0 = -2 }) {
  const seg = 360;
  const pos = [], rid = [], idx = [];
  const noise = (t) => {
    let v = 0;
    for (let o = 1; o <= 5; o++) v += (Math.sin(t * o * 3.1 + o * 1.7 + seed) * Math.cos(t * o * 1.3 + o + seed * 2)) / o;
    return v;
  };
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const h = base + noise(t) * amp + Math.abs(Math.sin(t * 17 + seed)) * spikes + vrand() * 10;
    const x = Math.cos(t) * radius, z = Math.sin(t) * radius;
    pos.push(x, y0, z, x, Math.max(20, h), z);
    rid.push(0, 1);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('ridge', new THREE.Float32BufferAttribute(rid, 1));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  const r = attribute('ridge', 'float');
  mat.colorNode = Fn(() => {
    const gl = smoothstep(0.965, 1.0, r).mul(glow).add(smoothstep(0.7, 1.0, r).mul(0.08));
    const ln = smoothstep(0.93, 1.0, fract(positionWorld.y.div(9))).mul(lines).mul(r);
    return color(body).add(vec3(...ridge).mul(gl.add(ln)));
  })();
  return new THREE.Mesh(g, mat);
}

// The curb around an arena, with a glowing stripe.
export function rim(half, { body = 0x0a0e18, stripe = [0.35, 0.9, 1.2], height = 0.6, depth = 1.6 } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ color: body, metalness: 0.8, roughness: 0.35 });
  mat.emissiveNode = Fn(() => {
    const y = positionGeometry.y;
    const s = smoothstep(0.02, 0.0, abs(y.sub(height * 0.47))).add(smoothstep(0.03, 0.0, abs(y.sub(0.05))).mul(0.4));
    return vec3(...stripe).mul(s.mul(2.4));
  })();
  const L = half * 2 + depth * 2;
  const geo = new THREE.BoxGeometry(L, height, depth);
  geo.translate(0, height / 2, 0);
  const meshes = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(geo, mat);
    const a = (i * Math.PI) / 2;
    m.position.set(Math.sin(a) * (half + depth / 2), 0, Math.cos(a) * (half + depth / 2));
    m.rotation.y = a;
    meshes.push(m);
  }
  return meshes;
}

// Instanced scatter helper: fn(i) -> { x, y, z, s (scale or [sx,sy,sz]), ry }
export function scatter(geo, mat, n, fn) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const o = fn(i);
    p.set(o.x, o.y ?? 0, o.z);
    if (o.rot) e.set(o.rot[0], o.rot[1], o.rot[2]);
    else e.set(0, o.ry ?? 0, 0);
    q.setFromEuler(e);
    if (Array.isArray(o.s)) s.set(o.s[0], o.s[1], o.s[2]);
    else s.setScalar(o.s ?? 1);
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// Additive glow sprite-like disc facing up (for soft light pools and halos).
export function glowDisc(radius, hex, gain = 0.4) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const c = new THREE.Color(hex);
  mat.colorNode = Fn(() => {
    const r = positionGeometry.xy.length().div(radius);
    return color(c).mul(exp(r.mul(r).mul(-4)).mul(gain));
  })();
  const g = new THREE.CircleGeometry(radius, 48);
  const m = new THREE.Mesh(g, mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export { UP, float, mix, time, sin };
