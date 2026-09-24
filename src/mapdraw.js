// 2D top-down drawing of an arena's layout, shared by the in-game minimap and the menu's map cards.
// Coordinates are world units (x right, z down); the caller sets up scale/rotation.

const PICKUP_CSS = { boost: '#3df0ff', jump: '#9dff4a', ghost: '#c77dff' };

export function drawArenaStatic(ctx, map, px) {
  const H = map.half;
  ctx.lineWidth = px;
  ctx.strokeStyle = 'rgba(140,200,255,0.10)';
  ctx.beginPath();
  for (let g = -H; g <= H; g += 16) {
    ctx.moveTo(g, -H); ctx.lineTo(g, H);
    ctx.moveTo(-H, g); ctx.lineTo(H, g);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,230,255,0.35)';
  ctx.strokeRect(-H, -H, H * 2, H * 2);

  for (const f of map.features) {
    if (f.type === 'mesa') {
      ctx.fillStyle = 'rgba(255,80,160,0.22)';
      ctx.strokeStyle = 'rgba(255,110,180,0.85)';
      ctx.lineWidth = 1.4 * px;
      ctx.fillRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d);
      ctx.strokeRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d);
    } else if (f.type === 'ramp') {
      const fx = Math.sin(f.heading), fz = -Math.cos(f.heading), rx = -fz, rz = fx;
      const at = (u, v) => [f.x + fx * u + rx * v, f.z + fz * u + rz * v];
      const L = f.length / 2, W = f.width / 2;
      const pts = [at(-L, -W), at(L, -W), at(L, W), at(-L, W)];
      ctx.fillStyle = f.attach ? 'rgba(255,80,160,0.16)' : 'rgba(255,190,80,0.22)';
      ctx.strokeStyle = f.attach ? 'rgba(255,110,180,0.7)' : 'rgba(255,190,80,0.9)';
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // uphill chevron
      const [tx, tz] = at(L * 0.55, 0), [lx, lz] = at(-L * 0.1, -W * 0.6), [qx, qz] = at(-L * 0.1, W * 0.6);
      ctx.beginPath();
      ctx.moveTo(lx, lz); ctx.lineTo(tx, tz); ctx.lineTo(qx, qz);
      ctx.stroke();
    } else if (f.type === 'bump') {
      ctx.strokeStyle = 'rgba(200,160,255,0.28)';
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.arc(f.x, f.z, f.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.x, f.z, f.r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.type === 'pit') {
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeStyle = 'rgba(255,176,32,0.95)';
      ctx.lineWidth = 1.6 * px;
      ctx.fillRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d);
      ctx.strokeRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d);
    } else if (f.type === 'pillar') {
      ctx.fillStyle = 'rgba(255,60,90,0.8)';
      ctx.beginPath();
      ctx.arc(f.x, f.z, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const p of map.pads) {
    ctx.save();
    ctx.translate(p.x, p.z);
    ctx.rotate(p.heading);
    ctx.fillStyle = 'rgba(255,200,80,0.55)';
    ctx.fillRect(-p.width / 2, -p.length / 2, p.width, p.length);
    ctx.restore();
  }
  for (const pr of map.portals) {
    ctx.strokeStyle = pr.color;
    ctx.lineWidth = 1.8 * px;
    for (const [x, z] of [pr.a, pr.b]) {
      ctx.beginPath();
      ctx.arc(x, z, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const s of map.sweepers) {
    ctx.strokeStyle = 'rgba(255,60,90,0.45)';
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(s.x, s.z, s.len, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Things that move: laser arms and which pickups are currently up.
export function drawArenaLive(ctx, sim, px) {
  for (const s of sim.sweepers) {
    ctx.strokeStyle = 'rgba(255,70,100,0.95)';
    ctx.lineWidth = 2.2 * px;
    ctx.beginPath();
    for (const a of s.angles) {
      ctx.moveTo(s.x + Math.cos(a) * s.inner, s.z + Math.sin(a) * s.inner);
      ctx.lineTo(s.x + Math.cos(a) * s.len, s.z + Math.sin(a) * s.len);
    }
    ctx.stroke();
  }
  for (const p of sim.pickups) {
    if (!p.active) continue;
    ctx.fillStyle = PICKUP_CSS[p.type];
    ctx.beginPath();
    ctx.arc(p.x, p.z, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Static preview for a menu card: draws the whole arena into a canvas.
export function drawPreview(canvas, map) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 120, h = canvas.clientHeight || 120;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  const s = (Math.min(canvas.width, canvas.height) * 0.46) / 138; // same scale for every map, so sizes compare
  ctx.setTransform(s, 0, 0, s, canvas.width / 2, canvas.height / 2);
  drawArenaStatic(ctx, map, 1 / s);
  const R = map.spawnR;
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 4; k++) {
    const a = map.spawnA0 + (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R, Math.sin(a) * R, 2.2 / (s * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
}
