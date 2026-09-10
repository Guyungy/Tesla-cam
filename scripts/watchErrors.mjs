/**
 * Passive observer: attaches to the running app and counts renderer errors
 * while YOU use it. Changes nothing on the page.
 *
 *   node scripts/watchErrors.mjs [seconds]
 */
import { chromium } from 'playwright';

const SECONDS = Number(process.argv[2] ?? 90);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes('localhost:5174'));
if (!page) throw new Error('app page not found');

let interrupted = 0;
const others = [];
let crashed = false;

const record = (text) => {
  if (/play\(\) request was interrupted/i.test(text)) {
    interrupted++;
    return;
  }
  others.push(text);
};
page.on('pageerror', (e) => record(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') record(m.text());
});
page.on('crash', () => {
  crashed = true;
  console.log('  CRASHED');
});

console.log(
  `watching for ${SECONDS}s — switch clips / play / change layout...`,
);
const started = Date.now();
let lastClip = '';
while (
  (Date.now() - started) / 1000 < SECONDS &&
  !page.isClosed() &&
  !crashed
) {
  await new Promise((r) => setTimeout(r, 2000));
  const snap = await page
    .evaluate(() => {
      const vs = [...document.querySelectorAll('video')];
      const m = document.body.innerText.match(/\d{2}\/\d{2} \d{2}:\d{2}/);
      return {
        clip: m?.[0] ?? '',
        videos: vs.length,
        ready: vs.filter((v) => v.readyState >= 2).length,
        playing: vs.filter((v) => !v.paused).length,
        t: vs[0] ? Number(vs[0].currentTime.toFixed(1)) : null,
      };
    })
    .catch(() => null);
  if (!snap) break;
  if (snap.videos && snap.clip !== lastClip) {
    lastClip = snap.clip;
    console.log(
      `  [${new Date().toLocaleTimeString()}] clip=${snap.clip} videos=${snap.videos} ready=${snap.ready}`,
    );
  }
}

console.log('\n=== RESULT ===');
console.log('  crashed / closed      :', crashed || page.isClosed());
console.log('  play() interrupted    :', interrupted);
console.log('  other renderer errors :', others.length);
for (const e of [...new Set(others)].slice(0, 8))
  console.log('    -', e.slice(0, 160));
await browser.close();
