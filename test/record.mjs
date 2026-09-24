// Records the trailer: frame-exact 60 fps video (with HUD) + offline-rendered game audio -> MP4.
// Usage: node test/record.mjs [--dry] [--seconds 45] [--out ~/Desktop/lightwake-gameplay.mp4]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const SECONDS = Number(arg('--seconds', 45));
const OUT = arg('--out', path.join(os.homedir(), 'Desktop', 'lightwake-gameplay.mp4'));
const W = 1920, H = 1080, FPS = 60;
const work = path.join(os.tmpdir(), `lightwake-rec-${Date.now()}`);
fs.mkdirSync(work, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5188/?capture', { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200)); // let the boot overlay finish fading
await page.evaluate((s) => window.__capture.begin(s), SECONDS);
const cdp = await page.createCDPSession();

let ff = null;
if (!DRY) {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), path.join(work, 'video.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const frames = Math.round(SECONDS * FPS);
const checkpoints = new Set([2, 5, 8, 10.5, 12.5, 14.5, 16, 17, 20, 22, 24, 25, 27, 29.6, 30.2, 33, 35, 38, 40, 41.5, 43.5].map((t) => Math.round(t * FPS)));
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const t = await page.evaluate(() => window.__capture.step());
  if (!DRY) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: false });
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  if (checkpoints.has(i)) {
    const d = await page.evaluate(() => {
      const g = window.__THREE_GAME_DIAGNOSTICS__;
      return { map: g.map, state: g.state, alive: g.alive.join(''), p: [g.player.x.toFixed(0), g.player.z.toFixed(0), g.player.speed.toFixed(0), g.player.air ? 'AIR' : ''].join(' ') };
    });
    console.log(`t=${t.toFixed(2)}`, JSON.stringify(d));
    if (DRY) await page.screenshot({ path: path.join('test', 'shots', `dry-${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
  }
  if (i % 300 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const info = await page.evaluate(() => window.__capture.end());
console.log('audio', info);
const chunks = Math.ceil(info.bytes / (1 << 20));
const parts = [];
for (let i = 0; i < chunks; i++) parts.push(Buffer.from(await page.evaluate((k) => window.__capture.wavChunk(k), i), 'base64'));
fs.writeFileSync(path.join(work, 'audio.wav'), Buffer.concat(parts));
console.log('errors', errors);
await browser.close();

if (!DRY) {
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await new Promise((res, rej) => {
    const mux = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(work, 'video.mp4'), '-i', path.join(work, 'audio.wav'),
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', String(SECONDS), '-movflags', '+faststart', OUT], { stdio: 'inherit' });
    mux.on('close', (code) => (code === 0 ? res() : rej(new Error('mux failed'))));
  });
  console.log('wrote', OUT, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} else {
  fs.copyFileSync(path.join(work, 'audio.wav'), path.join('test', 'shots', 'dry-audio.wav'));
}
