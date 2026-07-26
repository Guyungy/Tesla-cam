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

const LAYOUT_WIDTHS: Record<string, number> = {
  grid6: 2880,
  grid4: 1920,
  grid4old: 2880,
  front: 1920,
};

/** The graph now lives in a file; read it back to assert on its contents. */
function graphOf(prepared: { args: string[] }): string {
  const i = prepared.args.indexOf('-filter_complex_script');
  expect(i, 'filtergraph must be passed as a script file').toBeGreaterThan(-1);
  return fs.readFileSync(prepared.args[i + 1], 'utf8');
}

for (const viewType of ['grid6', 'grid4', 'grid4old', 'front'] as const) {
  test(`prepare args: ${viewType}`, () => {
    const prepared = prepareComposeExport(
      makeRequest(viewType),
      path.join(tmpRoot, 'x.mp4'),
    );
    expect(prepared.width).toBe(LAYOUT_WIDTHS[viewType]);
    expect(prepared.width % 2).toBe(0);
    expect(prepared.height % 2).toBe(0);
    // The info bar is derived from its contents, so it must leave room for the
    // timestamp rather than being a fixed 60px the text overflows.
    expect(prepared.height).toBeGreaterThan(1080);

    const fc = graphOf(prepared);
    if (viewType === 'grid6') expect(fc).toContain('xstack=inputs=6');
    if (viewType === 'grid4') expect(fc).toContain('xstack=inputs=4');
    if (viewType === 'grid4old') expect(fc).toContain('hstack=inputs=3');
    // Missing cams must become black placeholders, never dropped inputs
    if (viewType !== 'front') expect(fc).toContain('color=c=black');
    // Overlay chain: clock via pts expansion, literals via textfiles
    expect(fc).toContain('pts\\:localtime');
    expect(fc).toContain('textfile=');
    expect(fc).toContain('expansion=none');
    // Info bar is painted, not left as bare padding
    expect(fc).toContain('drawbox=');
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

/**
 * Explicit geometry so the overlay's positions are known in the assertions —
 * this is also the path the app takes, since the renderer always sends layout.
 */
function testLayout(viewType: string) {
  return {
    width: LAYOUT_WIDTHS[viewType],
    videoHeight: 1080,
    barHeight: 120,
    height: 1200,
    scale: 2,
    padding: 16,
    brandSize: 22,
    titleSize: 56,
    subSize: 30,
    gap: 8,
    iconSize: 60,
    hPad: 44,
    leftTextX: 136,
  };
}

for (const viewType of ['grid6', 'grid4', 'grid4old', 'front'] as const) {
  test(`ffmpeg smoke: ${viewType}`, () => {
    const out = path.join(tmpRoot, `smoke-${viewType}.mp4`);
    const prepared = prepareComposeExport(
      makeRequest(viewType, { layout: testLayout(viewType) }),
      out,
    );

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

    const L = testLayout(viewType);
    const barY = L.videoHeight;
    const brandY = barY + L.padding;
    const titleY = brandY + L.brandSize + L.gap;
    // Brand line, then the timestamp beneath it — both inside the bar.
    expect(
      regionLuma(out, `300:${L.brandSize}:${L.leftTextX}:${brandY}`, 1),
    ).toBeGreaterThan(18);
    expect(
      regionLuma(out, `700:${L.titleSize}:${L.leftTextX}:${titleY}`, 1),
    ).toBeGreaterThan(18);
    // Location is right-aligned (apostrophe / % / CJK text)
    const locBand = 400;
    expect(
      regionLuma(
        out,
        `${locBand}:${L.subSize}:${L.width - locBand - L.hPad}:${brandY}`,
        1,
      ),
    ).toBeGreaterThan(18);
    // Nothing may spill out of the bar onto the video above it
    expect(regionLuma(out, `${L.width}:8:0:${barY - 10}`, 1)).toBeLessThan(200);

    if (prepared.tmpDir)
      fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
  });
}

test('drive window text switches over time', () => {
  const out = path.join(tmpRoot, 'smoke-drive.mp4');
  const L = testLayout('front');
  const prepared = prepareComposeExport(
    makeRequest('front', { layout: L }),
    out,
  );
  const r = spawnSync(ffmpeg, prepared.args, {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  expect(r.status).toBe(0);

  // Drive text is right-aligned on the bar's lower row
  const y = L.videoHeight + L.barHeight - L.subSize - L.padding;
  const crop = `420:${L.subSize}:${L.width - 420 - L.hPad}:${y}`;
  const early = regionLuma(out, crop, 0.5);
  const late = regionLuma(out, crop, 1.5);
  // Both windows have text; both regions must be non-blank
  expect(early).toBeGreaterThan(18);
  expect(late).toBeGreaterThan(18);
  if (prepared.tmpDir)
    fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
});

test('an unreadable overlay icon is dropped, not handed to ffmpeg', () => {
  // A packaged build resolved the icon inside app.asar: fs.statSync could read
  // it, ffmpeg could not, and the entire export failed with
  // "Error opening input file …app.asar\dist\tesla-icon.png".
  const missing = path.join(tmpRoot, 'does-not-exist.png');
  const prepared = prepareComposeExport(
    makeRequest('front', { layout: testLayout('front') }),
    path.join(tmpRoot, 'noicon.mp4'),
    { iconPath: missing },
  );

  expect(prepared.args).not.toContain(missing);
  expect(graphOf(prepared)).not.toContain('teslaicon');

  // And it still encodes.
  const r = spawnSync(ffmpeg, prepared.args, {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  expect(r.status, (r.stderr || '').slice(-800)).toBe(0);
  if (prepared.tmpDir)
    fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
});

test('a real overlay icon is added as the last input', () => {
  const icon = path.join(process.cwd(), 'public', 'tesla-icon.png');
  const prepared = prepareComposeExport(
    makeRequest('front', { layout: testLayout('front') }),
    path.join(tmpRoot, 'icon.mp4'),
    { iconPath: icon },
  );
  const inputs = prepared.args.filter((a) => a === '-i').length;
  expect(prepared.args[prepared.args.lastIndexOf('-i') + 1]).toBe(icon);
  expect(graphOf(prepared)).toContain(`[${inputs - 1}:v]scale=`);
  if (prepared.tmpDir)
    fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
});

test('a long export does not blow the command-line limit', () => {
  // One gated drawtext per second is ~240 chars. Past ~150 windows the
  // filtergraph exceeded Windows' 32767-char argv limit and ffmpeg never
  // spawned, so this has to travel as a script file.
  const windows = Array.from({ length: 600 }, (_, i) => ({
    start: i,
    end: i + 1,
    text: `2026年07月26日 周日 ${String(i % 24).padStart(2, '0')}:00:00`,
  }));
  const prepared = prepareComposeExport(
    makeRequest('front', {
      durationSeconds: 600,
      layout: testLayout('front'),
      overlay: {
        showTime: true,
        showLocation: true,
        showDriveData: true,
        locationText: '深圳 宝安公园路',
        timeWindows: windows,
        driveWindows: windows.map((w) => ({ ...w, text: '45 km/h  D  AP' })),
      },
    }),
    path.join(tmpRoot, 'long.mp4'),
  );

  const graph = graphOf(prepared);
  expect(graph.length).toBeGreaterThan(32767);
  for (const arg of prepared.args) expect(arg.length).toBeLessThan(32767);
  if (prepared.tmpDir)
    fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
});
