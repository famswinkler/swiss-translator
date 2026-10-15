// Checks that, after a first successful run, the app + model load with the network OFF.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  userDataDir: process.env.PROFILE || '/tmp/st-chrome-profile', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:8080/?model=base'); await new Promise(r => setTimeout(r, 3000));
await page.setOfflineMode(true);
await page.reload(); const t0 = Date.now();
while (await page.$eval('#toggle', b => b.disabled)) { if (Date.now() - t0 > 120e3) break; await new Promise(r => setTimeout(r, 1000)); }
console.log('offline: toggle enabled =', !(await page.$eval('#toggle', b => b.disabled)), '| status:', await page.$eval('#status', e => e.textContent), '| isolated:', await page.evaluate(() => crossOriginIsolated));
await browser.close();
