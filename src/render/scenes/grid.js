import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, color, mix, smoothstep, fract, abs, exp, hash, positionWorld, positionGeometry, attribute, time,
  sin, floor, step, normalWorld, pow,
} from 'three/tsl';
import { makeGroundMaterial } from '../materials.js';
import { mountainRing, rim } from '../scenery.js';
import { vrand } from '../../rng.js';

// THE GRID: the classic arena. Mirror floor, grandstands, pylons, city skyline, the Core.
export function buildGrid(map, u) {
  const H = map.half;
  const group = new THREE.Group();
  const reflect = [];

  const floorMat = makeGroundMaterial(u, {
    half: H, transparent: true, emblem: true,
    baseA: 0x04060d, baseB: 0x070b16, lineMinor: [0.05, 0.42, 0.62], lineMajor: [0.1, 0.7, 1.0], emblemColor: [0.2, 0.8, 1.0], minorGain: 0.22, majorGain: 0.55,
  });
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.renderOrder = -1;
  group.add(floorMesh);

  for (const m of rim(H)) {
    group.add(m);
    reflect.push(m.clone());
  }

  buildStands(group, H);
  buildPylons(group, H);
  buildCity(group);
  group.add(mountainRing({}));
  const core = buildCore(group);

  return {
    group,
    reflect,
    update(dt) {
      core.ring.rotation.z += dt * 0.03;
      core.ring2.rotation.z -= dt * 0.018;
    },
  };
}

// Tiered grandstands on all four sides with a twinkling crowd of phone lights.
function buildStands(group, H) {
  const shape = new THREE.Shape();
  const steps = 7, sd = 4.2, sh = 2.2;
  shape.moveTo(0, 0);
  for (let s = 0; s < steps; s++) {
    shape.lineTo(s * sd, (s + 1) * sh);
    shape.lineTo((s + 1) * sd, (s + 1) * sh);
  }
  shape.lineTo(steps * sd + 3, steps * sh + 6);
  shape.lineTo(steps * sd + 5, steps * sh + 6);
  shape.lineTo(steps * sd + 5, 0);
  shape.lineTo(0, 0);
  const len = H * 2 + 40;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  geo.rotateY(-Math.PI / 2); // steps climb outward along +z
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x0b1020, metalness: 0.6, roughness: 0.55 });
  mat.emissiveNode = Fn(() => {
    const y = positionGeometry.y;
    const lip = smoothstep(0.12, 0.0, abs(fract(y.div(sh)).sub(0.0))).mul(step(0.5, normalWorld.y));
    const riser = smoothstep(0.08, 0.0, abs(fract(y.div(sh).add(0.5)).sub(0.5))).mul(0.25);
    const x = positionWorld.x.add(positionWorld.z);
    const pulse = sin(x.mul(0.05).sub(time.mul(1.2))).mul(0.5).add(0.5);
    return vec3(0.15, 0.55, 1.0).mul(lip.mul(1.4).add(riser)).mul(pulse.mul(0.6).add(0.5));
  })();
  const off = H + 9;
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(geo, mat);
    const a = (i * Math.PI) / 2;
    m.rotation.y = a;
    m.position.set(Math.sin(a) * off, 0, Math.cos(a) * off);
    group.add(m);
  }

  // crowd lights
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const side = k % 4;
    const s = Math.floor(vrand() * steps);
    const along = (vrand() - 0.5) * (len - 12);
    const depth = off + s * sd + 0.6 + vrand() * (sd - 1.2);
    const y = (s + 1) * sh + 0.5 + vrand() * 0.4;
    const a = (side * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    pos[k * 3] = sa * depth + ca * along;
    pos[k * 3 + 1] = y;
    pos[k * 3 + 2] = ca * depth - sa * along;
    seed[k] = vrand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const pm = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const sd_ = attribute('seed', 'float');
  const hue = mix(mix(color(0x9fe8ff), color(0xff9ad8), step(0.6, sd_)), color(0xffd08a), step(0.85, sd_));
  const tw = sin(time.mul(sd_.mul(4).add(1.5)).add(sd_.mul(60))).mul(0.5).add(0.5);
  pm.colorNode = hue.mul(tw.mul(1.6).add(0.2));
  pm.sizeNode = float(0.55);
  group.add(new THREE.Points(g, pm));
}

// Corner pylons with beacons and a light beam: landmarks for orientation.
function buildPylons(group, H) {
  const body = new THREE.MeshStandardNodeMaterial({ color: 0x0c1122, metalness: 0.85, roughness: 0.3 });
  body.emissiveNode = Fn(() => {
    const y = positionGeometry.y;
    const bands = smoothstep(0.15, 0.0, abs(fract(y.div(6)).sub(0.5))).mul(0.8);
    return vec3(0.3, 0.8, 1.3).mul(bands);
  })();
  const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  beamMat.colorNode = Fn(() => {
    const y = positionGeometry.y.div(260).add(0.5);
    return vec3(0.25, 0.75, 1.0).mul(pow(float(1).sub(y), 2.5).mul(0.16));
  })();
  const beaconMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  beaconMat.colorNode = Fn(() => vec3(1.0, 0.25, 0.3).mul(sin(time.mul(3.2)).mul(0.5).add(0.5).mul(6).add(0.5)))();
  const shaft = new THREE.CylinderGeometry(1.2, 2.4, 60, 6, 1);
  shaft.translate(0, 30, 0);
  const cap = new THREE.OctahedronGeometry(1.4);
  const beamG = new THREE.CylinderGeometry(7, 1.2, 260, 20, 1, true);
  const d = H + 48;
  for (const [x, z] of [[d, d], [-d, d], [d, -d], [-d, -d]]) {
    const p = new THREE.Mesh(shaft, body);
    p.position.set(x, 0, z);
    const c = new THREE.Mesh(cap, beaconMat);
    c.position.set(x, 62, z);
    const b = new THREE.Mesh(beamG, beamMat);
    b.position.set(x, 62 + 130, z);
    group.add(p, c, b);
  }
}

// Instanced megastructure skyline with procedural window grids.
function buildCity(group) {
  const n = 180;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x05070e, metalness: 0.7, roughness: 0.5 });
  mat.emissiveNode = Fn(() => {
    const w = positionWorld;
    const cellA = floor(vec3(w.x.div(3.2), w.y.div(4.0), w.z.div(3.2)));
    const r = hash(cellA.x.mul(7).add(cellA.y.mul(131)).add(cellA.z.mul(17)));
    const lit = step(0.72, r);
    const f = fract(vec2(w.x.add(w.z).div(3.2), w.y.div(4.0)));
    const pane = step(0.25, f.x).mul(step(f.x, 0.8)).mul(step(0.3, f.y)).mul(step(f.y, 0.75));
    const side = float(1).sub(abs(normalWorld.y));
    const warm = mix(color(0x6fd6ff), color(0xffb36b), step(0.9, r));
    return warm.mul(lit.mul(pane).mul(side).mul(0.9));
  })();
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = vrand() * Math.PI * 2;
    const r = 330 + vrand() * 520;
    const h = 30 + Math.pow(vrand(), 1.8) * 220;
    const wdt = 14 + vrand() * 30;
    p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(vrand() * 4) * (Math.PI / 2) + (vrand() - 0.5) * 0.2);
    s.set(wdt, h, wdt * (0.6 + vrand() * 0.8));
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
}

// "The Core": a vast slow-turning halo in the sky, the arena's landmark.
function buildCore(group) {
  const grp = new THREE.Group();
  grp.position.set(-260, 330, -1100);
  grp.lookAt(0, 60, 0);
  const ringMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  ringMat.colorNode = Fn(() => {
    const a = positionGeometry.y.atan(positionGeometry.x);
    const seg = smoothstep(0.1, 0.0, abs(fract(a.mul(12 / 6.2831853).add(time.mul(0.05))).sub(0.5)).sub(0.4));
    return mix(vec3(0.3, 0.85, 1.5), vec3(1.4, 0.35, 1.2), seg).mul(1.8);
  })();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(210, 3.2, 12, 180), ringMat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(236, 0.9, 8, 180), ringMat);
  const haloMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  haloMat.colorNode = Fn(() => {
    const r = positionGeometry.xy.length().div(300);
    const g = exp(abs(r.sub(0.7)).mul(-14)).mul(0.35).add(exp(r.mul(-5)).mul(0.06));
    return vec3(0.25, 0.4, 1.0).mul(g);
  })();
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), haloMat);
  grp.add(halo, ring, ring2);
  group.add(grp);
  return { ring, ring2 };
}
