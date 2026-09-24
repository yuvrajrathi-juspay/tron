import * as THREE from 'three/webgpu';

function noise(t, seed) {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
function smoothNoise(t, seed) {
  const i = Math.floor(t), f = t - i;
  const a = noise(i, seed), b = noise(i + 1, seed);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

// Chase camera with trauma-based shake, FOV punch, turn roll, plus intro orbit and spectate modes.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.yawVel = 0;
    this.pos = new THREE.Vector3(0, 30, 60);
    this.look = new THREE.Vector3();
    this.trauma = 0;
    this.t = 0;
    this.baseFov = 70;
    this.fovBoost = 0;
    this.fovPunch = 0;
    this.roll = 0;
    this.mode = 'orbit';
    this.intro = 0;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.reduced = false;
    this.orbitR = 120;
    this.orbitH = 46;
    this.groundAt = () => 0;
    this.snapBehind = false;
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  // hold on the wreck: drift up and away while keeping the explosion framed
  startDeath(x, y, z) {
    this.mode = 'death';
    this.deathPoint = new THREE.Vector3(x, y, z);
    this.pos.copy(this.camera.position);
  }
  punch(deg) { this.fovPunch = Math.min(12, this.fovPunch + deg); }

  snapTo(target) {
    this.yaw = target.yaw;
    this.yawVel = 0;
    this.chasePoint(target, this.pos);
    this.lookPoint(target, this.look);
  }

  chasePoint(t, out) {
    const back = 4.3 + t.speedK * 1.2;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    // the bike's body sits 1.5 behind its nose; in the air we rise with it, but only partly
    const lift = Math.min(Math.max(0, t.y - (t.gy ?? t.y)), 6);
    out.set(t.x - fx * (back + 1.5), t.y - lift * 0.45 + 2.1 + t.speedK * 0.2, t.z - fz * (back + 1.5));
    return out;
  }

  lookPoint(t, out) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const lift = Math.min(Math.max(0, t.y - (t.gy ?? t.y)), 6);
    out.set(t.x + fx * 9, t.y - lift * 0.3 + 1.0, t.z + fz * 9);
    return out;
  }

  // target: { x, y, z, yaw, speedK (0..1 boost), alive }
  update(dt, target, state) {
    this.t += dt;
    const cam = this.camera;

    if (this.mode === 'fixed') return; // debug / photo mode: someone else owns the camera
    if (this.mode === 'orbit') {
      // attract / menu camera: slow orbit over the arena
      const a = this.t * 0.06;
      this.pos.set(Math.sin(a) * this.orbitR, this.orbitH + Math.sin(this.t * 0.2) * 8, Math.cos(a) * this.orbitR);
      this.look.set(0, 0, 0);
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.setFov(58, dt);
      return;
    }

    if (this.mode === 'intro' && target) {
      // swoop from high overhead down behind the bike during the countdown
      this.intro = Math.min(1, this.intro + dt / 2.6);
      const e = 1 - Math.pow(1 - this.intro, 3);
      this.yaw = target.yaw;
      const chase = this.chasePoint(target, this.tmp);
      const a = target.yaw + (1 - e) * 2.2;
      const hi = this.tmp2.set(target.x + Math.sin(a) * 34, target.y + 26, target.z + Math.cos(a) * 34);
      cam.position.copy(hi).lerp(chase, e);
      this.pos.copy(cam.position);
      this.lookPoint(target, this.look);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.setFov(70, dt);
      if (this.intro >= 1) this.mode = 'chase';
      return;
    }

    if (this.mode === 'death') {
      const p = this.deathPoint;
      const away = this.tmp.set(this.pos.x - p.x, 0, this.pos.z - p.z);
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      away.normalize();
      this.pos.addScaledVector(away, dt * 6.5);
      this.pos.y += dt * Math.max(0, 3.2 - (this.pos.y - Math.max(p.y, 0)) * 0.25);
      this.pos.y = Math.max(this.pos.y, this.groundAt(this.pos.x, this.pos.z) + 1.3);
      this.look.lerp(this.tmp2.set(p.x, p.y + 0.9, p.z), 1 - Math.exp(-dt * 7));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.shake(dt);
      this.setFov(this.baseFov, dt);
      return;
    }

    if (!target) return;

    // yaw follows the bike with a critically damped spring: turns sweep, never snap
    let d = target.yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const k = 70, c = 2 * Math.sqrt(k) * 1.0;
    this.yawVel += (d * k - this.yawVel * c) * dt;
    this.yaw += this.yawVel * dt;

    const want = this.chasePoint(target, this.tmp);
    if (this.snapBehind) {
      // came out of a portal: cut straight to the new spot instead of flying across the map
      this.snapBehind = false;
      this.yaw = target.yaw;
      this.yawVel = 0;
      this.chasePoint(target, want);
      this.pos.copy(want);
      this.lookPoint(target, this.look);
    }
    const follow = 1 - Math.exp(-dt * 14);
    this.pos.lerp(want, follow);
    // keep the camera from lagging too far at high speed
    this.pos.y = want.y + (this.pos.y - want.y) * Math.exp(-dt * 6);
    const lk = this.lookPoint(target, this.tmp2);
    this.look.lerp(lk, 1 - Math.exp(-dt * 18));
    // never dip into the terrain (ramps, dunes, the mesa's flanks)
    const gy = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < gy + 1.3) this.pos.y = gy + 1.3;

    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);

    // bank into turns
    const rollTarget = THREE.MathUtils.clamp(-this.yawVel * 0.045, -0.12, 0.12);
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-dt * 10));
    cam.rotateZ(this.roll);

    this.shake(dt);
    this.fovBoost += (target.speedK * 13 - this.fovBoost) * (1 - Math.exp(-dt * 5));
    this.setFov(this.baseFov + this.fovBoost, dt);
  }

  shake(dt) {
    this.trauma = Math.max(0, this.trauma - 1.3 * dt);
    if (this.trauma <= 0 || this.reduced) return;
    const s = this.trauma * this.trauma;
    const f = this.t * 26;
    const cam = this.camera;
    cam.position.x += 0.6 * s * smoothNoise(f, 1);
    cam.position.y += 0.45 * s * smoothNoise(f, 2);
    cam.position.z += 0.6 * s * smoothNoise(f, 3);
    cam.rotateZ(0.09 * s * smoothNoise(f, 4));
  }

  setFov(base, dt) {
    this.fovPunch *= Math.exp(-dt / 0.22);
    let fov = base + this.fovPunch;
    // tall screens (phones held upright): widen the vertical FOV so you still see as much sideways
    const aspect = this.camera.aspect;
    if (aspect < 1.5) {
      const h = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1.5 / aspect));
      fov = Math.min(105, (h * 180) / Math.PI);
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
