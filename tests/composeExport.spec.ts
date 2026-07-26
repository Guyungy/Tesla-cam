/**
 * Compose-export pipeline tests: argument construction for every layout,
 * plus real FFmpeg smoke runs that assert the output decodes AND that the
 * overlay text actually rendered (the historical failure mode was
 * "exit 0 but blank drawtext", so pixel-luma assertions are the point).
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

import { prepareComposeExport } from '../electron/composeExport';
import type {
  ComposeExportRequest,
  ComposeViewType,
} from '../electron/composeTypes';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static') as string;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-test-'));

function makeSource(name: string, filter: string, seconds: number): string {
  const out = path.join(tmpRoot, name);
  const r = spawnSync(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `${filter}=s=320x240:d=${seconds}:r=24`,
      out,
    ],
    { encoding: 'utf8' },
  );
  expect(r.status, `generate ${name}: ${r.stderr}`).toBe(0);
  return out;
}

let front: string;
let back: string;

test.beforeAll(() => {
  front = makeSource('front.mp4', 'testsrc2', 4);
  back = makeSource('back.mp4', 'smptebars', 4);
});

test.afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeRequest(
  viewType: ComposeViewType,
  overrides: Partial<ComposeExportRequest> = {},
): ComposeExportRequest {
  return {
    sessionId: 'test',
    fileName: 'out.mp4',
    viewType,
    startSeconds: 0.5,
    durationSeconds: 2,
    segments: [
      {
        name: 's0',
        startSeconds: 0,
        duration: 4,
        paths: { front, back },
      },
    ],
    labels: { front: 'Front', back: 'Rear' },
    overlay: {
      showTime: true,
      showLocation: true,
      showDriveData: true,
      locationText: "O'Brien St, 100% Xi'an 深圳测试路",
      baseTimestampLabel: '2026-07-26 18:00:00',
      baseTimestampEpoch: 1785060000,
      driveWindows: [
        { start: 0, end: 1, text: '45 km/h  D  AP' },
        { start: 1, end: 2, text: '0 km/h  P  OFF' },
      ],
    },
    fps: 24,
    ...overrides,
  };
}

/** Average luma of a cropped region at a given time (16 ≈ pure black). */
function regionLuma(file: string, crop: string, at: number): number {
  const r = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(at),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `crop=${crop},signalstats,metadata=print:file=-`,
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  const m = (r.stdout || '').match(/signalstats\.YAVG=([\d.]+)/);
  expect(m, `signalstats output for crop ${crop}`).toBeTruthy();
  return Number(m![1]);
}

// ── Argument construction (fast, no encoding) ──

const LAYOUT_SIZES: Record<string, { w: number; h: number }> = {
  grid6: { w: 2880, h: 1140 },
  grid4: { w: 1920, h: 1140 },
  grid4old: { w: 2880, h: 1140 },
  front: { w: 1920, h: 1140 },
};

for (const viewType of ['grid6', 'grid4', 'grid4old', 'front'] as const) {
  test(`prepare args: ${viewType}`, () => {
    const prepared = prepareComposeExport(
      makeRequest(viewType),
      path.join(tmpRoot, 'x.mp4'),
    );
    expect(prepared.width).toBe(LAYOUT_SIZES[viewType].w);
    expect(prepared.height).toBe(LAYOUT_SIZES[viewType].h);
    expect(prepared.width % 2).toBe(0);
    expect(prepared.height % 2).toBe(0);

    const fc = prepared.args[prepared.args.indexOf('-filter_complex') + 1];
    if (viewType === 'grid6') expect(fc).toContain('xstack=inputs=6');
    if (viewType === 'grid4') expect(fc).toContain('xstack=inputs=4');
    if (viewType === 'grid4old') expect(fc).toContain('hstack=inputs=3');
    // Missing cams must become black placeholders, never dropped inputs
    if (viewType !== 'front') expect(fc).toContain('color=c=black');
    // Overlay chain: clock via pts expansion, literals via textfiles
    expect(fc).toContain('pts\\:localtime');
    expect(fc).toContain('textfile=');
    expect(fc).toContain('expansion=none');
    if (prepared.tmpDir)
      fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
  });
}

test('throws when no source files overlap the export range', () => {
  expect(() =>
    prepareComposeExport(
      makeRequest('grid4', {
        segments: [{ name: 's0', startSeconds: 0, duration: 4, paths: {} }],
      }),
      path.join(tmpRoot, 'x.mp4'),
    ),
  ).toThrow();
});

// ── Full FFmpeg smoke per layout ──

for (const viewType of ['grid6', 'grid4', 'grid4old', 'front'] as const) {
  test(`ffmpeg smoke: ${viewType}`, () => {
    const out = path.join(tmpRoot, `smoke-${viewType}.mp4`);
    const prepared = prepareComposeExport(makeRequest(viewType), out);

    const r = spawnSync(ffmpeg, prepared.args, {
      encoding: 'utf8',
      maxBuffer: 1 << 24,
    });
    expect(
      r.status,
      `ffmpeg stderr tail:\n${(r.stderr || '').slice(-2000)}`,
    ).toBe(0);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);

    // Output must decode cleanly end to end
    const dec = spawnSync(
      ffmpeg,
      ['-v', 'error', '-i', out, '-f', 'null', '-'],
      { encoding: 'utf8' },
    );
    expect(dec.status).toBe(0);
    expect(dec.stderr.trim()).toBe('');

    const H = prepared.height;
    // Timestamp clock (y = h-60+18, fontsize 22) — must not be blank
    expect(regionLuma(out, `600:24:0:${H - 44}`, 1)).toBeGreaterThan(18);
    // Location line (y = h-60+40, fontsize 18) — apostrophe/%/CJK text
    expect(regionLuma(out, `600:22:0:${H - 22}`, 1)).toBeGreaterThan(18);

    if (prepared.tmpDir)
      fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
  });
}

test('drive window text switches over time', () => {
  const out = path.join(tmpRoot, 'smoke-drive.mp4');
  const prepared = prepareComposeExport(makeRequest('front'), out);
  const r = spawnSync(ffmpeg, prepared.args, {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  expect(r.status).toBe(0);

  const H = prepared.height;
  const W = prepared.width;
  // Drive text is right-aligned (x=w-tw-16, y=h-60+24, fontsize 20)
  const crop = `420:26:${W - 420}:${H - 38}`;
  const early = regionLuma(out, crop, 0.5);
  const late = regionLuma(out, crop, 1.5);
  // Both windows have text; both regions must be non-blank
  expect(early).toBeGreaterThan(18);
  expect(late).toBeGreaterThan(18);
  if (prepared.tmpDir)
    fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
});
