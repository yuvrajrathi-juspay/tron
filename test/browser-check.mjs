// Drives the real game in Chrome: collects console/page errors, captures states via the
// test hooks, and reports renderer diagnostics. Usage: node test/browser-check.mjs [url] [--webgl] [--headful]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5188/';
const webgl = process.argv.includes('--webgl');
const headful = process.argv.includes('--headful');
const states = (process.argv.find((a) => a.startsWith('--states=')) || '--states=menu,active-play').slice(9).split(',');
const out = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: headful ? false : 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url + (webgl ? '?webgl' : ''), { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.frame > 30, { timeout: 60000 });
} catch (e) {
  console.log('BOOT FAILED', await page.evaluate(() => document.getElementById('boot-text')?.textContent));
}
console.log('boot ms', Date.now() - t0);
const gpu = await page.evaluate(async () => {
  if (!navigator.gpu) return 'no navigator.gpu';
  const a = await navigator.gpu.requestAdapter();
  return a ? (a.info ? `${a.info.vendor} ${a.info.architecture} ${a.info.description}` : 'adapter') : 'no adapter';
});
console.log('gpu', gpu);
for (const s of states) {
  try {
    const r = await page.evaluate((name) => window.__THREE_GAME_TEST_HOOKS__.setState(name), s);
    await new Promise((res) => setTimeout(res, 1500));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
    await new Promise((res) => setTimeout(res, 300));
    const d = await page.evaluate(() => JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__)));
    await page.screenshot({ path: `${out}${webgl ? 'webgl-' : ''}${s}.png` });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
    console.log(s, JSON.stringify(r), JSON.stringify({ backend: d.backend, fps: d.fps, dpr: d.dpr, r: d.renderer, state: d.state, player: d.player, alive: d.alive }));
  } catch (e) {
    console.log('STATE FAIL', s, e.message);
  }
}
console.log('errors:', errors.length);
for (const e of errors.slice(0, 30)) console.log(e.slice(0, 600));
await browser.close();
