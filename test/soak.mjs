// Long autopilot soak: many rounds back to back, sampling fps, heap and errors.
import puppeteer from 'puppeteer-core';
const secs = Number(process.argv[2] || 150);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-precise-memory-info'],
  defaultViewport: { width: 1440, height: 810, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5188/?autopilot' + (process.env.MAP ? '&map=' + process.env.MAP : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 60000 });
await page.keyboard.press('Enter');
const samples = [];
const t0 = Date.now();
let lastRound = 0;
while (Date.now() - t0 < secs * 1000) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await page.evaluate(() => ({ d: JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__)), heap: performance.memory ? performance.memory.usedJSHeapSize : 0 }));
  samples.push({ t: Math.round((Date.now() - t0) / 1000), fps: s.d.fps, heapMB: +(s.heap / 1048576).toFixed(1), state: s.d.state, round: s.d.round, calls: s.d.renderer.calls, scores: s.d.scores.join('/') });
  if (s.d.state === 'matchEnd') await page.keyboard.press('Enter');
  lastRound = s.d.round;
}
const fps = samples.map((s) => s.fps).sort((a, b) => a - b);
console.log(JSON.stringify({ rounds: lastRound, fpsMin: fps[0], fpsMedian: fps[fps.length >> 1], heapStart: samples[0].heapMB, heapEnd: samples[samples.length - 1].heapMB, maxCalls: Math.max(...samples.map((s) => s.calls)), errors }, null, 1));
console.log(samples.filter((_, i) => i % 6 === 0).map((s) => `${s.t}s ${s.state} r${s.round} fps${s.fps} heap${s.heapMB} calls${s.calls} ${s.scores}`).join('\n'));
await browser.close();
