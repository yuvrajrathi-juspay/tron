import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, uniform, float, vec3, color, mix, smoothstep, abs, fract, positionGeometry, normalGeometry, normalView,
  positionView, pow, dot, normalize, max, sin, time, exp, step, attribute,
} from 'three/tsl';

// Profile of the light-cycle shell, in (u = metres back from the nose, v = height).
// The nose sits at the rider's simulated position so collisions line up with what you see.
const FRONT_U = 0.62, REAR_U = 2.42, WHEEL_R = 0.5;
export const BIKE_LENGTH = 3.0;

function shellShape() {
  const s = new THREE.Shape();
  s.moveTo(0.0, 0.42);
  s.quadraticCurveTo(0.02, 0.92, 0.38, 0.99);
  s.lineTo(0.95, 1.03);
  s.quadraticCurveTo(1.22, 1.03, 1.42, 0.8);
  s.lineTo(1.86, 0.78);
  s.quadraticCurveTo(2.06, 0.8, 2.34, 1.06);
  s.quadraticCurveTo(2.96, 1.06, 3.0, 0.56);
  s.lineTo(3.0, 0.4);
  s.quadraticCurveTo(2.95, 0.26, 2.5, 0.26);
  s.lineTo(0.6, 0.23);
  s.quadraticCurveTo(0.06, 0.24, 0.0, 0.42);
  return s;
}

const SHELL_W = 0.16;
const BEVEL = 0.08;
const HALF_W = SHELL_W / 2 + BEVEL;

let shared = null;
function sharedGeometry() {
  if (shared) return shared;
  const shell = new THREE.ExtrudeGeometry(shellShape(), {
    depth: SHELL_W, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.05, bevelSegments: 4, curveSegments: 20,
  });
  shell.translate(0, 0, -SHELL_W / 2);
  shell.rotateY(-Math.PI / 2); // shape u -> +z (backwards), extrusion -> x
  // sculpt the cross-section: narrow, rounded spine up top, tapering toward nose and tail
  const sp = shell.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), v = sp.getY(i), u = sp.getZ(i);
    const t = Math.min(1, Math.max(0, (v - 0.5) / 0.58));
    const top = 1 - 0.55 * t * t * (3 - 2 * t);
    const ends = 0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, Math.max(0, u / 3)));
    sp.setX(i, x * top * ends);
  }
  shell.computeVertexNormals();

  const tire = new THREE.TorusGeometry(0.33, 0.17, 16, 48);
  tire.rotateY(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.4, 0.022, 8, 56);
  rim.rotateY(Math.PI / 2);
  const tread = new THREE.TorusGeometry(0.5, 0.012, 6, 64);
  tread.rotateY(Math.PI / 2);
  const disc = new THREE.CircleGeometry(0.3, 40);
  disc.rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.44, 16);
  hub.rotateZ(Math.PI / 2);

  const stripeCurve = (side) => new THREE.CatmullRomCurve3([
    [0.06, 0.52], [0.3, 0.86], [0.9, 0.92], [1.36, 0.72], [1.9, 0.7], [2.36, 0.95], [2.93, 0.55],
  ].map(([u, v]) => new THREE.Vector3(side * (HALF_W + 0.004), v, u)));
  const stripeL = new THREE.TubeGeometry(stripeCurve(-1), 64, 0.02, 6, false);
  const stripeR = new THREE.TubeGeometry(stripeCurve(1), 64, 0.02, 6, false);
  const spine = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    [0.25, 1.0], [0.95, 1.07], [1.2, 1.0],
  ].map(([u, v]) => new THREE.Vector3(0, v, u))), 24, 0.025, 6, false);
  const spineRear = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    [2.1, 0.9], [2.4, 1.1], [2.95, 0.62],
  ].map(([u, v]) => new THREE.Vector3(0, v, u))), 24, 0.025, 6, false);

  const tail = new THREE.BoxGeometry(0.3, 0.05, 0.05);
  const canopy = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.2, 0.18, 0.56);
  const helmet = new THREE.SphereGeometry(0.16, 24, 16);
  helmet.scale(1, 0.95, 1.2);
  const torso = new THREE.CapsuleGeometry(0.14, 0.42, 6, 14);
  torso.rotateX(Math.PI / 2 - 0.25);
  const exhaust = new THREE.ConeGeometry(0.11, 1.6, 20, 1, true);
  exhaust.rotateX(Math.PI / 2); // tip toward +z
  exhaust.translate(0, 0, 0.8);
  const glow = new THREE.PlaneGeometry(3.6, 4.6);
  glow.rotateX(-Math.PI / 2);

  // Merge everything that shares a material into one draw each: the wheel parts are round,
  // so spinning is shown by the shaders (spokes, dashed rings) rather than by rotating meshes.
  const at = (geo, x, u) => geo.clone().translate(x, WHEEL_R, u);
  const neonAll = mergeGeometries([stripeL, stripeR, spine, spineRear,
    ...[FRONT_U, REAR_U].flatMap((u) => [at(rim, 0.175, u), at(rim, -0.175, u), at(tread, 0, u)])].map((q) => q.toNonIndexed()));
  const tires = mergeGeometries([at(tire, 0, FRONT_U), at(tire, 0, REAR_U)].map((q) => q.toNonIndexed()));
  const hubs = mergeGeometries([at(hub, 0, FRONT_U), at(hub, 0, REAR_U)].map((q) => q.toNonIndexed()));
  const discParts = [];
  for (const u of [FRONT_U, REAR_U]) {
    for (const x of [0.178, -0.178]) {
      const d = disc.clone().toNonIndexed();
      const dp = d.attributes.position, loc = new Float32Array(dp.count * 2);
      for (let i = 0; i < dp.count; i++) { loc[i * 2] = dp.getY(i); loc[i * 2 + 1] = dp.getZ(i); }
      d.setAttribute('dloc', new THREE.BufferAttribute(loc, 2));
      discParts.push(d.translate(x, WHEEL_R, u));
    }
  }
  const discs = mergeGeometries(discParts);

  shared = { shell, neonAll, tires, hubs, discs, tail, canopy, helmet, torso, exhaust, glow };
  return shared;
}

// Builds one light cycle. Returns the root plus the handles the view animates.
export function createBike(hex) {
  const g = sharedGeometry();
  const tint = new THREE.Color(hex);
  const u = {
    color: uniform(tint.clone()),
    wheel: uniform(0),       // wheel spin angle
    boost: uniform(0),
    flash: uniform(0),       // brief white-hot flash (jump ready, landing)
    grind: uniform(0),
    brake: uniform(0),
  };

  // Body: dark gunmetal with a fresnel rim in the rider's colour, glowing wheel rings
  // that spin with the wheels, and panel seams.
  const body = new THREE.MeshPhysicalNodeMaterial({
    color: 0x0c1220, metalness: 0.9, roughness: 0.26, clearcoat: 0.8, clearcoatRoughness: 0.18,
  });
  body.emissiveNode = Fn(() => {
    const p = positionGeometry;
    const n = normalGeometry;
    const side = smoothstep(0.55, 0.85, abs(n.x));
    const ring = (wc) => {
      const d = vec3(0, p.y.sub(WHEEL_R), p.z.sub(wc));
      const r = d.length();
      const ang = d.y.atan(d.z).add(u.wheel);
      const dash = smoothstep(0.1, 0.2, abs(fract(ang.mul(6 / 6.2831853)).sub(0.5)));
      const band = smoothstep(0.035, 0.0, abs(r.sub(0.42))).mul(dash.mul(0.6).add(0.4));
      const inner = smoothstep(0.02, 0.0, abs(r.sub(0.3))).mul(0.5);
      const hubDot = smoothstep(0.1, 0.06, r).mul(0.8);
      return band.add(inner).add(hubDot);
    };
    const rings = ring(FRONT_U).add(ring(REAR_U)).mul(side);
    const seams = smoothstep(0.012, 0.0, abs(p.z.sub(1.62))).add(smoothstep(0.012, 0.0, abs(p.z.sub(0.18))))
      .mul(0.35).mul(side);
    const nv = normalize(normalView);
    const vv = normalize(positionView.negate());
    const fres = pow(float(1).sub(max(dot(nv, vv), 0)), 3.0);
    const heat = u.boost.mul(smoothstep(2.2, 3.0, p.z)).mul(0.8);
    return u.color.mul(rings.mul(3.2).add(seams).add(fres.mul(0.55)).add(heat))
      .add(vec3(1, 1, 1).mul(u.flash.mul(0.8)));
  })();

  const neon = new THREE.MeshBasicNodeMaterial();
  neon.colorNode = Fn(() => u.color.mul(float(2.6).add(u.boost.mul(1.6))).add(vec3(1).mul(u.flash.mul(2))))();

  const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x07080b, metalness: 0.1, roughness: 0.85 });

  const discMat = new THREE.MeshStandardNodeMaterial({ color: 0x080b12, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide });
  discMat.emissiveNode = Fn(() => {
    const p = attribute('dloc', 'vec2'); // position within its own wheel disc
    const r = p.length();
    const ang = p.x.atan(p.y).add(u.wheel);
    const spokes = smoothstep(0.82, 1.0, abs(sin(ang.mul(3)))).mul(smoothstep(0.08, 0.14, r)).mul(0.5);
    const rim = smoothstep(0.02, 0.0, abs(r.sub(0.27))).add(smoothstep(0.015, 0.0, abs(r.sub(0.18))).mul(0.6));
    return u.color.mul(rim.mul(2.4).add(spokes));
  })();

  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x9aa4b4, metalness: 1.0, roughness: 0.3 });

  const glass = new THREE.MeshPhysicalNodeMaterial({
    color: 0x0a1a28, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03,
    transparent: true, opacity: 0.55, depthWrite: false,
  });
  glass.emissiveNode = Fn(() => {
    const nv = normalize(normalView);
    const vv = normalize(positionView.negate());
    const fres = pow(float(1).sub(max(dot(nv, vv), 0)), 2.5);
    return u.color.mul(fres.mul(0.22));
  })();

  // Rider suit: black with light lines, the classic look.
  const suit = new THREE.MeshStandardNodeMaterial({ color: 0x07090f, metalness: 0.5, roughness: 0.45 });
  suit.emissiveNode = Fn(() => {
    const p = positionGeometry;
    // a single light seam down the spine and one across the shoulders
    const spineLine = smoothstep(0.018, 0.0, abs(p.x)).mul(step(0.05, p.y));
    const shoulder = smoothstep(0.012, 0.0, abs(p.z.add(0.18))).mul(step(0.0, p.y));
    return u.color.mul(spineLine.add(shoulder).mul(1.6));
  })();
  const helmetMat = new THREE.MeshPhysicalNodeMaterial({ color: 0x0b0f18, metalness: 0.7, roughness: 0.2, clearcoat: 1 });
  helmetMat.emissiveNode = Fn(() => {
    const p = positionGeometry;
    const visor = smoothstep(0.03, 0.0, abs(p.y.sub(0.01))).mul(smoothstep(0.0, -0.08, p.z));
    return u.color.mul(visor.mul(3.0)).add(vec3(1).mul(visor.mul(0.4)));
  })();

  const tailMat = new THREE.MeshBasicNodeMaterial();
  tailMat.colorNode = Fn(() => mix(vec3(1.0, 0.2, 0.25), u.color, 0.35).mul(float(2.5).add(u.boost.mul(4)).add(u.brake.mul(6))))();

  const exhaustMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  exhaustMat.colorNode = Fn(() => {
    const z = positionGeometry.z.div(1.6); // 0 at nozzle, 1 at tip
    const flick = sin(time.mul(70)).mul(0.15).add(0.85);
    return mix(vec3(0.9, 0.95, 1), u.color, smoothstep(0.0, 0.35, z)).mul(pow(float(1).sub(z), 2.2).mul(u.boost).mul(1.3).mul(flick));
  })();

  const glowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  glowMat.colorNode = Fn(() => {
    const p = positionGeometry;
    const d = vec3(p.x.div(1.8), 0, p.z.div(2.3)).length();
    return u.color.mul(exp(d.mul(d).mul(-5.0)).mul(0.28).mul(float(1).add(u.boost)));
  })();

  const root = new THREE.Group();     // positioned at the nose, yawed to heading
  const lean = new THREE.Group();     // roll and pitch for turns, jumps and boost
  root.add(lean);

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = lean) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  add(g.shell, body);
  add(g.neonAll, neon);
  add(g.tires, rubber);
  add(g.hubs, metal);
  add(g.discs, discMat);
  add(g.tail, tailMat, 0, 0.5, 3.0);
  add(g.canopy, glass, 0, 0.8, 1.52);
  add(g.helmet, helmetMat, 0, 0.98, 1.05);
  add(g.torso, suit, 0, 0.86, 1.5);

  const wheels = [];

  const exhaust = add(g.exhaust, exhaustMat, 0, 0.5, 3.02);
  exhaust.renderOrder = 2;
  const glowPlane = add(g.glow, glowMat, 0, 0.03, 1.5, root);
  glowPlane.renderOrder = 1;

  root.traverse((o) => { o.frustumCulled = true; });
  return { root, lean, wheels, exhaust, glowPlane, u, tint };
}
