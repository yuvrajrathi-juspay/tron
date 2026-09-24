// Ad-hoc visual debugging: run a snippet in the page, then screenshot.
import puppeteer from 'puppeteer-core';
const snippet = process.argv[2] || '';
const shot = process.argv[3] || 'debug';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (['error', 'warning', 'log'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:5188/' + (process.env.Q || ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.frame > 20, { timeout: 60000 });
const res = await page.evaluate(async (code) => { try { return JSON.stringify(await (new Function('return (async () => {' + code + '})()'))()); } catch (e) { return 'ERR ' + e.message; } }, snippet);
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: new URL(`./shots/${shot}.png`, import.meta.url).pathname });
console.log('result:', res);
for (const e of errors.slice(0, 20)) console.log(e.slice(0, 400));
await browser.close();
