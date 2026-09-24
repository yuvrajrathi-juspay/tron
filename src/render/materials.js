import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, color, mix, smoothstep, fract, abs, min, max, exp, fwidth, hash, positionWorld, positionGeometry,
  cameraPosition, floor, step, dot, uniform, time, sin, normalWorld, pow, select, length, normalize,
} from 'three/tsl';

// Anti-aliased grid line mask (1 on the line, 0 off it) for a 2D coordinate.
export function gridLine(p, spacing, width) {
  const g = p.div(spacing);
  const f = abs(fract(g.sub(0.5)).sub(0.5)).div(fwidth(g).mul(width));
  return float(1).sub(min(min(f.x, f.y), 1));
}

// Hexagonal plate pattern: returns 1 on plate seams (anti-aliased) and a per-plate id hash.
export function hexSeams(p, size, width) {
  const q = p.div(size);
  const r = vec2(1, 1.7320508);
  const h = r.mul(0.5);
  const a = q.mod(r).sub(h);
  const b = q.sub(h).mod(r).sub(h);
  const gv = select(dot(a, a).lessThan(dot(b, b)), a, b);
  const id = q.sub(gv);
  const d = max(dot(abs(gv), normalize(vec2(1, 1.7320508))), abs(gv.x));
  const edge = float(0.5).sub(d);
  const aa = fwidth(edge).mul(width);
  return { seam: smoothstep(aa, float(0), edge), id: hash(floor(id.x.mul(7.13)).add(floor(id.y.mul(3.71)).mul(113))) };
}

const col = (v) => (Array.isArray(v) ? vec3(...v) : color(v));

// Ground shading shared by every arena. `u` holds the world's live uniforms (barrier size, bike
// light pools, danger). `t` is the theme: colours, pattern, pits to cut out, etc.
export function makeGroundMaterial(u, t) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: !!t.transparent, depthWrite: true });
  const pits = t.pits || [];
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const camD = positionWorld.xz.sub(cameraPosition.xz).length();
    const fade = exp(camD.mul(-(t.fadeK ?? 0.0065)));
    const edgeMax = max(abs(p.x), abs(p.y));
    const inside = step(edgeMax, u.half);
    const insideFull = step(edgeMax, float(t.half));

    let base, lines;
    if (t.pattern === 'hex') {
      const hx = hexSeams(p, 6, 1.4);
      base = mix(col(t.baseA), col(t.baseB), hx.id).toVar();
      base.mulAssign(float(1).sub(hx.seam.mul(0.5)));
      // circuit traces: sparse glowing lines inside some plates
      const trace = gridLine(p.add(vec2(1.5, 0.7)), 12, 0.9).mul(step(0.62, hx.id));
      lines = col(t.lineMajor).mul(hx.seam.mul(t.majorGain ?? 0.55)).add(col(t.lineMinor).mul(trace.mul(t.minorGain ?? 0.35))).toVar();
      const pulse = smoothstep(0.9, 1.0, fract(p.x.add(p.y).mul(0.02).sub(time.mul(0.25)))).mul(hx.seam).mul(0.6);
      lines.addAssign(col(t.lineMajor).mul(pulse));
    } else {
      const tile = floor(p.div(16));
      const tv = hash(tile.x.add(tile.y.mul(71)).add(3));
      base = mix(col(t.baseA), col(t.baseB), tv).toVar();
      base.mulAssign(float(1).sub(gridLine(p, 16, 2.2).mul(0.6)));
      lines = col(t.lineMinor).mul(gridLine(p, 4, 1.0).mul(t.minorGain ?? 0.22)).toVar();
      lines.addAssign(col(t.lineMajor).mul(gridLine(p, 16, 1.4).mul(t.majorGain ?? 0.55)));
    }
    lines.mulAssign(fade.mul(mix(t.outsideGain ?? 0.25, 1.0, insideFull)));
    // elevation (dunes, deck swells) glows a little brighter so the shape reads at speed
    if (t.heightGlow) lines.mulAssign(float(1).add(positionWorld.y.max(0).mul(t.heightGlow)));
    // closed-off floor (outside the shrinking barrier) goes red and dim
    const closed = insideFull.mul(float(1).sub(inside));
    lines.assign(mix(lines, vec3(0.9, 0.08, 0.12).mul(gridLine(p, 4, 1.2).mul(0.35).mul(fade)), closed));

    if (t.emblem) {
      const r = p.length();
      const ring = (rad, w) => smoothstep(w, 0.0, abs(r.sub(rad)));
      const emblem = ring(10, 0.18).add(ring(11.2, 0.07)).add(ring(26, 0.12)).mul(0.9);
      const ang = p.y.atan(p.x).mul(24 / 6.2831853);
      const ticks = step(0.8, fract(ang)).mul(smoothstep(10.2, 10.6, r)).mul(smoothstep(11.0, 10.6, r));
      lines.addAssign(col(t.emblemColor || t.lineMajor).mul(emblem.add(ticks.mul(0.7)).mul(fade)));
    }

    // light pools under the bikes (only on surfaces near the bike's height)
    const pool = vec3(0).toVar();
    for (let i = 0; i < 4; i++) {
      const P = u.pools.element(i);
      const dd = p.sub(P.xy);
      const dy = abs(positionWorld.y.sub(P.w));
      const fall = exp(dot(dd, dd).mul(-0.16)).mul(0.7).add(exp(dot(dd, dd).mul(-1.4)).mul(0.5)).mul(P.z);
      pool.addAssign(u.poolColors.element(i).mul(fall.mul(smoothstep(3.0, 0.5, dy))));
    }
    // barrier glow line on the floor
    const edgeD = abs(edgeMax.sub(u.half));
    const edge = exp(edgeD.mul(-1.6)).mul(0.8).add(exp(edgeD.mul(-0.25)).mul(0.12));

    return base.add(lines).add(pool.mul(t.poolGain ?? 0.32)).add(u.barrierColor.mul(edge));
  })();

  if (t.transparent) {
    mat.opacityNode = Fn(() => {
      const camD = positionWorld.xz.sub(cameraPosition.xz).length();
      return mix(0.72, 0.95, smoothstep(40, 400, camD));
    })();
  }
  if (pits.length) {
    // cut the void pits out of the deck
    mat.alphaTestNode = float(0.5);
    const inPit = Fn(() => {
      const p = positionWorld.xz;
      const k = float(0).toVar();
      for (const q of pits) {
        const d = abs(p.sub(vec2(q.x, q.z))).sub(vec2(q.w / 2, q.d / 2));
        k.assign(max(k, step(max(d.x, d.y), 0.0)));
      }
      return k;
    });
    mat.opacityNode = float(1).sub(inPit());
  }
  return mat;
}

// Emissive neon trim that pulses gently: for edges, lips and rails.
export function neonMaterial(hex, gain = 3, opts = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ fog: opts.fog ?? true, side: opts.side ?? THREE.FrontSide });
  const c = new THREE.Color(hex);
  m.colorNode = opts.pulse
    ? Fn(() => color(c).mul(float(gain).mul(sin(time.mul(opts.pulse)).mul(0.25).add(0.85))))()
    : color(c).mul(gain);
  return m;
}

// Dark hard-surface for sides of ramps, mesas, pillars: gunmetal with glowing strata lines.
export function slabMaterial(base, lineHex, opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ color: base, metalness: opts.metalness ?? 0.6, roughness: opts.roughness ?? 0.45 });
  const lc = new THREE.Color(lineHex);
  m.emissiveNode = Fn(() => {
    const y = positionWorld.y;
    const strata = smoothstep(0.06, 0.0, abs(fract(y.div(opts.strata ?? 1.2)).sub(0.5)).sub(0.44)).mul(opts.strataGain ?? 0.35);
    const side = float(1).sub(abs(normalWorld.y));
    const scan = smoothstep(0.95, 1.0, fract(y.mul(0.15).sub(time.mul(0.2)))).mul(0.4);
    return color(lc).mul(strata.add(scan).mul(side));
  })();
  return m;
}

export { length, pow, uniform, positionGeometry };
