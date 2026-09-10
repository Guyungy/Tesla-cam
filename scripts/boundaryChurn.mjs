/**
 * Segment-boundary churn on whatever clip is already open. Only moves the
 * playhead — never loads a folder or switches clips — so it can run against a
 * session someone else is using.
 *
 *   node scripts/boundaryChurn.mjs [rounds]
 */
import { chromium } from 'playwright';

const ROUNDS = Number(process.argv[2] ?? 3);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes('localhost:5174'));
if (!page) throw new Error('app page not found');

let interrupted = 0;
const others = [];
let crashed = false;
const record = (t) =>
  /play\(\) request was interrupted/i.test(t) ? interrupted++ : others.push(t);
page.on('pageerror', (e) => record(e.message));
page.on('console', (m) => m.type() === 'error' && record(m.text()));
page.on('crash', () => {
  crashed = true;
  console.log('  CRASHED');
});

const state = () =>
  page.evaluate(() => {
    const vs = [...document.querySelectorAll('video')];
    return {
      videos: vs.length,
      ready: vs.filter((v) => v.readyState >= 2).length,
      dur: vs[0] ? Number(vs[0].duration?.toFixed(1)) : null,
      t: vs[0] ? Number(vs[0].currentTime?.toFixed(1)) : null,
    };
  });

const before = await state();
console.log('open clip:', JSON.stringify(before));
if (!before.videos) throw new Error('no clip open — open one in the app first');

const alive = () => !crashed && !page.isClosed();

for (let r = 0; r < ROUNDS && alive(); r++) {
  // Drive the playhead to the tail of the current segment, then over it.
  // Crossing the boundary is what re-sources all six <video> at once.
  for (const s of [50, 57, 59.2, 59.9, 5, 45]) {
    if (!alive()) break;
    await page.evaluate((sec) => {
      document.querySelectorAll('video').forEach((v) => {
        if (v.duration > sec) v.currentTime = sec;
      });
    }, s);
    await page.waitForTimeout(700);
  }
  // Let real playback roll over the boundary too
  await page.evaluate(() => {
    document.querySelectorAll('video').forEach((v) => {
      if (v.duration > 58) v.currentTime = 58.5;
    });
  });
  await page.keyboard.press('Space').catch(() => {});
  await page.waitForTimeout(4000);
  await page.keyboard.press('Space').catch(() => {});
  console.log(
    `  round ${r + 1}: interrupted=${interrupted} other=${others.length}`,
  );
}

console.log('\n=== RESULT ===');
console.log('  crashed / closed      :', crashed || page.isClosed());
console.log('  play() interrupted    :', interrupted);
console.log('  other renderer errors :', others.length);
for (const e of [...new Set(others)].slice(0, 8))
  console.log('    -', e.slice(0, 160));
if (alive()) console.log('  final state:', JSON.stringify(await state()));
await browser.close();
