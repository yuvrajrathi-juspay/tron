// Capture a burst of frames right after a state is applied (for effects that only live a moment).
import puppeteer from 'puppeteer-core';
const state = process.argv[2] || 'crash';
const delays = (process.argv[3] || '120,400').split(',').map(Number);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
  defaultViewport: { width: 1440, height: 810, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__.setState(s), state);
let prev = 0;
for (const d of delays) {
  await new Promise((r) => setTimeout(r, d - prev));
  prev = d;
  await page.screenshot({ path: new URL(`./shots/${state}-${d}.png`, import.meta.url).pathname });
}
console.log('errors', errors);
await browser.close();
