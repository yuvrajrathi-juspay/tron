import * as THREE from 'three/webgpu';
import { pass, uniform, screenUV, vec2, vec3, vec4, float, Fn, mix, smoothstep, fract, sin, time, screenCoordinate } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// Renderer + post chain: scene -> bloom -> one composite pass (speed blur, chromatic
// aberration on impacts, flash, vignette, danger tint, grain) -> ACES output.
export class Pipeline {
  constructor(container) {
    const forceWebGL = /[?&]webgl\b/.test(location.search);
    this.renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance', forceWebGL });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 1);
    // phones start lighter (small screens, hot GPUs); dynamic resolution climbs if there's headroom
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.touch ? 1.5 : 2);
    this.dpr = Math.min(this.maxDpr, this.touch ? 1.1 : 1.5);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.u = {
      speedBlur: uniform(0),
      aberration: uniform(0),
      flash: uniform(0),
      flashColor: uniform(new THREE.Color(1, 1, 1)),
      danger: uniform(0),
      vignette: uniform(0.5),
    };
    this.frameTimes = [];
    this.lastAdjust = 0;
  }

  async init(scene, camera) {
    await this.renderer.init();
    this.backend = this.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.scene = scene;
    this.camera = camera;

    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const bloomPass = bloom(color, 0.62, 0.4, 0.42);
    this.bloomPass = bloomPass;

    const u = this.u;
    const composite = Fn(() => {
      const uv0 = screenUV;
      const dir = uv0.sub(0.5);
      const dist = dir.length();

      // speed blur: a short radial smear that grows toward the screen edges
      const blurStep = dir.mul(u.speedBlur.mul(0.022).mul(smoothstep(0.15, 0.7, dist)));
      const acc = vec3(0).toVar();
      for (let i = 0; i < 6; i++) acc.addAssign(color.sample(uv0.sub(blurStep.mul(i / 5))).rgb);
      const base = acc.div(6).toVar();

      // chromatic aberration, only while an impact is ringing out
      const ca = dir.mul(u.aberration.mul(0.018));
      const cr = color.sample(uv0.add(ca)).r;
      const cb = color.sample(uv0.sub(ca)).b;
      const caw = u.aberration.mul(4).clamp(0, 1);
      base.assign(vec3(mix(base.r, cr, caw), base.g, mix(base.b, cb, caw)));

      const col = base.add(bloomPass.rgb).toVar();
      col.assign(mix(col, u.flashColor, u.flash));

      // vignette and sudden-death danger tint at the edges
      const edge = smoothstep(0.42, 0.95, dist.mul(1.12));
      col.mulAssign(float(1).sub(edge.mul(u.vignette)));
      col.addAssign(vec3(1.0, 0.08, 0.12).mul(edge.mul(u.danger).mul(0.22)));

      // fine film grain
      const gp = screenCoordinate.xy.add(fract(time.mul(7.13)).mul(vec2(173.0, 311.0)));
      const g = fract(sin(gp.x.mul(12.9898).add(gp.y.mul(78.233))).mul(43758.5453));
      col.addAssign(g.sub(0.5).mul(0.02));
      return vec4(col, 1);
    });

    this.post = new THREE.RenderPipeline(this.renderer);
    this.post.outputNode = composite();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  async warmup() {
    // Compile every material the scene will need before the first real frame so play never hitches.
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  render() {
    this.post.render();
  }

  // Dynamic resolution: if frames run long for a while, trade pixels for smoothness; recover when there's headroom.
  track(dtReal, now) {
    const ft = this.frameTimes;
    ft.push(dtReal);
    if (ft.length > 90) ft.shift();
    if (now - this.lastAdjust < 2.5 || ft.length < 90 || now - (this.lastCheck || 0) < 1) return;
    this.lastCheck = now;
    const sorted = this.sorted || (this.sorted = []);
    sorted.length = 0;
    for (let i = 0; i < ft.length; i++) sorted.push(ft[i]);
    sorted.sort((a, b) => a - b);
    const median = sorted[45];
    const p90 = sorted[81];
    // the display's native interval is roughly the fastest frames we've seen
    const interval = Math.max(1 / 240, sorted[4]);
    if (p90 > interval * 1.45 && median > interval * 1.12 && this.dpr > 0.75) {
      this.setDpr(Math.max(0.75, this.dpr - 0.25));
      this.lastAdjust = now;
    } else if (p90 < interval * 1.08 && this.dpr < Math.min(this.maxDpr, 1.5) && now - this.lastAdjust > 8) {
      this.setDpr(Math.min(this.maxDpr, 1.5, this.dpr + 0.25));
      this.lastAdjust = now;
    }
  }

  setDpr(v) {
    this.dpr = v;
    this.renderer.setPixelRatio(v);
    this.frameTimes.length = 0;
  }

  stats() {
    const info = this.renderer.info;
    return {
      backend: this.backend,
      dpr: this.dpr,
      calls: info.render.drawCalls ?? info.render.frameCalls ?? 0,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }
}
