import puppeteer from 'puppeteer-core';
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
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 60000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__.state === 'play', { timeout: 10000 });
// jump once mid-ride to capture the jump too
await new Promise((r) => setTimeout(r, 1200));
await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: new URL('./shots/real-jump.png', import.meta.url).pathname });
await page.waitForFunction(() => !window.__THREE_GAME_DIAGNOSTICS__.player.alive, { timeout: 20000, polling: 16 });
for (const [d, n] of [[120, 'a'], [450, 'b'], [1300, 'c']]) {
  await new Promise((r) => setTimeout(r, d));
  await page.screenshot({ path: new URL(`./shots/real-crash-${n}.png`, import.meta.url).pathname });
}
console.log('errors', errors);
await browser.close();
