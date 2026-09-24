import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, float, vec3, color, mix, smoothstep, fract, abs, positionWorld, positionGeometry, time, sin, pow, normalWorld, exp,
} from 'three/tsl';
import { makeGroundMaterial } from '../materials.js';
import { mountainRing, rim, scatter } from '../scenery.js';
import { buildFeatures, terrainGround } from '../features.js';
import { vrand } from '../../rng.js';

export const MESA_PALETTE = {
  edge: 0xff4fa0, hazard: 0xffae3d, slab: 0x1c0a24, slabLine: 0xff6a3d, top: [0x14061c], pad: 0xffc04d, laser: 0xff3b3b,
  pickup: { boost: 0x3df0ff, jump: 0x9dff4a, ghost: 0xc77dff },
};

// SUNDOWN MESA: a synthwave desert at dusk. The mesa, its ramps, kickers and dunes come from
// the map data; around them sit palms, pyramids, light totems and two ranges of mountains.
export function buildMesa(map, u, terrain) {
  const group = new THREE.Group();
  const H = map.half;
  const theme = {
    half: H, baseA: 0x0f0418, baseB: 0x150620, lineMinor: [0.7, 0.2, 0.05], lineMajor: [1.0, 0.14, 0.5],
    minorGain: 0.24, majorGain: 0.6, heightGlow: 0.45, fadeK: 0.0045, outsideGain: 0.35, poolGain: 0.36,
  };
  const groundMat = makeGroundMaterial(u, theme);
  group.add(terrainGround(map, terrain, groundMat, 1.5));
  // the desert keeps going past the arena, just below its floor
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400), groundMat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.04;
  group.add(outer);

  const feats = buildFeatures(map, terrain, MESA_PALETTE, groundMat);
  group.add(feats.group);

  for (const m of rim(H, { body: 0x1a0822, stripe: [1.4, 0.4, 0.15] })) group.add(m);
  group.add(totems(H));
  group.add(palms());
  group.add(pyramids());
  group.add(mountainRing({ radius: 1380, base: 110, amp: 70, spikes: 30, seed: 3, body: 0x1a0628, ridge: [1.6, 0.35, 0.75], glow: 1.8 }));
  group.add(mountainRing({ radius: 1050, base: 34, amp: 26, spikes: 12, seed: 7.5, body: 0x0d0316, ridge: [1.4, 0.55, 0.2], glow: 1.3, lines: 0.1 }));

  return { group, reflect: [], update: (dt, t, sim) => feats.update(dt, t, sim) };
}

// Roadside light totems around the arena, tinted from hot pink to amber.
function totems(H) {
  const geo = new THREE.BoxGeometry(0.6, 6, 0.6);
  geo.translate(0, 3, 0);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const y = positionGeometry.y.div(6);
    const pulse = sin(time.mul(2.4).sub(positionWorld.x.add(positionWorld.z).mul(0.05))).mul(0.5).add(0.5);
    return mix(vec3(2.4, 0.3, 1.1), vec3(2.6, 1.1, 0.2), y).mul(pow(y, 1.5).mul(pulse.mul(0.7).add(0.3)));
  })();
  const step = 14, d = H + 7;
  const pts = [];
  for (let a = -d; a <= d; a += step) pts.push([a, d], [a, -d], [d, a], [-d, a]);
  return scatter(geo, mat, pts.length, (i) => ({ x: pts[i][0], z: pts[i][1] }));
}

// Procedural palm tree: a curved trunk and a crown of drooping fronds, merged into one geometry.
function palmGeometry() {
  const parts = [];
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 5, 0.1), new THREE.Vector3(1.8, 10, 0.2), new THREE.Vector3(3.2, 14, 0.2),
  ]);
  parts.push(new THREE.TubeGeometry(curve, 20, 0.42, 7, false));
  const top = curve.getPoint(1);
  for (let k = 0; k < 9; k++) {
    const len = 6 + (k % 3);
    const leaf = new THREE.PlaneGeometry(1.9, len, 2, 10);
    leaf.translate(0, len / 2, 0);
    const p = leaf.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = y / len;
      p.setZ(i, t * 1.6 - t * t * 5.2);         // rise, then droop
      p.setX(i, p.getX(i) * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.001); // leaf outline
      p.setY(i, y + Math.abs(p.getX(i)) * 0.35); // slight V fold
    }
    leaf.rotateX(-Math.PI / 2 + 0.25);
    leaf.rotateY((k / 9) * Math.PI * 2 + (k % 2) * 0.2);
    leaf.translate(top.x, top.y, top.z);
    parts.push(leaf);
  }
  const g = BufferGeometryUtils.mergeGeometries(parts.map((q) => q.toNonIndexed()), false);
  g.computeVertexNormals();
  return g;
}

function palms() {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.colorNode = Fn(() => {
    const y = positionWorld.y;
    const rimGlow = smoothstep(9, 15, y).mul(0.35);
    return vec3(0.03, 0.005, 0.03).add(vec3(1.0, 0.25, 0.5).mul(rimGlow));
  })();
  const geo = palmGeometry();
  const n = 70;
  return scatter(geo, mat, n, () => {
    const a = vrand() * Math.PI * 2;
    const r = 175 + Math.pow(vrand(), 0.7) * 260;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 1.1 + vrand() * 1.3, ry: vrand() * Math.PI * 2 };
  });
}

// Giant pyramids on the horizon with glowing edges and slow scanlines.
function pyramids() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const p = positionGeometry;
    const a = p.x.atan(p.z).div(Math.PI / 2);
    const edge = smoothstep(0.44, 0.5, abs(fract(a.add(0.5)).sub(0.5)));
    const scan = smoothstep(0.93, 1.0, fract(positionWorld.y.div(14).sub(time.mul(0.15)))).mul(0.25);
    const top = smoothstep(0.75, 1.0, p.y.div(110).add(0.5)).mul(0.6);
    return vec3(0.035, 0.008, 0.05).add(vec3(1.4, 0.3, 0.8).mul(edge.add(scan).add(top)));
  })();
  for (const [a, r, s] of [[-1.25, 860, 1.0], [-0.9, 1020, 0.7], [2.6, 900, 0.85]]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(95, 110, 4, 1), mat);
    m.scale.setScalar(s);
    m.position.set(Math.cos(a) * r, 55 * s - 2, Math.sin(a) * r);
    m.rotation.y = vrand();
    g.add(m);
  }
  return g;
}

export { color, float, exp, normalWorld };
