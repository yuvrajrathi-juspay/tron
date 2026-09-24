import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADFUL ? false : 'new',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required',
    '--auto-accept-this-tab-capture', '--use-fake-ui-for-media-stream', '--auto-select-tab-capture-source-by-title=LIGHTWAKE', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.state === 'menu', { timeout: 90000 });
await page.evaluate(() => {
  const b = document.createElement('button'); b.id = 'rec'; b.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;z-index:99;opacity:0'; document.body.appendChild(b);
  b.onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60, width: 1920, height: 1080 }, audio: true, preferCurrentTab: true });
      window.__rec = { v: s.getVideoTracks().map((t) => JSON.stringify(t.getSettings())), a: s.getAudioTracks().length };
    } catch (e) { window.__rec = { err: e.name + ' ' + e.message }; }
  };
});
await page.click('#rec');
await new Promise((r) => setTimeout(r, 2500));
console.log(await page.evaluate(() => window.__rec));
await browser.close();
