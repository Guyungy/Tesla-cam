/**
 * Open a driving clip that carries SEI telemetry and capture the dashboard.
 * Uses precise locators and logs exactly which element each click resolves to,
 * so a stray click can never land on the viewer's delete button.
 *
 *   node scripts/demoTelemetry.mjs [folder] [clipLabel]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const FOLDER = process.argv[2] ?? 'C:\\temp\\TeslaCamTest';
const LABEL = process.argv[3] ?? '07/26 17:23';
const OUT = path.join(process.cwd(), 'ui-shots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes('localhost:5174'));
if (!page) throw new Error('app page not found');

page.on('crash', () => console.log('  💥 PAGE CRASHED'));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.setViewportSize({ width: 1600, height: 1000 });
await page.reload();
await page.waitForTimeout(1200);

console.log(`loading ${FOLDER} ...`);
await page
  .locator('input[type=file]')
  .setInputFiles(FOLDER, { timeout: 120000 })
  .catch((e) => console.log('  (ack: ' + e.name + ')'));
await page.waitForFunction(() => /个片段/.test(document.body.innerText), null, {
  timeout: 180000,
});
await page.waitForTimeout(1200);

// Resolve the clip card by its timestamp label, then click the smallest
// enclosing clickable ancestor — never a huge container.
const clicked = await page.evaluate((label) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent?.trim().startsWith(label)) {
      let el = node.parentElement;
      while (el && el.getBoundingClientRect().height < 40)
        el = el.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      el.setAttribute('data-e2e-target', '1');
      return {
        tag: el.tagName,
        cls: el.className.slice(0, 60),
        w: r.width,
        h: r.height,
      };
    }
  }
  return null;
}, LABEL);
if (!clicked) throw new Error('clip card not found for ' + LABEL);
console.log('  click target:', JSON.stringify(clicked));
await page.locator('[data-e2e-target="1"]').click();

console.log('clip opened, waiting for telemetry...');
const gotTelemetry = await page
  .waitForFunction(
    () => /\b\d+(\.\d+)?\s*KM\/H/i.test(document.body.innerText),
    null,
    { timeout: 240000 },
  )
  .then(() => true)
  .catch(() => false);
console.log('  telemetry rendered:', gotTelemetry);

await page.keyboard.press('Space');
await page.waitForTimeout(5000);

const readout = await page.evaluate(() => {
  const t = document.body.innerText;
  const i = t.indexOf('KM/H');
  const v = document.querySelector('video');
  return {
    strip:
      i < 0
        ? null
        : t.slice(Math.max(0, i - 140), i + 200).replace(/\n+/g, ' | '),
    hasCsv: /CSV/i.test(t),
    videoTime: v ? Number(v.currentTime.toFixed(2)) : null,
    playing: v ? !v.paused : null,
    videos: document.querySelectorAll('video').length,
  };
});
console.log('dashboard:', JSON.stringify(readout, null, 1));

await page.screenshot({ path: path.join(OUT, '6-telemetry.png') });
const h = (await page.locator('body').boundingBox()).height;
await page.screenshot({
  path: path.join(OUT, '7-dashboard-crop.png'),
  clip: { x: 0, y: h - 210, width: 1600, height: 200 },
});
console.log('  📸 6-telemetry.png, 7-dashboard-crop.png');

await page.keyboard.press('Space');
await browser.close();
