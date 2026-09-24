import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, uniform, uniformArray, instancedArray, instanceIndex, float, int, vec2, vec3, vec4, hash, mix,
  max, exp, sqrt, cos, sin, normalize, uv, smoothstep, pow,
} from 'three/tsl';
import { vrand } from '../rng.js';

const N = 12288;       // GPU spark pool
const MAX_EMIT = 24;   // emitters per frame
const SHARDS = 320;    // CPU debris pool
const RINGS = 8;

// GPU sparks: a compute kernel spawns particles from a small per-frame emitter table
// (each particle only ever writes its own slot, so this also runs on the WebGL2 fallback)
// and integrates drag, gravity and floor bounces. Rendered as additive soft sprites.
export class Sparks {
  constructor(scene) {
    this.pos = instancedArray(N, 'vec4');  // xyz, gravity scale
    this.vel = instancedArray(N, 'vec4');  // xyz, drag
    this.col = instancedArray(N, 'vec4');  // rgb, size
    this.life = instancedArray(N, 'vec2'); // remaining, total

    this.emitData = [];
    for (let i = 0; i < MAX_EMIT * 4; i++) this.emitData.push(new THREE.Vector4());
    this.uEmit = uniformArray(this.emitData, 'vec4');
    this.uEmitCount = uniform(0, 'int');
    this.uDt = uniform(0);
    this.uSeed = uniform(0);
    this.queue = [];
    this.cursor = 0;

    const { pos, vel, col, life, uEmit, uEmitCount, uDt, uSeed } = this;
    this.kernel = Fn(() => {
      const P = pos.element(instanceIndex);
      const V = vel.element(instanceIndex);
      const C = col.element(instanceIndex);
      const L = life.element(instanceIndex);
      const idx = instanceIndex.toInt();

      Loop({ start: int(0), end: uEmitCount, type: 'int' }, ({ i }) => {
        const e0 = uEmit.element(i.mul(4));           // origin xyz, first slot
        const e1 = uEmit.element(i.mul(4).add(1));    // direction xyz, count
        const e2 = uEmit.element(i.mul(4).add(2));    // colour rgb, speed
        const e3 = uEmit.element(i.mul(4).add(3));    // spread, life, size, gravity
        const rel = idx.sub(e0.w.toInt()).add(int(N)).mod(int(N));
        If(rel.lessThan(e1.w.toInt()), () => {
          const s = instanceIndex.toFloat().add(uSeed);
          const h1 = hash(s), h2 = hash(s.add(17.0)), h3 = hash(s.add(41.0));
          const h4 = hash(s.add(73.0)), h5 = hash(s.add(97.0));
          const th = h1.mul(6.2831853);
          const zz = h2.mul(2).sub(1);
          const rr = sqrt(max(float(0), float(1).sub(zz.mul(zz))));
          const rnd = vec3(rr.mul(cos(th)), zz, rr.mul(sin(th)));
          const dir = normalize(mix(e1.xyz, rnd, e3.x).add(vec3(0, 0.0001, 0)));
          const speed = e2.w.mul(h3.mul(0.75).add(0.35));
          P.assign(vec4(e0.xyz.add(rnd.mul(0.15)), e3.w));
          V.assign(vec4(dir.mul(speed), float(1.4).add(h4.mul(1.5))));
          C.assign(vec4(e2.xyz.mul(h5.mul(0.8).add(0.6)), e3.z.mul(h4.mul(0.8).add(0.5))));
          const lf = e3.y.mul(h3.mul(0.8).add(0.5));
          L.assign(vec2(lf, lf));
          Break();
        });
      });

      If(L.x.greaterThan(0), () => {
        const v = V.xyz.mul(exp(V.w.negate().mul(uDt))).add(vec3(0, P.w.mul(-22.0).mul(uDt), 0)).toVar();
        const p = P.xyz.add(v.mul(uDt)).toVar();
        If(p.y.lessThan(0.03), () => {
          p.y.assign(0.03);
          v.assign(vec3(v.x.mul(0.6), v.y.abs().mul(0.3), v.z.mul(0.6)));
        });
        P.assign(vec4(p, P.w));
        V.assign(vec4(v, V.w));
        L.assign(vec2(L.x.sub(uDt), L.y));
      });
    })().compute(N);

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const Pa = pos.toAttribute(), Ca = col.toAttribute(), La = life.toAttribute();
    const f = La.x.div(max(La.y, 0.0001)).clamp(0, 1);
    mat.positionNode = Pa.xyz;
    mat.scaleNode = Ca.w.mul(f.mul(0.6).add(0.4)).mul(La.x.greaterThan(0).select(float(1), float(0)));
    const d = uv().sub(0.5).length().mul(2);
    const soft = pow(smoothstep(1.0, 0.0, d), 1.6);
    mat.colorNode = mix(Ca.xyz, vec3(1, 1, 1), f.mul(f).mul(0.6)).mul(f.mul(1.8).add(0.3)).mul(soft);
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 5;
    scene.add(this.sprite);
  }

  // o: { x, y, z, dx, dy, dz, spread (0 = tight cone .. 1 = sphere), count, speed, life, size, gravity, color }
  emit(o) {
    if (this.queue.length < MAX_EMIT) this.queue.push(o);
  }

  update(renderer, dt) {
    const q = this.queue;
    const n = Math.min(q.length, MAX_EMIT);
    for (let k = 0; k < n; k++) {
      const o = q[k];
      const count = Math.min(1024, Math.max(0, Math.floor(o.count)));
      const c = o.color;
      this.emitData[k * 4].set(o.x, o.y, o.z, this.cursor);
      this.emitData[k * 4 + 1].set(o.dx ?? 0, o.dy ?? 1, o.dz ?? 0, count);
      this.emitData[k * 4 + 2].set(c.r, c.g, c.b, o.speed ?? 10);
      this.emitData[k * 4 + 3].set(o.spread ?? 1, o.life ?? 0.6, o.size ?? 0.18, o.gravity ?? 1);
      this.cursor = (this.cursor + count) % N;
    }
    q.length = 0;
    this.uEmitCount.value = n;
    this.uDt.value = Math.min(dt, 0.05);
    this.uSeed.value = Math.floor(vrand() * 1e6);
    renderer.compute(this.kernel);
  }
}

// CPU debris: tumbling glowing shards from a derezzed bike, plus shockwave rings.
export class Debris {
  constructor(scene) {
    const geo = new THREE.TetrahedronGeometry(0.22);
    geo.scale(1, 0.4, 2.2);
    const mat = new THREE.MeshBasicNodeMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, SHARDS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SHARDS * 3), 3);
    this.mesh.count = SHARDS;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < SHARDS; i++) {
      this.items.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0, max: 1, c: new THREE.Color() });
    }
    this.next = 0;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SHARDS; i++) this.mesh.setMatrixAt(i, this.zero);

    // shockwave rings
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < RINGS; i++) {
      const u = { color: uniform(new THREE.Color()), a: uniform(0) };
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      m.colorNode = u.color.mul(u.a);
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.rings.push({ mesh, u, t: 0, dur: 1, max: 10, on: false });
    }
  }

  burst(x, y, z, color, n = 46, power = 1) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % SHARDS;
      it.alive = true;
      it.p.set(x + (vrand() - 0.5) * 1.2, y + 0.4 + vrand() * 0.6, z + (vrand() - 0.5) * 1.2);
      const a = vrand() * Math.PI * 2;
      const sp = (4 + vrand() * 14) * power;
      it.v.set(Math.cos(a) * sp, (5 + vrand() * 11) * power, Math.sin(a) * sp);
      it.r.set(vrand() * 6, vrand() * 6, vrand() * 6);
      it.w.set((vrand() - 0.5) * 20, (vrand() - 0.5) * 20, (vrand() - 0.5) * 20);
      it.max = it.life = 1.2 + vrand() * 1.3;
      it.c.copy(c).multiplyScalar(2.5 + vrand() * 3);
      if (vrand() < 0.25) it.c.setRGB(3, 3, 3);
    }
  }

  ring(x, z, color, maxR = 14, dur = 0.6, y = 0.05) {
    const r = this.rings.find((q) => !q.on) || this.rings[0];
    r.on = true;
    r.t = 0;
    r.dur = dur;
    r.max = maxR;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    r.u.color.value.set(color).multiplyScalar(3);
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < SHARDS; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      any = true;
      it.life -= dt;
      if (it.life <= 0) {
        it.alive = false;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      it.v.y -= 26 * dt;
      it.v.multiplyScalar(Math.exp(-0.9 * dt));
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.05) {
        it.p.y = 0.05;
        it.v.y = Math.abs(it.v.y) * 0.35;
        it.v.x *= 0.6; it.v.z *= 0.6;
        it.w.multiplyScalar(0.6);
      }
      it.r.x += it.w.x * dt; it.r.y += it.w.y * dt; it.r.z += it.w.z * dt;
      const f = it.life / it.max;
      this.q.setFromEuler(it.r);
      this.s.setScalar(Math.min(1, f * 2.5));
      this.m4.compose(it.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
      const k = Math.min(1, f * 1.6);
      this.mesh.instanceColor.setXYZ(i, it.c.r * k, it.c.g * k, it.c.b * k);
    }
    if (any || this.wasAny) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.wasAny = any;

    for (const r of this.rings) {
      if (!r.on) continue;
      r.t += dt;
      const t = r.t / r.dur;
      if (t >= 1) { r.on = false; r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(0.5 + e * r.max);
      r.u.a.value = (1 - t) * (1 - t);
    }
  }
}
