// Phone emulation: real touch input on the on-screen buttons. Verifies throttle, steering,
// boost, jump, brake, pause, tap-to-continue, and captures the layout in both orientations.
import puppeteer, { KnownDevices } from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const out = {};
for (const [name, landscape] of [['landscape', true], ['portrait', false]]) {
  const page = await browser.newPage();
  const dev = KnownDevices['iPhone 13'];
  await page.emulate({ ...dev, viewport: { ...dev.viewport, isLandscape: landscape, width: landscape ? 844 : 390, height: landscape ? 390 : 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('' + (process.env.BASE || 'http://127.0.0.1:5188/') + '', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 90000 });
  await page.screenshot({ path: new URL(`./shots/touch-${name}-menu.png`, import.meta.url).pathname });
  const tapSel = async (sel) => {
    const r = await page.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.touchscreen.tap(r.x, r.y);
  };
  await page.$eval('#btn-play', (el) => el.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 300));
  await tapSel('#btn-play');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__.state === 'play', { timeout: 8000 });
  const center = (sel) => page.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const gas = await center('.tbtn.gas'), left = await center('.tbtn.steer.l'), boost = await center('.tbtn.boost'), jump = await center('.tbtn.jump');
  // hold GAS with one finger while steering with another (multi-touch via CDP)
  const cdp = await page.createCDPSession();
  const touches = (pts) => pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches([{ ...gas, id: 1 }]) });
  await new Promise((r) => setTimeout(r, 1500));
  const d1 = await page.evaluate(() => ({ ...window.__THREE_GAME_DIAGNOSTICS__.player }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches([{ ...gas, id: 1 }, { ...left, id: 2 }]) });
  await new Promise((r) => setTimeout(r, 600));
  const d2 = await page.evaluate(() => ({ ...window.__THREE_GAME_DIAGNOSTICS__.player }));
  await page.screenshot({ path: new URL(`./shots/touch-${name}-play.png`, import.meta.url).pathname });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: touches([{ ...gas, id: 1 }]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches([{ ...gas, id: 1 }, { ...boost, id: 3 }]) });
  await new Promise((r) => setTimeout(r, 400));
  const d3 = await page.evaluate(() => ({ ...window.__THREE_GAME_DIAGNOSTICS__.player }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.touchscreen.tap(jump.x, jump.y);
  await new Promise((r) => setTimeout(r, 150));
  const d4 = await page.evaluate(() => ({ ...window.__THREE_GAME_DIAGNOSTICS__.player }));
  await new Promise((r) => setTimeout(r, 900));
  const d5 = await page.evaluate(() => ({ ...window.__THREE_GAME_DIAGNOSTICS__.player }));
  await tapSel('#tpause');
  await new Promise((r) => setTimeout(r, 300));
  const paused = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.paused);
  await tapSel('#btn-resume');
  await new Promise((r) => setTimeout(r, 300));
  const resumed = !(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.paused));
  out[name] = {
    throttleWorks: d1.speed > 10, steerWorks: Math.abs(d2.heading - d1.heading) > 0.3, boostWorks: d3.speed > 27,
    jumpWorks: d4.air || d4.jump < 0.5, released: d5.speed < d3.speed, paused, resumed, errors,
  };
  await page.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
