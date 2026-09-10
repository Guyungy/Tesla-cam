/**
 * Confirm the dashboard tracks the playhead: seek to a series of timestamps on
 * the open clip and read speed / gear / steering / pedals at each one.
 *
 *   node scripts/verifySync.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes('localhost:5174'));
if (!page) throw new Error('app page not found');

const read = () =>
  page.evaluate(() => {
    const t = document.body.innerText.replace(/\n+/g, '|');
    const speed = t.match(/\|(-{2}|\d+)\|KM\/H/i)?.[1] ?? '?';
    const str = t.match(/STR\|(-?[\d-]+)°/)?.[1] ?? '?';
    const nums = t.match(/THR\|(-{2}|\d+)\|BRK\|(-{2}|\d+)/);
    const v = document.querySelector('video');
    // Which gear chip is highlighted (non-dim)
    const gear =
      [...document.querySelectorAll('div')]
        .filter(
          (d) =>
            /^[PRND]$/.test(d.textContent?.trim() ?? '') &&
            d.className.includes('rounded') &&
            !d.className.includes('text-white/20'),
        )
        .map((d) => d.textContent.trim())[0] ?? '-';
    return {
      t: v ? Number(v.currentTime.toFixed(1)) : null,
      speed,
      gear,
      str,
      thr: nums?.[1] ?? '?',
      brk: nums?.[2] ?? '?',
    };
  });

const first = await read();
if (first.t === null) throw new Error('no clip open');
console.log('seeking across the clip and reading the dashboard:\n');
console.log('   time |  speed | gear |   str |  thr |  brk');
console.log('  ------+--------+------+-------+------+------');

const rows = [];
for (const s of [0.5, 3, 6, 9, 12, 15, 18, 21, 24]) {
  await page.evaluate((sec) => {
    document.querySelectorAll('video').forEach((v) => {
      if (v.duration > sec) v.currentTime = sec;
    });
  }, s);
  await page.waitForTimeout(900);
  const r = await read();
  rows.push(r);
  console.log(
    `  ${String(r.t).padStart(5)}s | ${String(r.speed).padStart(6)} | ${r.gear.padStart(4)} | ${String(r.str).padStart(5)}° | ${String(r.thr).padStart(4)} | ${String(r.brk).padStart(4)}`,
  );
}

const distinct = (k) => new Set(rows.map((r) => r[k])).size;
console.log('\n=== RESULT ===');
console.log(`  distinct speed values : ${distinct('speed')} / ${rows.length}`);
console.log(`  distinct steering     : ${distinct('str')} / ${rows.length}`);
console.log(`  distinct throttle     : ${distinct('thr')} / ${rows.length}`);
console.log(
  `  any '--' placeholders : ${rows.some((r) => [r.speed, r.thr, r.brk].includes('--'))}`,
);
// Parked footage (Sentry) is legitimately constant: gear P, no speed, no
// pedal input. Only call it a failure when the car was actually moving.
const varies = distinct('speed') > 1 || distinct('str') > 1;
const parked = rows.every((r) => r.speed === '0' && r.gear === 'P');
const blank = rows.every((r) => r.speed === '--');
console.log(
  `  VERDICT: ${
    blank
      ? 'no telemetry reached the dashboard ❌'
      : varies
        ? 'telemetry tracks the playhead ✅'
        : parked
          ? 'constant, but the car is parked (gear P, 0 km/h) — expected ✅'
          : 'moving footage with frozen values ❌'
  }`,
);
await browser.close();
