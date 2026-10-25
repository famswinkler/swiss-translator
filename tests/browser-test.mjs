// Headless-Chrome test of the real web app (dist/), with a FAKE MICROPHONE playing a sound file.
// Usage: node serve.mjs dist 8080 &  then  CHROME=/usr/bin/google-chrome node tests/browser-test.mjs base /tmp/speech.wav [file|mic]
import puppeteer from 'puppeteer-core';
const [model = 'base', wav = '/tmp/zh_fake.wav', how = 'mic'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  userDataDir: process.env.PROFILE || '/tmp/st-chrome-profile',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
         `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:8080/?test&model=${model}`);   // ?test turns on window.__results
await new Promise(r => setTimeout(r, 4000));             // the service worker reloads the page once
console.log('crossOriginIsolated:', await page.evaluate(() => self.crossOriginIsolated));
console.log('device:', await page.$eval('#deviceInfo', e => e.textContent));
if (await page.$eval('#setup', e => !e.hidden)) { console.log('setup screen shown, clicking Download'); await page.click('#downloadBtn'); }
const t0 = Date.now();
let last = '';
while (await page.$eval('#toggle', b => b.disabled)) {
  const p = await page.$eval('#progressText', e => e.textContent); if (p !== last) { console.log('  ', p); last = p; }
  if (Date.now() - t0 > 20 * 60e3) throw new Error('model load timeout');
  await new Promise(r => setTimeout(r, 3000));
}
console.log(`model ready after ${((Date.now() - t0) / 1000).toFixed(0)} s:`, await page.$eval('#engineInfo', e => e.textContent));
const t1 = Date.now();
if (how === 'file') await page.evaluate(() => window.__testWithUrl('/__test/sample.ogg'));
else { await page.click('#toggle'); }
// wait until no new results for 25 s (after at least 20 s)
let n = -1, stable = 0;
while (stable < 25) { await new Promise(r => setTimeout(r, 1000)); const k = await page.evaluate(() => window.__results.length); if (k === n && Date.now() - t1 > 20000) stable++; else stable = 0; n = k; if (Date.now() - t1 > 15 * 60e3) break; }
console.log('status:', await page.$eval('#status', e => e.textContent));
const res = await page.evaluate(() => window.__results);
for (const r of res) console.log('·', r.english, r.german ? `   [de: ${r.german}]` : '');
console.log(`${res.length} captions in ${((Date.now() - t1) / 1000).toFixed(0)} s (incl. 25 s idle wait)`);
console.log('cache storage:', await page.evaluate(async () => { const e = await navigator.storage.estimate(); return (e.usage / 1e6).toFixed(0) + ' MB used'; }));
await page.screenshot({ path: '/tmp/st-browser-test.png' });
await browser.close();
