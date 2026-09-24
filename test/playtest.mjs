// Bot playtest through REAL keyboard input (threejs-qa-release playtest-bot).
// Round 1: press nothing and verify the 5-second idle rule derezzes you.
// Then: hold W, steer with A/D away from the arena edge, boost with Shift, jump with Space,
// pause/resume with Escape, advance rounds with Space, and check match end + rematch.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5188/';
const webgl = process.argv.includes('--webgl');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1440, height: 810, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url + (webgl ? '?webgl' : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 60000 });
const diag = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feed = () => page.evaluate(() => [...document.querySelectorAll('#feed .item')].map((e) => e.textContent));

const m = { idleRule: null, idleDeathAt: null, rounds: 0, steerPresses: 0, jumps: 0, boosts: 0, distance: 0, maxSpeed: 0, curvature: 0, pauseOk: false, matchEndSeen: false, rematchOk: false, fps: [] };

await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__.state === 'play', { timeout: 10000 });
// --- idle rule: touch nothing ---
const t0 = (await diag()).time;
await page.waitForFunction(() => !window.__THREE_GAME_DIAGNOSTICS__.player.alive, { timeout: 12000, polling: 50 });
const dead = await diag();
m.idleDeathAt = +(dead.time - t0).toFixed(2);
m.idleRule = (await feed()).some((t) => t.includes('stood still')) && m.idleDeathAt >= 4.9 && m.idleDeathAt < 5.6;

// --- drive for real ---
const deadline = Date.now() + Number(process.env.PLAY_SECONDS || 80) * 1000;
let lastState = '', lastOdo = 0, lastHeading = null, steering = null, boostHeld = false, pausedOnce = false, wHeld = false;
const key = async (k, down) => (down ? page.keyboard.down(k) : page.keyboard.up(k));
while (Date.now() < deadline) {
  const d = await diag();
  if (d.fps) m.fps.push(d.fps);
  if (d.state !== lastState) {
    if (d.state === 'results') { m.rounds++; await sleep(900); await page.keyboard.press('Space'); }
    lastState = d.state;
  }
  if (d.state === 'play' && d.player.alive) {
    if (!wHeld) { await key('KeyW', true); wHeld = true; }
    const p = d.player, h = d.half;
    m.maxSpeed = Math.max(m.maxSpeed, p.speed);
    if (p.odo > lastOdo) m.distance += p.odo - lastOdo;
    lastOdo = p.odo;
    if (lastHeading !== null) m.curvature += Math.abs(p.heading - lastHeading);
    lastHeading = p.heading;
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    const tx = fx > 0 ? (h - p.x) / fx : fx < 0 ? (-h - p.x) / fx : 1e9;
    const tz = fz > 0 ? (h - p.z) / fz : fz < 0 ? (-h - p.z) / fz : 1e9;
    const ahead = Math.min(tx, tz);
    const want = ahead < 30 ? 'KeyD' : (Math.random() < 0.04 ? (Math.random() < 0.5 ? 'KeyA' : 'KeyD') : null);
    if (want !== steering) {
      if (steering) await key(steering, false);
      if (want) { await key(want, true); m.steerPresses++; }
      steering = want;
    }
    if (!boostHeld && ahead > 70 && p.boost > 0.6) { await key('ShiftLeft', true); boostHeld = true; m.boosts++; }
    if (boostHeld && (ahead < 40 || p.boost < 0.1)) { await key('ShiftLeft', false); boostHeld = false; }
    if (p.jump >= 1 && Math.random() < 0.01) { await page.keyboard.press('Space'); m.jumps++; }
    if (!pausedOnce && d.time > 6) {
      pausedOnce = true;
      await page.keyboard.press('Escape'); await sleep(400);
      const a = await diag(); await sleep(500); const b = await diag();
      await page.keyboard.press('Escape'); await sleep(300);
      const c = await diag();
      m.pauseOk = a.paused && b.time === a.time && !c.paused;
      wHeld = false; // pause clears held keys
      await key('KeyW', false);
    }
  } else if (wHeld && d.state !== 'play') {
    await key('KeyW', false); wHeld = false;
    if (steering) { await key(steering, false); steering = null; }
    if (boostHeld) { await key('ShiftLeft', false); boostHeld = false; }
  }
  await sleep(40);
}
for (const k of ['KeyW', 'KeyA', 'KeyD', 'ShiftLeft']) await key(k, false);

await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('match-results'));
await sleep(1500);
m.matchEndSeen = (await diag()).state === 'matchEnd';
await page.keyboard.press('Enter');
await sleep(800);
const re = await diag();
m.rematchOk = ['countdown', 'play'].includes(re.state) && re.scores.every((s) => s === 0);
const f = m.fps.sort((a, b) => a - b);
m.fpsMedian = f[f.length >> 1]; m.fpsP5 = f[Math.floor(f.length * 0.05)];
delete m.fps;
m.curvature = +m.curvature.toFixed(1);
m.distance = Math.round(m.distance);
m.backend = re.backend;
m.errors = errors;
console.log(JSON.stringify(m, null, 2));
fs.writeFileSync(new URL('./shots/playtest.json', import.meta.url), JSON.stringify(m, null, 2));
await browser.close();
