// Close-up shots of map features from fixed camera positions (attract mode keeps running behind).
import puppeteer from 'puppeteer-core';
const shots = JSON.parse(process.argv[2]);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 90000 });
for (const s of shots) {
  await page.evaluate((m) => window.__THREE_GAME_TEST_HOOKS__.setMap(m), s.map);
  await page.evaluate((s) => {
    document.getElementById('menu').hidden = true;
    const { view } = window.__lw;
    view.rig.mode = 'fixed';
    const c = view.camera;
    c.position.set(...s.pos);
    c.lookAt(...s.look);
    c.fov = s.fov || 60;
    c.updateProjectionMatrix();
  }, s);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: new URL(`./shots/cu-${s.name}.png`, import.meta.url).pathname });
}
console.log('errors', errors);
await browser.close();
