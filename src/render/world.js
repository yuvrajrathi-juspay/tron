import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, vec3, color, mix, smoothstep, fract, abs, exp, hash, positionWorld, positionGeometry,
  cameraPosition, sin, floor, clamp, step, pow, normalize, time, dot, max, acos,
} from 'three/tsl';
import { buildGrid } from './scenes/grid.js';
import { buildMesa } from './scenes/mesa.js';
import { buildOrbital } from './scenes/orbital.js';

const BARRIER_H = 7;

// Per-arena look: sky, sun, nebula, fog, lights, barrier colour, exposure.
export const THEMES = {
  grid: {
    sky: { zenith: 0x010208, mid: 0x060a1f, horizon: 0x16255a, band: 0x4a1760, bandAmt: 0.55, stars: 0.9965, starsBelow: 0, nebula: 0, sunSize: 0 },
    fog: [0x070b1c, 0.0016], hemi: [0x4a64b8, 0x05060a, 0.55], key: [0xb9ccff, 1.3], rim: [0xff5fd0, 0.6],
    barrier: 0x7fe9ff, exposure: 1.05,
  },
  mesa: {
    sky: {
      zenith: 0x14032a, mid: 0x5a1458, horizon: 0xff7a4a, band: 0xff3d7f, bandAmt: 0.9, stars: 0.9975, starsBelow: 0, nebula: 0,
      sunDir: [0, 0.07, -1], sunSize: 0.2, sunA: 0xfff07a, sunB: 0xff2e88, sunStripes: 1, sunGlow: 1.2,
    },
    fog: [0x4a1640, 0.0011], hemi: [0xff8ac0, 0x1a0a20, 0.7], key: [0xffb07a, 1.4], rim: [0x7a5cff, 0.7],
    barrier: 0xffa0d0, exposure: 1.0,
  },
  orbital: {
    sky: {
      zenith: 0x010108, mid: 0x04051a, horizon: 0x0a0c2c, band: 0x3a1a6a, bandAmt: 0.3, stars: 0.9935, starsBelow: 1, nebula: 1,
      nebA: 0x7a2ac8, nebB: 0x0aa8b0, sunDir: [0.55, 0.3, 0.6], sunSize: 0.012, sunA: 0xffffff, sunB: 0xbfd8ff, sunStripes: 0, sunGlow: 2.2,
    },
    fog: [0x05061a, 0.0005], hemi: [0x7a8cff, 0x05050a, 0.6], key: [0xdfe8ff, 1.6], rim: [0xb07bff, 0.8],
    barrier: 0xb49cff, exposure: 1.05,
  },
};

const BUILDERS = { grid: buildGrid, mesa: buildMesa, orbital: buildOrbital };

// Everything static about the arenas and their surroundings, plus the uniforms the game
// drives each frame (bike light pools, shrinking barrier, danger state).
export class World {
  constructor(scene) {
    this.scene = scene;
    this.shared = new THREE.Group();
    this.reflect = new THREE.Group(); // mirrored under the floor (only the Grid has a mirror floor)
    this.reflect.scale.y = -1;
    scene.add(this.shared, this.reflect);

    this.u = {
      half: uniform(92),
      danger: uniform(0),
      player: uniform(new THREE.Vector2()),
      barrierColor: uniform(new THREE.Color(0x7fe9ff)),
      pools: uniformArray([new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()], 'vec4'),
      poolColors: uniformArray([new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()], 'color'),
    };
    this.calm = new THREE.Color(0x7fe9ff);
    this.scenes = {};
    this.active = null;
    this.map = null;

    this.buildLights();
    this.buildSky();
    this.buildBarrier();
    scene.fog = new THREE.FogExp2(0x070b1c, 0.0016);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0x4a64b8, 0x05060a, 0.55);
    this.key = new THREE.DirectionalLight(0xb9ccff, 1.3);
    this.key.position.set(60, 120, 40);
    this.rimLight = new THREE.DirectionalLight(0xff5fd0, 0.6);
    this.rimLight.position.set(-80, 40, -120);
    this.scene.add(this.hemi, this.key, this.rimLight);
  }

  // A small neon "room" baked into a PMREM so the metal bodywork reflects cyan and magenta strips.
  buildEnvironment(renderer) {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x03040a, side: THREE.BackSide })));
    const strip = (c, w, h, x, y, z, ry, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      env.add(m);
    };
    strip(new THREE.Color(0x22e8ff).multiplyScalar(4), 30, 0.8, 0, 8, -19, 0);
    strip(new THREE.Color(0xff38d6).multiplyScalar(3), 30, 0.8, 0, 6, 19, Math.PI);
    strip(new THREE.Color(0x6b7cff).multiplyScalar(2.5), 30, 1.4, -19, 9, 0, Math.PI / 2);
    strip(new THREE.Color(0xffffff).multiplyScalar(2), 14, 3, 0, 9.9, 0, 0, Math.PI / 2);
    strip(new THREE.Color(0xff7a18).multiplyScalar(2), 20, 0.5, 19, 3, 0, -Math.PI / 2);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = 0.9;
    pmrem.dispose();
  }

  buildSky() {
    const s = (this.skyU = {
      zenith: uniform(new THREE.Color()), mid: uniform(new THREE.Color()), horizon: uniform(new THREE.Color()),
      band: uniform(new THREE.Color()), bandAmt: uniform(0.5), stars: uniform(0.9965), starsBelow: uniform(0),
      nebula: uniform(0), nebA: uniform(new THREE.Color()), nebB: uniform(new THREE.Color()),
      sunDir: uniform(new THREE.Vector3(0, 0.1, -1)), sunSize: uniform(0), sunA: uniform(new THREE.Color()),
      sunB: uniform(new THREE.Color()), sunStripes: uniform(0), sunGlow: uniform(1),
    });
    const noise3 = (p) => {
      // cheap value noise from a hashed lattice
      const i = floor(p), f = fract(p);
      const w = f.mul(f).mul(float(3).sub(f.mul(2)));
      const h = (x, y, z) => hash(i.x.add(x).mul(157).add(i.y.add(y).mul(113)).add(i.z.add(z).mul(71)).add(1000));
      const x00 = mix(h(0, 0, 0), h(1, 0, 0), w.x), x10 = mix(h(0, 1, 0), h(1, 1, 0), w.x);
      const x01 = mix(h(0, 0, 1), h(1, 0, 1), w.x), x11 = mix(h(0, 1, 1), h(1, 1, 1), w.x);
      return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
    };
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    mat.colorNode = Fn(() => {
      const d = normalize(positionWorld.sub(cameraPosition));
      const h = d.y;
      const up = mix(clamp(h, 0, 1), abs(h), s.starsBelow);
      const col = mix(s.horizon, s.mid, smoothstep(0.0, 0.18, up)).toVar();
      col.assign(mix(col, s.zenith, smoothstep(0.18, 0.75, up)));
      col.addAssign(s.band.mul(exp(abs(h.sub(0.03)).mul(-28)).mul(s.bandAmt)));

      // nebula: two tinted layers of drifting noise
      const n1 = noise3(d.mul(3.2)).mul(0.6).add(noise3(d.mul(7.1)).mul(0.3)).add(noise3(d.mul(15.0)).mul(0.1));
      const n2 = noise3(d.mul(2.3).add(vec3(5.2, 1.3, 7.7))).mul(0.65).add(noise3(d.mul(6.0).add(3.1)).mul(0.35));
      const neb = mix(s.nebA.mul(smoothstep(0.45, 0.85, n1)), s.nebB.mul(smoothstep(0.5, 0.9, n2)), 0.45);
      col.addAssign(neb.mul(s.nebula).mul(0.55));

      // stars
      const cell = floor(d.mul(420));
      const sr = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)));
      const starMask = mix(smoothstep(0.05, 0.3, h), float(1), s.starsBelow);
      const star = step(s.stars, sr).mul(starMask);
      const tw = sin(time.mul(sr.mul(9).add(2)).add(sr.mul(40))).mul(0.35).add(0.65);
      col.addAssign(vec3(0.75, 0.85, 1.0).mul(star.mul(tw).mul(1.6)));

      // the sun: disc with an outrun-style striped lower half, plus glow
      const sd = normalize(s.sunDir);
      const cosA = clamp(dot(d, sd), -1, 1);
      const ang = acos(cosA);
      const disc = smoothstep(s.sunSize, s.sunSize.mul(0.985), ang).mul(step(0.0001, s.sunSize));
      const v = d.y.sub(sd.y).div(max(s.sunSize, 0.0001)); // -1 bottom .. 1 top of the disc
      const cut = step(fract(v.mul(-7)), mix(0.08, 0.55, clamp(v.negate(), 0, 1))).mul(step(v, -0.08));
      const sunCol = mix(s.sunB, s.sunA, clamp(v.mul(0.5).add(0.5), 0, 1));
      col.assign(mix(col, sunCol.mul(1.25), disc.mul(float(1).sub(cut.mul(s.sunStripes)))));
      const glow = pow(max(cosA, 0), 60).mul(0.35).add(pow(max(cosA, 0), 8).mul(0.12));
      col.addAssign(mix(s.sunB, s.sunA, 0.5).mul(glow.mul(s.sunGlow)).mul(step(0.0001, s.sunSize)));
      return col;
    })();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 48, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.shared.add(this.sky);
  }

  // The energy barrier that closes in during sudden death. It brightens where the player is close.
  buildBarrier() {
    const u = this.u;
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    });
    mat.colorNode = Fn(() => {
      const y = positionGeometry.y; // 0..1
      const along = positionWorld.x.add(positionWorld.z);
      const fall = pow(float(1).sub(y), 2.2);
      const scan = smoothstep(0.92, 1.0, fract(y.mul(9).sub(time.mul(0.6)))).mul(0.35);
      const ribs = smoothstep(0.035, 0.0, abs(fract(along.mul(0.125)).sub(0.5)).sub(0.46)).mul(0.22);
      const near = exp(positionWorld.xz.sub(u.player).length().mul(-0.08));
      const base = fall.mul(0.26).add(scan.mul(fall)).add(ribs.mul(fall)).add(smoothstep(0.03, 0.0, y).mul(1.5));
      const k = base.mul(float(0.45).add(near.mul(1.5)).add(u.danger.mul(0.35)));
      return u.barrierColor.mul(k);
    })();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    this.barriers = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.shared.add(m);
      const r = m.clone();
      this.reflect.add(r);
      this.barriers.push(m, r);
    }
  }

  // Build an arena's scenery (hidden until selected).
  build(map, terrain) {
    const sc = BUILDERS[map.theme](map, this.u, terrain);
    sc.group.visible = false;
    this.scene.add(sc.group);
    sc.reflectGroup = new THREE.Group();
    for (const r of sc.reflect || []) sc.reflectGroup.add(r);
    this.reflect.add(sc.reflectGroup);
    sc.reflectGroup.visible = false;
    this.scenes[map.id] = sc;
    return sc;
  }

  setMap(map) {
    this.map = map;
    for (const [id, sc] of Object.entries(this.scenes)) {
      sc.group.visible = id === map.id;
      sc.reflectGroup.visible = id === map.id;
    }
    this.active = this.scenes[map.id];
    this.reflect.visible = !!map.mirror;
    const th = THEMES[map.theme];
    const s = this.skyU, k = th.sky;
    s.zenith.value.set(k.zenith); s.mid.value.set(k.mid); s.horizon.value.set(k.horizon); s.band.value.set(k.band);
    s.bandAmt.value = k.bandAmt; s.stars.value = k.stars; s.starsBelow.value = k.starsBelow; s.nebula.value = k.nebula;
    s.nebA.value.set(k.nebA ?? 0); s.nebB.value.set(k.nebB ?? 0);
    s.sunDir.value.set(...(k.sunDir ?? [0, 0.1, -1])).normalize();
    s.sunSize.value = k.sunSize ?? 0; s.sunA.value.set(k.sunA ?? 0xffffff); s.sunB.value.set(k.sunB ?? 0xffffff);
    s.sunStripes.value = k.sunStripes ?? 0; s.sunGlow.value = k.sunGlow ?? 1;
    this.scene.fog.color.set(th.fog[0]);
    this.scene.fog.density = th.fog[1];
    this.hemi.color.set(th.hemi[0]); this.hemi.groundColor.set(th.hemi[1]); this.hemi.intensity = th.hemi[2];
    this.key.color.set(th.key[0]); this.key.intensity = th.key[1];
    this.rimLight.color.set(th.rim[0]); this.rimLight.intensity = th.rim[1];
    this.calm.set(th.barrier);
    this.exposure = th.exposure;
    this.setBarrier(map.half);
  }

  setBarrier(half) {
    this.u.half.value = half;
    for (let k = 0; k < this.barriers.length; k++) {
      const m = this.barriers[k];
      const i = k >> 1;
      const a = (i * Math.PI) / 2;
      m.position.set(Math.sin(a) * half, 0, Math.cos(a) * half);
      m.rotation.y = a;
      m.scale.set(half * 2, BARRIER_H, 1);
    }
  }

  update(dt, t, sim) {
    if (this.active) this.active.update(dt, t, sim);
  }
}

export { color, vec3 };
