import './style.css';
import { Sim } from './sim.js';
import { Bot } from './ai.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { Pipeline } from './render/pipeline.js';
import { View } from './render/view.js';
import * as C from './config.js';
import { seedRandom } from './rng.js';
import { MAPS, MAP_ORDER } from './maps.js';
import { TouchControls, isTouchDevice } from './touch.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- persistent settings ----------
const settings = { difficulty: 'pilot', map: 'grid', music: 0.55, sfx: 0.9, muted: false, reduced: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('lightwake') || '{}')); } catch { /* private mode */ }
if (!C.DIFFICULTY[settings.difficulty]) settings.difficulty = 'pilot';
if (MAPS[params.get('map')]) settings.map = params.get('map'); // share links: ?map=mesa
if (!MAPS[settings.map]) settings.map = 'grid';
const save = () => { try { localStorage.setItem('lightwake', JSON.stringify(settings)); } catch { /* ignore */ } };

const sim = new Sim(MAPS[settings.map]);
const input = new Input();
const audio = new AudioEngine();
audio.volume.music = settings.music;
audio.volume.sfx = settings.sfx;
audio.muted = settings.muted;

const bots = sim.riders.map((r, i) => new Bot(sim, r, i === 0 ? 'ace' : settings.difficulty, i === 0 ? 'survivor' : r.persona));
const player = sim.riders[sim.playerIndex];

let pipe, view, hud, touch = null;
const TOUCH = isTouchDevice();
let bootDone;
const bootReady = new Promise((res) => { bootDone = res; });

const game = {
  state: 'boot',        // boot | menu | countdown | play | roundEnd | results | matchEnd
  paused: false,
  frozen: false,        // test hook: stop simulation, keep rendering
  attract: true,
  autopilot: params.has('autopilot'),
  countT: 0,
  lastCount: -1,
  endT: 0,
  resultsT: 0,
  timeScale: 1,
  hitstop: 0,
  hitstopScale: 1,
  spectate: 0,
  hurried: false,
  deathT: 0,
  kills: [],
  scripted: new Set(),  // rider ids a script drives directly (trailer capture)
  cameraHook: null,     // trailer capture: overrides the camera after the rig runs
  capturing: false,
  roundStart: [0, 0, 0, 0],
  frame: 0,
  fps: 0,
  fpsAcc: 0,
  fpsN: 0,
  last: 0,
};

// ---------- flow ----------

function applyMap(id, persist = true) {
  const map = MAPS[id];
  if (persist) {
    settings.map = id;
    save();
  }
  sim.setMap(map);
  view.setMap(map);
  hud.selectMap(id);
  audio.setMusic(map.music, map.theme);
  pipe.renderer.toneMappingExposure = view.world.exposure;
  if (game.state === 'menu') startAttract();
}

function cycleMap(dir) {
  const i = MAP_ORDER.indexOf(settings.map);
  applyMap(MAP_ORDER[(i + dir + MAP_ORDER.length) % MAP_ORDER.length]);
  audio.uiClick();
}

function startAttract() {
  game.attract = true;
  sim.resetMatch();
  sim.startRound();
  bots.forEach((b) => b.reset());
  view.resetRound();
  view.rig.mode = 'orbit';
  game.endT = 0;
}

function showMenu() {
  game.state = 'menu';
  game.paused = false;
  $('pause').hidden = true;
  hud.hideResults();
  hud.show(false);
  $('menu').hidden = false;
  audio.setIntensity(0);
  audio.setPausedMusic(false);
  startAttract();
  setTimeout(() => $('btn-play').focus({ preventScroll: true }), 50);
}

function startMatch() {
  audio.unlock();
  audio.uiClick();
  $('menu').hidden = true;
  hud.hideResults();
  game.attract = false;
  bots.forEach((b, i) => { if (i !== 0) b.setDifficulty(settings.difficulty); });
  sim.resetMatch();
  hud.clearFeed();
  startRound();
}

function startRound() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  hud.hideResults();
  sim.startRound();
  bots.forEach((b) => b.reset());
  view.resetRound();
  game.state = 'countdown';
  game.countT = 0;
  game.lastCount = -1;
  game.timeScale = 1;
  game.hitstop = 0;
  game.spectate = sim.playerIndex;
  game.hurried = false;
  game.deathT = 0;
  game.kills = [];
  game.roundStart = sim.riders.map((r) => r.score);
  input.clear();
  view.rig.mode = 'intro';
  view.rig.intro = 0;
  hud.show(true);
  hud.showKeys(sim.round <= 2);
  audio.setIntensity(1);
}

function endRoundResults() {
  game.state = sim.matchWinner ? 'matchEnd' : 'results';
  game.resultsT = 0;
  const gains = sim.riders.map((r, i) => r.score - game.roundStart[i]);
  const w = sim.winner;
  if (sim.matchWinner) {
    const won = sim.matchWinner === player;
    if (won) audio.roundWin(); else audio.roundLose();
    audio.setIntensity(0);
    hud.results({
      kicker: `MATCH OVER · ${sim.round} ROUNDS`,
      title: won ? 'GRID CHAMPION' : `${sim.matchWinner.name} WINS THE MATCH`,
      cls: won ? 'win' : 'lose',
      gains,
      actions: [
        { label: 'REMATCH', key: 'ENTER', primary: true, onClick: () => { audio.uiClick(); startMatch(); }, hover: () => audio.uiHover() },
        { label: 'MAIN MENU', key: 'ESC', onClick: () => { audio.uiClick(); showMenu(); }, hover: () => audio.uiHover() },
      ],
      hint: `YOU: ${player.roundsWon} ROUNDS WON · ${player.totalKills} DEREZZES`,
    });
  } else {
    const title = w ? (w === player ? 'YOU TAKE THE ROUND' : `${w.name} TAKES THE ROUND`) : 'NO SURVIVORS';
    hud.results({
      kicker: `ROUND ${sim.round}`,
      title,
      cls: w === player ? 'win' : 'lose',
      gains,
      actions: [],
      hint: TOUCH ? 'TAP TO CONTINUE' : 'SPACE / ENTER — NEXT ROUND',
    });
  }
}

function setPaused(p) {
  if (!['countdown', 'play', 'roundEnd'].includes(game.state)) return;
  game.paused = p;
  $('pause').hidden = !p;
  audio.setPausedMusic(p);
  input.jump = false; // held keys stay tracked (keyup still arrives while paused)
  if (!p && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (p) setTimeout(() => $('btn-resume').focus({ preventScroll: true }), 30);
}

// ---------- events ----------

const DEATH_SUB = { self: 'YOUR OWN WALL', idle: 'STOOD STILL TOO LONG', terrain: 'WIPED OUT ON THE TERRAIN', void: 'LOST TO THE VOID', laser: 'THE REACTOR LASER', boundary: 'THE BARRIER' };
const PICKUP_TEXT = { boost: ['BOOST FULL', '#3df0ff'], jump: ['JUMP CHARGED', '#9dff4a'], ghost: ['GHOST — RIDE THROUGH WALLS', '#c77dff'] };

function reasonText(e) {
  const v = `<b style="color:${e.rider.css}">${e.rider.name}</b>`;
  const k = e.killer ? `<b style="color:${e.killer.css}">${e.killer.name}</b>` : '';
  switch (e.cause) {
    case 'wall': return `${k} derezzed ${v}`;
    case 'self': return `${v} hit their own wall`;
    case 'boundary': return `${v} hit the barrier`;
    case 'idle': return `${v} stood still too long`;
    case 'terrain': return `${v} wiped out on the terrain`;
    case 'void': return `${v} fell into the void`;
    case 'laser': return `${v} was sliced by the reactor laser`;
    case 'collide': return `${v} collided with ${k}`;
    default: return `${v} derezzed`;
  }
}

function focusRider() {
  if (game.attract) return null;
  if (game.deathT > 0) return player;
  return sim.riders[game.spectate];
}

function pickSpectate(pref) {
  const alive = sim.riders.filter((r) => r.alive);
  if (pref && pref.alive) return pref.id;
  if (alive.length) return alive[0].id;
  return game.spectate;
}

function cycleSpectate(dir) {
  if (player.alive || game.attract) return;
  const alive = sim.riders.filter((r) => r.alive);
  if (alive.length < 2) return;
  const idx = alive.findIndex((r) => r.id === game.spectate);
  game.spectate = alive[(idx + dir + alive.length) % alive.length].id;
  audio.uiHover();
}

function hitstop(sec, scale) {
  game.hitstop = Math.max(game.hitstop, sec);
  game.hitstopScale = scale;
}

function processEvents() {
  const focus = focusRider();
  for (const e of sim.events) {
    view.handle(e, focus || null);
    if (game.attract) continue;
    const r = e.rider;
    switch (e.type) {
      case 'crash': {
        const f = focus || player;
        const dx = e.x - view.camera.position.x, dz = e.z - view.camera.position.z;
        const yaw = view.rig.yaw;
        const pan = Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / (Math.hypot(dx, dz) + 1)));
        audio.crash(Math.hypot(e.x - f.x, e.z - f.z), pan, r === player);
        hud.feed(reasonText(e), e.killer ? e.killer.css : r.css);
        if (r === player) {
          hud.banner('DEREZZED', 'danger', e.cause === 'wall' || e.cause === 'collide' ? `BY ${e.killer.name}` : (DEATH_SUB[e.cause] || 'THE BARRIER'));
          hud.flash('#ff3350', 0.5, 220);
          pipe.u.aberration.value = 1;
          hitstop(0.16, 0.08);
          game.spectate = pickSpectate(e.killer && e.killer !== player ? e.killer : null);
          game.deathT = 2.0;
          view.rig.startDeath(e.x, e.y, e.z);
        } else if (e.killer === player && e.cause === 'wall') {
          hud.banner(`+${C.KILL_POINTS} DEREZ`, 'good', r.name);
          audio.kill();
          game.kills = game.kills.filter((t) => sim.time - t < 5);
          game.kills.push(sim.time);
          if (game.kills.length >= 2) {
            const n = game.kills.length;
            hud.popup(n >= 3 ? 'TRIPLE DEREZ' : 'DOUBLE DEREZ', '#ffd166', true);
            audio.streak(n);
          }
          pipe.u.aberration.value = 0.5;
          hitstop(0.07, 0.05);
        } else if (!player.alive && r.id === game.spectate) {
          game.spectate = pickSpectate(e.killer);
        }
        break;
      }
      case 'boost': if (r === player) audio.boost(); break;
      case 'jump': if (r === player) audio.jump(); break;
      case 'land': if (r === player) audio.land(); break;
      case 'bigAir':
        if (r === player) { hud.popup(`BIG AIR ${e.air.toFixed(1)}s`, '#ff9de2', e.air > 1.3); audio.bigAir(e.air); }
        break;
      case 'nearMiss':
        if (r === player) { hud.popup('CLOSE CALL', '#ffffff'); audio.nearMiss(); }
        break;
      case 'pad':
        if (r === player) { hud.popup('BOOST PAD', '#ffc04d'); audio.pad(); }
        break;
      case 'portal':
        if (r === player) { hud.popup('WARP', e.color); audio.portal(); }
        break;
      case 'pickup':
        if (r === player) { const [txt, css] = PICKUP_TEXT[e.pickup.type]; hud.popup(txt, css, true); audio.pickup(e.pickup.type); }
        break;
      case 'jumpReady': if (r === player) audio.jumpReady(); break;
      case 'sudden':
        hud.banner('ARENA COLLAPSING', 'danger', 'THE WALLS ARE CLOSING IN');
        audio.sudden();
        audio.setIntensity(3);
        break;
      case 'roundOver':
        game.state = 'roundEnd';
        game.endT = 0;
        if (e.winner === player) {
          hud.banner('LAST RIDER STANDING', 'good', `+${C.WIN_POINTS}`);
          audio.roundWin();
        } else if (!e.winner) {
          hud.banner('NO SURVIVORS', 'warn');
        } else if (player.alive === false) {
          audio.roundLose();
        }
        if (e.winner) game.spectate = e.winner.id;
        break;
      default:
    }
  }
  sim.events.length = 0;
}

// ---------- loop ----------

// reused every frame so the hot path allocates nothing
const audioRiders = sim.riders.map(() => ({ alive: false, speed: 0, boosting: false, x: 0, z: 0, vx: 0, vz: 0 }));
const audioListener = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0 };

function applyPlayerInput() {
  if (game.autopilot) return; // bot 0 drives the player inside stepSim
  player.steer = input.steer;
  player.wantThrottle = input.throttle;
  player.wantBrake = input.brake;
  player.wantBoost = input.boost;
  if (input.takeJump()) player.wantJump = true;
}

function stepSim(dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < bots.length; k++) {
      if (k === sim.playerIndex && !game.attract && !game.autopilot) continue;
      if (game.scripted.has(k)) continue;
      bots[k].update(h);
    }
    sim.step(h);
  }
}

function update(realDt) {
  let gameDt = 0;
  const st = game.state;

  if (!game.paused && !game.frozen) {
    if (game.attract) {
      gameDt = realDt;
      stepSim(gameDt);
      if (sim.over) {
        game.endT += realDt;
        if (game.endT > 3) { sim.startRound(); bots.forEach((b) => b.reset()); view.resetRound(); game.endT = 0; }
      }
      if (sim.time > 70) sim.hurry();
    } else if (st === 'countdown') {
      game.countT += realDt;
      const n = 3 - Math.floor(game.countT / 0.85);
      if (n !== game.lastCount && n >= 0) {
        game.lastCount = n;
        hud.count(n > 0 ? String(n) : 'RIDE', n === 0);
        audio.countdown(n);
        if (n === 0 && sim.round === 1) hud.banner(TOUCH ? 'HOLD GAS TO RIDE' : 'HOLD W TO RIDE', 'good', TOUCH ? '◀ ▶ TO STEER' : 'A / D TO STEER');
        if (n === 3) hud.banner(sim.map.name, 'good', `ROUND ${sim.round}`);
      }
      if (game.countT >= 2.55) {
        game.state = 'play';
        input.jump = false; // keep held keys: people hold W through the countdown
      }
    } else if (st === 'play' || st === 'roundEnd' || st === 'results' || st === 'matchEnd') {
      if (st === 'play') applyPlayerInput();
      let scale = 1;
      if (game.hitstop > 0) { game.hitstop -= realDt; scale = game.hitstopScale; }
      if (st === 'roundEnd') {
        game.endT += realDt;
        game.timeScale += (0.35 - game.timeScale) * (1 - Math.exp(-realDt * 4));
        if (game.endT >= C.ROUND_END_DELAY) endRoundResults();
      } else if (st === 'results' || st === 'matchEnd') {
        game.timeScale += (0.6 - game.timeScale) * (1 - Math.exp(-realDt * 2));
        game.resultsT += realDt;
        if (st === 'results' && game.resultsT > 7) startRound();
      }
      gameDt = Math.min(realDt, 1 / 20) * scale * game.timeScale;
      stepSim(gameDt);
      if (!player.alive && !game.hurried && !sim.over) { sim.hurry(); game.hurried = true; }
      if (!player.alive && !sim.riders[game.spectate].alive) game.spectate = pickSpectate(null);
    }
  }

  processEvents();
  if (game.deathT > 0 && !game.paused && !game.frozen) {
    game.deathT -= realDt;
    if (game.deathT <= 0) view.rig.mode = 'chase';
  }
  const spectating = !game.attract && !player.alive && game.deathT <= 0 && ['play', 'roundEnd'].includes(game.state);
  hud.spectate(spectating ? sim.riders[game.spectate] : null);
  const focus = focusRider();
  view.update(gameDt, realDt, focus, pipe);
  if (game.cameraHook) game.cameraHook(realDt);

  // audio follows the camera
  if (audio.ready) {
    const active = !game.attract && !game.paused && ['countdown', 'play', 'roundEnd', 'results'].includes(game.state);
    const yaw = view.rig.yaw;
    const L = audioListener;
    L.x = view.camera.position.x; L.z = view.camera.position.z; L.yaw = yaw;
    L.vx = view.target ? view.target.vx : 0; L.vz = view.target ? view.target.vz : 0;
    for (let i = 0; i < sim.riders.length; i++) {
      const r = sim.riders[i], a = audioRiders[i];
      a.alive = r.alive; a.speed = r.speed; a.boosting = r.boosting; a.x = r.x; a.z = r.z;
      a.vx = r.fx * r.speed; a.vz = r.fz * r.speed;
    }
    audio.updateEngines(audioRiders, L, active);
    const carve = Math.abs(player.turn) * Math.min(1, player.speed / 26);
    audio.setGrind(active && player.alive ? Math.max(player.grind, carve > 0.5 ? (carve - 0.5) * 0.6 : 0) : 0);
    // reactor lasers hum louder the closer the camera is to an arm
    let laser = 0;
    for (const s of sim.sweepers) {
      for (const a of s.angles) {
        const ax = s.x + Math.cos(a) * s.inner, az = s.z + Math.sin(a) * s.inner;
        const bx = s.x + Math.cos(a) * s.len, bz = s.z + Math.sin(a) * s.len;
        const vx = bx - ax, vz = bz - az;
        const t = Math.max(0, Math.min(1, ((L.x - ax) * vx + (L.z - az) * vz) / (vx * vx + vz * vz)));
        const d = Math.hypot(ax + vx * t - L.x, az + vz * t - L.z);
        laser = Math.max(laser, Math.exp(-d / 9));
      }
    }
    audio.setLaser(active ? laser : 0);
  }

  if (touch) {
    const riding = !game.attract && !game.paused && ['countdown', 'play', 'roundEnd'].includes(game.state);
    if (riding !== touch.visible) { touch.visible = riding; touch.show(riding); document.body.classList.toggle('riding', riding); }
    if (riding) touch.update(player);
  }
  if (!game.attract && game.state !== 'menu') {
    hud.update(realDt, view.camera, view.rig.yaw, !player.alive);
    hud.idle(game.state === 'play' && player.alive ? player.stillT : 0, C.IDLE_LIMIT, TOUCH);
    hud.ghost(player.alive ? player.ghostT : 0);
  }
}

let loopErrors = 0;
function loop(now) {
  try {
    frame(now);
  } catch (err) {
    // never let one bad frame take the whole game down silently
    if (loopErrors++ < 3) console.error(err);
  }
}

function frame(now) {
  const t = now / 1000;
  let realDt = game.last ? t - game.last : 1 / 60;
  game.last = t;
  if (realDt > 0.25) realDt = 1 / 60; // returning from a background tab
  realDt = Math.min(realDt, 0.1);
  game.frame++;
  game.fpsAcc += realDt;
  game.fpsN++;
  if (game.fpsAcc >= 0.5) { game.fps = Math.round(game.fpsN / game.fpsAcc); game.fpsAcc = 0; game.fpsN = 0; }

  update(realDt);
  pipe.render();
  if (!game.capturing) pipe.track(realDt, t);
  publishDiagnostics();
}

// ---------- UI wiring ----------

function wireUI() {
  $('btn-play').addEventListener('click', startMatch);
  for (const b of document.querySelectorAll('#diff button')) {
    b.addEventListener('click', () => {
      audio.unlock();
      settings.difficulty = b.dataset.d;
      save();
      hud.setDifficultyText(settings.difficulty);
      audio.uiClick();
    });
  }
  for (const b of document.querySelectorAll('.btn, .seg button')) b.addEventListener('pointerenter', () => audio.uiHover());
  $('btn-resume').addEventListener('click', () => { audio.uiClick(); setPaused(false); });
  $('btn-restart').addEventListener('click', () => { audio.uiClick(); game.paused = false; $('pause').hidden = true; audio.setPausedMusic(false); startMatch(); });
  $('btn-quit').addEventListener('click', () => { audio.uiClick(); showMenu(); });

  const vm = $('vol-music'), vs = $('vol-sfx'), om = $('opt-motion');
  vm.value = settings.music; vs.value = settings.sfx; om.checked = settings.reduced;
  vm.addEventListener('input', () => { settings.music = +vm.value; audio.setVolume('music', settings.music); save(); });
  vs.addEventListener('input', () => { settings.sfx = +vs.value; audio.setVolume('sfx', settings.sfx); save(); });
  om.addEventListener('change', () => { settings.reduced = om.checked; applyMotion(); save(); });

  input.on('pause', () => {
    if (game.state === 'matchEnd') { showMenu(); return; }
    setPaused(!game.paused);
  });
  input.on('mute', () => { settings.muted = !settings.muted; audio.setMuted(settings.muted); save(); });
  input.on('confirm', (code) => {
    if (game.paused) return;
    // a focused button handles Enter itself (native click), so don't start twice
    const onButton = document.activeElement instanceof HTMLButtonElement && !document.activeElement.closest('[hidden]');
    if (game.state === 'menu' && code === 'Enter' && !onButton) startMatch();
    else if (game.state === 'results' && game.resultsT > 0.6) { audio.uiClick(); startRound(); }
    else if (game.state === 'matchEnd' && code === 'Enter' && game.resultsT > 0.8) { audio.uiClick(); startMatch(); }
  });
  input.on('left', () => (game.state === 'menu' ? cycleMap(-1) : cycleSpectate(-1)));
  input.on('right', () => (game.state === 'menu' ? cycleMap(1) : cycleSpectate(1)));

  // any gesture unlocks audio so the menu music can start
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // pause when the window loses focus mid-round
  window.addEventListener('blur', () => { if (game.state === 'play' && !game.paused) setPaused(true); });

  if (TOUCH) {
    document.body.classList.add('touch');
    touch = new TouchControls(input, {
      pause: () => { if (game.state === 'matchEnd') showMenu(); else setPaused(!game.paused); },
      left: () => cycleSpectate(-1),
      right: () => cycleSpectate(1),
    });
    // between rounds a tap anywhere continues
    $('results').addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      if (game.state === 'results' && game.resultsT > 0.6) { audio.uiClick(); startRound(); }
    });
    const portrait = matchMedia('(orientation: portrait)');
    const note = () => { $('rotate-note').hidden = !portrait.matches; };
    note();
    portrait.addEventListener('change', note);
  }
}

function applyMotion() {
  view.rig.reduced = settings.reduced;
  hud.reduced = settings.reduced;
}

// ---------- test hooks & diagnostics (see threejs-qa-release) ----------

function publishDiagnostics() {
  const s = pipe.stats();
  const d = window.__THREE_GAME_DIAGNOSTICS__ || (window.__THREE_GAME_DIAGNOSTICS__ = { renderer: {} });
  Object.assign(d.renderer, { calls: s.calls, triangles: s.triangles, geometries: s.geometries, textures: s.textures });
  d.backend = s.backend;
  d.dpr = s.dpr;
  d.fps = game.fps;
  d.frame = game.frame;
  d.state = game.paused ? 'paused' : game.state;
  d.round = sim.round;
  d.map = sim.map.id;
  d.time = sim.time;
  const p = d.player || (d.player = {});
  p.x = player.x; p.z = player.z; p.heading = player.heading; p.stillT = player.stillT; p.alive = player.alive; p.score = player.score;
  p.speed = player.speed; p.boost = player.boost; p.jump = player.jump; p.air = player.air > 0; p.odo = player.odo;
  d.half = sim.half;
  d.paused = game.paused;
  const sc = d.scores || (d.scores = [0, 0, 0, 0]), al = d.alive || (d.alive = [true, true, true, true]);
  for (let i = 0; i < 4; i++) { sc[i] = sim.riders[i].score; al[i] = sim.riders[i].alive; }
}

function fastForward(seconds) {
  const step = 1 / 120;
  for (let t = 0; t < seconds; t += step) {
    stepSim(step);
    if (sim.over) break;
  }
  processEvents();
}

// Installed immediately; every hook waits for boot so harnesses can call them as soon as the page loads.
function installHooks() {
  window.__THREE_GAME_TEST_HOOKS__ = {
    async seed(n) { seedRandom(n >>> 0); return { seed: n }; },
    async setPausedForScreenshot(p) { await bootReady; game.frozen = !!p; return { paused: game.frozen }; },
    async setState(name) {
      await bootReady;
      $('boot').hidden = true;
      audio.unlock();
      const begin = (auto = true) => {
        game.autopilot = auto;
        startMatch();
        game.state = 'play';
        view.rig.mode = 'chase';
        hud.el.count.textContent = '';
      };
      switch (name) {
        case 'menu': showMenu(); break;
        case 'active-play': begin(); fastForward(4); break;
        case 'boost': begin(); fastForward(3); game.autopilot = false; player.boost = 1; player.wantThrottle = true; player.wantBoost = true; player.steer = 0; fastForward(0.6); break;
        case 'grind': begin(); fastForward(6); break;
        case 'sudden-death': begin(); sim.suddenAt = 1; fastForward(9); break;
        case 'crash': {
          begin(); fastForward(2); game.autopilot = false;
          player.wantBoost = false; player.wantBrake = false; player.wantThrottle = true; player.steer = 0;
          for (let i = 0; i < 1200 && player.alive; i++) stepSim(1 / 120);
          processEvents();
          break;
        }
        case 'round-results': begin(); fastForward(200); game.state = 'roundEnd'; game.endT = 99; update(0.016); break;
        case 'match-results':
          begin(); player.score = C.MATCH_POINTS; sim.riders[1].score = 8; sim.riders[2].score = 4; sim.riders[3].score = 7;
          fastForward(200); game.state = 'roundEnd'; game.endT = 99; update(0.016); break;
        case 'pause': begin(); fastForward(3); setPaused(true); break;
        case 'countdown': game.autopilot = false; startMatch(); break;
        case 'idle': {
          begin(); fastForward(2); game.autopilot = false;
          player.wantThrottle = false; player.wantBoost = false; player.wantBrake = true; player.steer = 0;
          fastForward(3.6);
          break;
        }
        default: throw new Error(`unknown state: ${name}`);
      }
      return { state: name };
    },
    async autopilot(on) { await bootReady; game.autopilot = !!on; return { autopilot: game.autopilot }; },
    async setMap(id) { await bootReady; if (!MAPS[id]) throw new Error(`unknown map: ${id}`); game.state = 'menu'; applyMap(id); return { map: id }; },
  };
}

// ---------- boot ----------

function setBoot(p, text) {
  $('boot-bar').style.width = `${Math.round(p * 100)}%`;
  if (text) $('boot-text').textContent = text;
}

async function boot() {
  try {
    setBoot(0.08, 'INITIALIZING GRID');
    pipe = new Pipeline($('stage'));
    view = new View(sim, MAP_ORDER.map((id) => MAPS[id]));
    await pipe.init(view.scene, view.camera);
    view.world.buildEnvironment(pipe.renderer);
    hud = new Hud(sim);
    hud.setDifficultyText(settings.difficulty);
    hud.buildMapCards(settings.map, (id) => { audio.unlock(); audio.uiClick(); applyMap(id); });
    $('backend-tag').textContent = pipe.backend === 'WebGPU' ? 'WEBGPU' : 'WEBGL2';
    applyMotion();
    wireUI();
    if (import.meta.env.DEV) window.__lw = { sim, view, pipe, hud, audio, game, bots };

    // Compile every arena's shaders up front so switching maps or starting a match never hitches.
    // (warm-up visits don't count as the player's choice)
    const chosen = settings.map;
    for (const [i, id] of MAP_ORDER.entries()) {
      setBoot(0.2 + (i / MAP_ORDER.length) * 0.6, `BUILDING ${MAPS[id].name}`);
      applyMap(id, false);
      startAttract();
      for (const r of view.debris.rings) { r.mesh.visible = true; r.mesh.scale.setScalar(0.001); }
      for (const b of view.bikes) b.exhaust.visible = true;
      view.update(1 / 60, 1 / 60, null, pipe);
      await pipe.warmup();
      pipe.render();
      await new Promise((res) => requestAnimationFrame(res));
    }
    for (const r of view.debris.rings) r.mesh.visible = false;
    setBoot(0.9, 'SPINNING UP CYCLES');
    applyMap(chosen);
    pipe.render();
    setBoot(1, 'READY');

    showMenu();
    $('boot').classList.add('out');
    setTimeout(() => { $('boot').hidden = true; }, 700);
    pipe.renderer.onDeviceLost = () => {
      // the GPU was reset (driver crash, phone backgrounding...): offer a clean restart
      setPaused(true);
      const t = $('boot-text');
      $('boot').hidden = false;
      $('boot').classList.remove('out');
      t.classList.add('err');
      t.textContent = 'The graphics device was reset. Tap or press any key to reload.';
      const reload = () => location.reload();
      window.addEventListener('pointerdown', reload, { once: true });
      window.addEventListener('keydown', reload, { once: true });
    };
    pipe.renderer.setAnimationLoop(loop);
    bootDone();
  } catch (err) {
    console.error(err);
    const t = $('boot-text');
    t.classList.add('err');
    t.textContent = `The grid could not start: ${err && err.message ? err.message : err}. LIGHTWAKE needs a browser with WebGPU or WebGL2 (current Chrome, Edge, Safari or Firefox).`;
  }
}

// Trailer capture: frame-exact recording driven from test/record.mjs (only with ?capture).
if (params.has('capture')) {
  window.__capture = {
    async begin(seconds) {
      await bootReady;
      const { installVirtualClock } = await import('./capture.js');
      const { Director } = await import('./director.js');
      pipe.renderer.setAnimationLoop(null);
      game.capturing = true;
      const clock = installVirtualClock();
      audio.unlock();
      audio.startOffline(seconds + 0.5, () => clock.elapsed);
      audio.setIntensity(0);
      game.last = clock.now / 1000;
      const director = new Director({
        sim, view, hud, audio, game, bots, player, pipe, input, C, MAPS,
        applyMap, startMatch, startRound, showMenu, setPaused,
      });
      this.clock = clock;
      this.director = director;
      return { ok: true };
    },
    async step() {
      this.clock.advance(1000 / 60);
      this.director.update(this.clock.elapsed);
      frame(this.clock.now);
      audio.schedule();
      await new Promise((r) => requestAnimationFrame(r));
      return this.clock.elapsed;
    },
    async end() {
      const buf = await audio.renderOffline();
      const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
      const out = new DataView(new ArrayBuffer(44 + n * 4));
      const str = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
      str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
      out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
      out.setUint32(24, 48000, true); out.setUint32(28, 48000 * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
      str(36, 'data'); out.setUint32(40, n * 4, true);
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      const g = peak > 0.98 ? 0.98 / peak : 1; // never clip the export
      for (let i = 0; i < n; i++) {
        out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * g)) * 32767, true);
        out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * g)) * 32767, true);
      }
      this.wav = new Uint8Array(out.buffer);
      return { bytes: this.wav.length, peak };
    },
    wavChunk(i, size = 1 << 20) {
      const part = this.wav.subarray(i * size, (i + 1) * size);
      let bin = '';
      for (let k = 0; k < part.length; k += 0x8000) bin += String.fromCharCode(...part.subarray(k, k + 0x8000));
      return btoa(bin);
    },
  };
}

installHooks();
boot();
