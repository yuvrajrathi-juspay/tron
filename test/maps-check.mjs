// Screenshots + diagnostics for every arena in several states.
import puppeteer from 'puppeteer-core';
const maps = (process.argv[2] || 'grid,mesa,orbital').split(',');
const states = (process.argv[3] || 'menu,active-play').split(',');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://127.0.0.1:5188/' + (process.env.Q || ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 90000 });
for (const m of maps) {
  for (const s of states) {
    await page.evaluate((id) => window.__THREE_GAME_TEST_HOOKS__.setMap(id), m);
    await page.evaluate((st) => window.__THREE_GAME_TEST_HOOKS__.setState(st), s);
    await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 1500)));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
    await new Promise((r) => setTimeout(r, 250));
    const d = await page.evaluate(() => JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__)));
    await page.screenshot({ path: new URL(`./shots/${m}-${s}.png`, import.meta.url).pathname });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
    console.log(m, s, JSON.stringify({ fps: d.fps, calls: d.renderer.calls, tris: d.renderer.triangles, state: d.state, p: { x: +d.player.x.toFixed(1), z: +d.player.z.toFixed(1), alive: d.player.alive, air: d.player.air } }));
  }
}
console.log('errors', errors.length);
for (const e of errors.slice(0, 20)) console.log(e.slice(0, 500));
await browser.close();
