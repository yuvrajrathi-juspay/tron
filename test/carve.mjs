import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
  defaultViewport: { width: 1440, height: 810, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 60000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__.state === 'play', { timeout: 10000 });
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 1800));
await page.keyboard.down('KeyA');
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: new URL('./shots/carve-a.png', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 900));
await page.keyboard.up('KeyA');
await page.keyboard.down('KeyD');
await new Promise((r) => setTimeout(r, 1300));
await page.screenshot({ path: new URL('./shots/carve-b.png', import.meta.url).pathname });
await page.keyboard.up('KeyD');
console.log('errors', errors);
await browser.close();
