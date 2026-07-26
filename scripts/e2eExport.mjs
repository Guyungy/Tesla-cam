/**
 * End-to-end export check against the production renderer.
 *
 * Launches the packaged entry point, stubs the save dialog so nothing is
 * interactive, then drives the real 截图 / 导出片段 buttons and inspects the
 * files they produce with ffmpeg.
 *
 *   node scripts/e2eExport.mjs [folder] [clipLabel]
 *
 * Set E2E_VIDEO_WIDTH=2880 to exercise the export resolution tier.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');

const FOLDER = process.argv[2] ?? 'G:\\TeslaCam\\SavedClips';
const LABEL = process.argv[3] ?? '07/26 17:23';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-e2e-'));

const probe = (file) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
  });
  const v = (r.stderr || '').match(/Video: .*?, (\d+)x(\d+)/);
  const d = (r.stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
  const f = (r.stderr || '').match(/([\d.]+) fps/);
  return {
    size: v ? `${v[1]}x${v[2]}` : '?',
    megapixels: v ? +((v[1] * v[2]) / 1e6).toFixed(1) : null,
    seconds: d ? +(+d[1] * 3600 + +d[2] * 60 + +d[3]).toFixed(2) : null,
    fps: f ? +f[1] : null,
    bytes: fs.statSync(file).size,
  };
};

// E2E_EXE points at a packaged build — the only place asar path bugs surface.
const EXE = process.env['E2E_EXE'];
const app = await electron.launch(
  EXE
    ? {
        executablePath: EXE,
        env: { ...process.env, ELECTRON_RENDERER_URL: '' },
      }
    : {
        args: ['.'],
        cwd: process.cwd(),
        env: { ...process.env, ELECTRON_RENDERER_URL: '' },
      },
);
console.log(EXE ? `launched packaged build: ${EXE}` : 'launched from source');

// Make both save paths non-interactive. No require() in here — a throw would
// surface as a silent rejection inside the IPC handler.
const stubbed = await app.evaluate(({ dialog }, outDir) => {
  dialog.showSaveDialog = async (_win, opts) => ({
    canceled: false,
    filePath: outDir + '\\' + ((opts && opts.defaultPath) || 'out'),
  });
  dialog.showMessageBox = async () => ({ response: 1 }); // never confirm deletes
  return typeof dialog.showSaveDialog === 'function';
}, OUT);
console.log('save dialog stubbed:', stubbed, '->', OUT);

app.process().stderr?.on('data', (c) => {
  const s = String(c).trim();
  if (s) console.log('    [main]', s.slice(0, 300));
});
app.on('close', () => console.log('    [app] closed'));

const page = await app.firstWindow();
page.on('crash', () => console.log('    [renderer] CRASHED'));
page.on('close', () => console.log('    [renderer] page closed'));
page.on('console', (m) => {
  if (m.type() === 'error' || /Export|export|SEI/.test(m.text()))
    console.log(`    [renderer ${m.type()}] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => console.log('    [pageerror]', e.message));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);
console.log('app up:', await page.title());

// Apply the export resolution tier before the settings store initialises.
const VIDEO_WIDTH = Number(process.env['E2E_VIDEO_WIDTH'] ?? 0);
if (VIDEO_WIDTH) {
  await page.evaluate((w) => {
    const KEY = 'tesla-cam-export-settings';
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...cur, videoMaxWidth: w }));
  }, VIDEO_WIDTH);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  console.log(`  video export tier set to ${VIDEO_WIDTH}`);
}

console.log(`loading ${FOLDER} ...`);
await page
  .locator('input[type=file]')
  .setInputFiles(FOLDER, { timeout: 180000 })
  .catch((e) => console.log('  (ack: ' + e.name + ')'));
await page.waitForFunction(
  () => /个片段|clips/.test(document.body.innerText),
  null,
  {
    timeout: 180000,
  },
);

await page.waitForTimeout(2000);
console.log(
  '  clips:',
  await page.evaluate(() =>
    [...document.body.innerText.matchAll(/\d{2}\/\d{2} \d{2}:\d{2}/g)]
      .map((m) => m[0])
      .join(', '),
  ),
);

const opened = await page.evaluate((label) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent?.trim().startsWith(label)) {
      let el = node.parentElement;
      while (el && el.getBoundingClientRect().height < 40)
        el = el.parentElement;
      if (!el) continue;
      el.setAttribute('data-e2e-target', '1');
      return true;
    }
  }
  return false;
}, LABEL);
if (!opened) throw new Error('clip not found: ' + LABEL);
await page.locator('[data-e2e-target="1"]').click();
await page.waitForFunction(
  () => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2),
  null,
  { timeout: 120000 },
);
await page.waitForTimeout(2500);

const src = await page.evaluate(() => {
  const v = [...document.querySelectorAll('video')].find((x) => x.videoWidth);
  return v ? `${v.videoWidth}x${v.videoHeight}` : null;
});
console.log('source video:', src);

// ── Screenshot (6 GRID) ──
for (const layout of ['6 Grid', 'Front']) {
  await page.getByRole('button', { name: layout, exact: true }).click();
  await page.waitForTimeout(1200);
  const t0 = Date.now();
  await page.getByRole('button', { name: '截图' }).click();
  // A 7 MP JPEG can take several seconds — poll instead of guessing.
  let jpg = null;
  for (let i = 0; i < 40 && !jpg; i++) {
    await page.waitForTimeout(1000);
    const found = fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg'));
    if (found.length) {
      const p = path.join(OUT, found[0]);
      let last = -1;
      for (;;) {
        const size = fs.statSync(p).size;
        if (size === last && size > 0) break;
        last = size;
        await page.waitForTimeout(700);
      }
      jpg = p;
    }
  }
  if (!jpg) {
    console.log(`  screenshot ${layout}: NO FILE`);
    continue;
  }
  const info = probe(jpg);
  console.log(
    `  screenshot ${layout.padEnd(7)} -> ${info.size} (${info.megapixels} MP) ` +
      `${(info.bytes / 1e6).toFixed(2)} MB in ${Date.now() - t0} ms`,
  );
  fs.copyFileSync(
    jpg,
    path.join('ui-shots', `export-${layout.replace(/\s/g, '')}.jpg`),
  );
  fs.rmSync(jpg);
}

// ── Video export (compose path) ──
await page.getByRole('button', { name: '6 Grid', exact: true }).click();
await page.waitForTimeout(800);
// Rewind: with no IN/OUT the export runs from the playhead to the end, and by
// now the clip has played through.
await page.evaluate(() => {
  document.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.currentTime = 0;
  });
});
await page.waitForTimeout(2500);
console.log(
  '  playhead reset, exporting from',
  await page.evaluate(() =>
    Number(document.querySelector('video')?.currentTime.toFixed(2)),
  ),
);
const tv = Date.now();
await page.getByRole('button', { name: '导出片段' }).click();
let mp4 = null;
for (let i = 0; i < 300; i++) {
  await page.waitForTimeout(2000);
  const found = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp4'));
  if (found.length) {
    // Wait for the file to stop growing before probing it.
    const p = path.join(OUT, found[0]);
    let last = -1;
    for (;;) {
      const size = fs.statSync(p).size;
      if (size === last && size > 0) break;
      last = size;
      await page.waitForTimeout(1500);
    }
    mp4 = p;
    break;
  }
}
if (mp4) {
  const info = probe(mp4);
  console.log(
    `  video export -> ${info.size} ${info.seconds}s ` +
      `${(info.bytes / 1e6).toFixed(2)} MB in ${((Date.now() - tv) / 1000).toFixed(1)}s`,
  );
} else {
  console.log('  video export: NO FILE', fs.readdirSync(OUT));
}

await app.close();
fs.rmSync(OUT, { recursive: true, force: true });
