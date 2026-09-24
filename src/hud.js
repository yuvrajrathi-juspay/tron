import * as THREE from 'three/webgpu';
import { MATCH_POINTS, SUDDEN_DEATH_AT, BASE_SPEED, BOOST_MULT, DIFFICULTY } from './config.js';
import { drawArenaStatic, drawArenaLive, drawPreview } from './mapdraw.js';
import { MAPS, MAP_ORDER } from './maps.js';

const $ = (id) => document.getElementById(id);

const PERSONA_TEXT = {
  hunter: 'Hunter. Stalks you and cuts across your line.',
  survivor: 'Survivor. Hoards open space and outlasts.',
  wild: 'Wildcard. Boost-happy, jumps walls, takes risks.',
};
const DIFF_TEXT = {
  rookie: 'Slow reflexes, frequent misjudgements. Learn the grid.',
  pilot: 'Solid riders who still make mistakes. The intended challenge.',
  ace: 'Sharp, aggressive and hard to trap. Bring your best lines.',
};

function bikeIcon(css) {
  return `<svg viewBox="0 0 40 40"><path d="M4 26 Q5 15 14 14 L22 14 Q27 14 29 18 L33 18 Q37 19 37 26 Z" fill="none" stroke="${css}" stroke-width="2"/><circle cx="11" cy="27" r="5" fill="none" stroke="${css}" stroke-width="2"/><circle cx="31" cy="27" r="5" fill="none" stroke="${css}" stroke-width="2"/></svg>`;
}

export class Hud {
  constructor(sim) {
    this.sim = sim;
    this.el = {
      hud: $('hud'), board: $('board'), roundNo: $('round-no'), time: $('round-time'), collapse: $('collapse'),
      collapseText: $('collapse-text'), collapseBar: $('collapse-bar'), feed: $('feed'), speed: $('speed'),
      gBoost: $('g-boost'), gSpeed: $('g-speed'), boostPct: $('boost-pct'), grind: $('grind'), jump: $('jump'),
      jFill: $('j-fill'), jumpState: $('jump-state'), keys: $('keys'), count: $('count'), banner: $('banner'),
      sub: $('sub'), flash: $('flash'), tags: $('tags'), map: $('minimap'),
    };
    this.cache = {};
    this.buildBoard();
    this.buildTicks();
    this.buildTags();
    this.buildRoster();
    this.mapCtx = this.el.map.getContext('2d');
    this.v = new THREE.Vector3();
  }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  buildBoard() {
    const rows = this.sim.riders.map((r) => {
      const row = document.createElement('div');
      row.className = 'row' + (r.bot ? '' : ' me');
      row.style.setProperty('--c', r.css);
      row.innerHTML = `<i></i><span class="nm">${r.name}</span><span class="st"></span><span class="pt">0</span>`;
      this.el.board.appendChild(row);
      return { row, st: row.querySelector('.st'), pt: row.querySelector('.pt') };
    });
    const t = document.createElement('div');
    t.className = 'target';
    t.textContent = `FIRST TO ${MATCH_POINTS}`;
    this.el.board.appendChild(t);
    this.rows = rows;
  }

  buildTicks() {
    const g = $('g-ticks');
    let s = '';
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI - (i / 20) * Math.PI;
      const r0 = i % 5 === 0 ? 108 : 105, r1 = 113;
      const x0 = 120 + Math.cos(a) * r0, y0 = 128 - Math.sin(a) * r0;
      const x1 = 120 + Math.cos(a) * r1, y1 = 128 - Math.sin(a) * r1;
      s += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
    }
    g.innerHTML = s;
  }

  buildTags() {
    this.tags = this.sim.riders.map((r) => {
      if (!r.bot) return null;
      const t = document.createElement('div');
      t.className = 'tag';
      t.style.setProperty('--c', r.css);
      t.textContent = r.name;
      t.hidden = true;
      this.el.tags.appendChild(t);
      return t;
    });
  }

  buildRoster() {
    $('roster').innerHTML = this.sim.riders.filter((r) => r.bot).map((r) => `
      <div class="rival" style="--c:${r.css}">${bikeIcon(r.css)}<div><div class="rn">${r.name}</div><div class="rp">${PERSONA_TEXT[r.persona]}</div></div></div>`).join('');
  }

  setDifficultyText(key) {
    $('diff-desc').textContent = DIFF_TEXT[key];
    for (const b of document.querySelectorAll('#diff button')) {
      const on = b.dataset.d === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  show(v) { this.el.hud.hidden = !v; if (!v) for (const t of this.tags) if (t) t.hidden = true; }

  showKeys(v) { this.el.keys.classList.toggle('gone', !v); }

  // "stood still" warning: counts down to the 5-second derez
  idle(t, limit, touch = false) {
    const show = t > 0.6;
    const left = show ? Math.max(0, limit - t).toFixed(1) : '';
    this.set('idle', left, (v) => {
      const el = document.getElementById('idle');
      el.hidden = !v;
      if (v) el.innerHTML = `MOVE! <b>${v}</b><small>HOLD ${touch ? 'GAS' : '<kbd>W</kbd>'} — STANDING STILL DEREZZES YOU</small>`;
    });
  }

  spectate(r) {
    const key = r ? r.id : -1;
    this.set('spec', key, () => {
      const el = document.getElementById('spectate');
      el.hidden = !r;
      if (r) el.innerHTML = `SPECTATING <b style="color:${r.css}">${r.name}</b> <span><kbd>A</kbd><kbd>D</kbd> SWITCH</span>`;
    });
  }

  update(dt, cam, camYaw, spectating) {
    const sim = this.sim, p = sim.riders[sim.playerIndex];
    const e = this.el;

    this.set('round', sim.round, (v) => { e.roundNo.textContent = v; });
    const t = Math.floor(sim.time);
    this.set('time', t, (v) => { e.time.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; });

    if (sim.sudden) {
      this.set('col', 'on', () => { e.collapse.classList.add('on'); e.collapseText.textContent = 'ARENA COLLAPSING'; });
      const k = Math.round((sim.half / sim.map.half) * 100) / 100;
      this.set('colbar', k, (v) => { e.collapseBar.style.transform = `scaleX(${v})`; });
    } else {
      const left = Math.max(0, Math.ceil(sim.suddenAt - sim.time));
      this.set('col', left, (v) => { e.collapse.classList.remove('on'); e.collapseText.textContent = `COLLAPSE IN ${v}`; });
      const k = Math.round(Math.max(0, 1 - sim.time / sim.suddenAt) * 200) / 200;
      this.set('colbar', k, (v) => { e.collapseBar.style.transform = `scaleX(${v})`; });
    }

    // scoreboard
    sim.riders.forEach((r, i) => {
      const row = this.rows[i];
      this.set('pt' + i, r.score, (v) => {
        row.pt.textContent = v;
        row.pt.classList.remove('bump');
        void row.pt.offsetWidth;
        if (v > 0) row.pt.classList.add('bump');
      });
      const st = r.alive ? (r.air > 0 ? '▲' : '') : '✕';
      this.set('st' + i, st, (v) => { row.st.textContent = v; row.row.classList.toggle('dead', v === '✕'); });
    });

    // speed / boost / jump for the player
    const kmh = Math.round(p.alive ? p.speed * 9 : 0);
    this.set('kmh', kmh, (v) => { e.speed.textContent = String(v).padStart(3, '0'); });
    const sk = Math.round(Math.min(1, (p.alive ? p.speed : 0) / (BASE_SPEED * BOOST_MULT)) * 200) / 2;
    this.set('sk', sk, (v) => { e.gSpeed.style.strokeDashoffset = 100 - v; });
    const bp = Math.round(p.boost * 100);
    this.set('bp', bp, (v) => {
      e.gBoost.style.strokeDashoffset = 100 - v;
      e.boostPct.textContent = v;
      e.gBoost.classList.toggle('low', v < 20);
    });
    const jr = p.jump >= 1 ? 'ready' : p.air > 0 ? 'air' : 'charge';
    this.set('jr', jr, (v) => {
      e.jump.classList.toggle('ready', v === 'ready');
      e.jump.classList.toggle('air', v === 'air');
      e.jumpState.textContent = v === 'ready' ? 'JUMP' : v === 'air' ? 'AIR' : 'CHARGING';
    });
    const jf = Math.round(p.jump * 100);
    this.set('jf', jf, (v) => { e.jFill.style.strokeDashoffset = 100 - v; });
    const grinding = p.alive && p.grind > 0.08;
    this.set('grind', grinding, (v) => e.grind.classList.toggle('on', v));

    this.updateTags(cam, spectating);
    this.drawMap(camYaw);
  }

  updateTags(cam, spectating) {
    const sim = this.sim, w = window.innerWidth, h = window.innerHeight;
    sim.riders.forEach((r, i) => {
      const tag = this.tags[i];
      if (!tag) return;
      if (!r.alive || sim.over) { if (!tag.hidden) tag.hidden = true; return; }
      const fx = r.fx, fz = r.fz;
      this.v.set(r.x - fx * 1.5, r.y + 2.3, r.z - fz * 1.5).project(cam);
      const d = Math.hypot(r.x - cam.position.x, r.z - cam.position.z);
      const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1 && d < 140;
      if (!vis) { if (!tag.hidden) tag.hidden = true; return; }
      tag.hidden = false;
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      const s = Math.max(0.7, Math.min(1.2, 30 / Math.max(10, d)));
      tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
      tag.style.opacity = d > 100 ? String(Math.max(0, (140 - d) / 40)) : '1';
    });
  }

  drawMap(yaw) {
    const cv = this.el.map, ctx = this.mapCtx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw) return;
    if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sim = this.sim;
    const full = sim.map.half;
    const scale = (Math.min(W, H) * 0.5) / (full * 1.42);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(yaw); // heading-up: the direction you ride points to the top of the map
    ctx.scale(scale, scale);

    drawArenaStatic(ctx, sim.map, 1 / scale);
    drawArenaLive(ctx, sim, 1 / scale);
    const hf = sim.half;
    ctx.strokeStyle = sim.sudden ? 'rgba(255,60,80,0.95)' : 'rgba(160,240,255,0.7)';
    ctx.lineWidth = 2.2 / scale;
    ctx.strokeRect(-hf, -hf, hf * 2, hf * 2);

    // walls
    ctx.lineCap = 'square';
    for (const r of sim.riders) {
      if (!r.alive && r.derez >= 1) continue;
      ctx.globalAlpha = r.alive ? 0.95 : Math.max(0, 1 - r.derez) * 0.7;
      ctx.strokeStyle = r.css;
      ctx.lineWidth = (r.bot ? 1.6 : 2.2) / scale;
      ctx.beginPath();
      for (const w of r.walls) {
        ctx.moveTo(w.ax, w.az);
        ctx.lineTo(w.bx, w.bz);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // heads
    for (const r of sim.riders) {
      if (!r.alive) continue;
      const a = Math.atan2(r.fz, r.fx);
      ctx.save();
      ctx.translate(r.x, r.z);
      ctx.rotate(a);
      const s = (r.bot ? 5 : 7) / scale;
      ctx.fillStyle = r.bot ? r.css : '#ffffff';
      ctx.shadowColor = r.css;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, s * 0.65); ctx.lineTo(-s * 0.4, 0); ctx.lineTo(-s * 0.7, -s * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Short celebratory call-outs for style: close calls, big air, pads, pickups, streaks.
  popup(text, css = '#8ff6ff', big = false) {
    const box = document.getElementById('popups');
    const el = document.createElement('div');
    el.className = 'pop' + (big ? ' big' : '');
    el.style.setProperty('--c', css);
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 1400);
  }

  ghost(t) {
    const v = t > 0 ? t.toFixed(1) : '';
    this.set('ghost', v, (val) => {
      const el = document.getElementById('ghost-badge');
      el.hidden = !val;
      if (val) el.innerHTML = `GHOST <b>${val}</b>`;
    });
  }

  // Map picker cards on the title screen.
  buildMapCards(selected, onPick) {
    const box = document.getElementById('maps');
    box.innerHTML = '';
    this.mapCards = MAP_ORDER.map((id) => {
      const m = MAPS[id];
      const card = document.createElement('button');
      card.className = 'map-card';
      card.dataset.map = id;
      card.style.setProperty('--c', m.accent);
      card.setAttribute('role', 'radio');
      card.innerHTML = `<canvas></canvas><div class="mc-body"><div class="mc-name">${m.name}</div>
        <div class="mc-size">${m.half === 92 ? 'CLASSIC SIZE' : '+50% ARENA'}</div>
        <div class="mc-tag">${m.tagline}</div>
        <ul>${m.blurb.map((b) => `<li>${b}</li>`).join('')}</ul></div>`;
      card.addEventListener('click', () => onPick(id));
      box.appendChild(card);
      return card;
    });
    requestAnimationFrame(() => {
      for (const c of this.mapCards) drawPreview(c.querySelector('canvas'), MAPS[c.dataset.map]);
    });
    this.selectMap(selected);
  }

  selectMap(id) {
    for (const c of this.mapCards || []) {
      const on = c.dataset.map === id;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  feed(html, css) {
    const it = document.createElement('div');
    it.className = 'item';
    it.style.setProperty('--c', css || '#22e8ff');
    it.innerHTML = html;
    this.el.feed.prepend(it);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => it.classList.add('out'), 4200);
    setTimeout(() => it.remove(), 4700);
  }

  clearFeed() { this.el.feed.innerHTML = ''; }

  count(text, go = false) {
    const c = this.el.count;
    c.textContent = text;
    c.className = go ? 'go' : '';
    void c.offsetWidth;
    c.classList.add('pop');
  }

  banner(text, cls = 'good', sub = '') {
    const b = this.el.banner, s = this.el.sub;
    b.textContent = text;
    b.className = cls;
    void b.offsetWidth;
    b.classList.add('show');
    s.textContent = sub;
    s.className = '';
    if (sub) { void s.offsetWidth; s.classList.add('show'); }
  }

  flash(color = '#ffffff', peak = 0.55, ms = 140) {
    if (this.reduced) peak *= 0.4;
    this.el.flash.style.background = color;
    this.el.flash.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }

  // Round or match summary. gains: per-rider points earned this round.
  results({ kicker, title, cls, gains, actions, hint }) {
    $('res-kicker').textContent = kicker;
    $('res-title').textContent = title;
    const card = document.querySelector('.res-card');
    card.className = 'res-card panel ' + (cls || '');
    const sorted = [...this.sim.riders].sort((a, b) => b.score - a.score);
    const top = Math.max(MATCH_POINTS, sorted[0].score);
    $('res-table').innerHTML = sorted.map((r) => `
      <div class="res-row" style="--c:${r.css}">
        <i></i><span class="nm">${r.name}</span>
        <span class="gain">${gains && gains[r.id] ? '+' + gains[r.id] : ''}</span>
        <span class="tot">${r.score}</span>
        <span class="bar"><b data-w="${(r.score / top) * 100}"></b></span>
      </div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const b of document.querySelectorAll('#res-table .bar b')) b.style.width = b.dataset.w + '%';
    }));
    const act = $('res-actions');
    act.innerHTML = '';
    for (const a of actions || []) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (a.primary ? ' primary' : '');
      btn.innerHTML = `<span>${a.label}</span>${a.key ? `<kbd>${a.key}</kbd>` : ''}`;
      btn.addEventListener('click', a.onClick);
      btn.addEventListener('pointerenter', () => a.hover?.());
      act.appendChild(btn);
    }
    $('res-hint').textContent = hint || '';
    this.el.banner.className = '';
    this.el.banner.textContent = '';
    this.el.sub.className = '';
    this.el.sub.textContent = '';
    $('results').hidden = false;
  }

  hideResults() { $('results').hidden = true; }
}

export { DIFFICULTY, SUDDEN_DEATH_AT };
