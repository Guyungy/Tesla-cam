/**
 * End-to-end tests against a REAL TeslaCam drive.
 *
 * These run the actual renderer utilities (clip scan, MP4 duration probe,
 * footage assembly, SEI telemetry) and the actual export pipeline over
 * unmodified footage, which is where format assumptions that survive
 * synthetic fixtures tend to break.
 *
 * Point them at a drive with `TESLACAM_DIR=E:\TeslaCam npx playwright test`.
 * The whole file is skipped when no drive is present, so CI stays green.
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

import { prepareComposeExport } from '../electron/composeExport';
import type {
  CamName as ComposeCamName,
  ComposeSegment,
} from '../electron/composeTypes';
import { calcEventSeconds } from '../src/utils/calcEventSeconds';
import { detectHardBraking } from '../src/utils/detectIncidents';
import { genClips } from '../src/utils/genClips';
import { genFootage } from '../src/utils/genFootage';
import { genAllMapLinks, genLocationUrl } from '../src/utils/genLocationUrl';
import {
  buildSEICsv,
  convertToDataPoints,
  extractSEIFromFile,
  type RawSEIMessage,
} from '../src/utils/parseSEI';
import { probeMp4DurationFromFile } from '../src/utils/probeMp4Duration';
import type { CamClip } from '../src/utils/types';
import { diskFile, installBrowserShims, listAsFiles } from './helpers/diskFile';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static') as string;

const ROOT = process.env['TESLACAM_DIR'] ?? 'G:\\TeslaCam';
const HAS_DRIVE = (() => {
  try {
    return fs.statSync(ROOT).isDirectory();
  } catch {
    return false;
  }
})();

installBrowserShims();

const CAMS = [
  'front',
  'back',
  'left_repeater',
  'right_repeater',
  'left_pillar',
  'right_pillar',
] as const;

/** Duration ffmpeg reports for a file — ground truth for the box-parse probe. */
function ffmpegDuration(file: string): number {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
  });
  const m = (r.stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function listDirs(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Cheap check for a Tesla SEI NAL (type 6) in the first MB of mdat. */
function carriesSei(file: string): boolean {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const hdr = Buffer.alloc(16);
    let pos = 0;
    let off = -1;
    let msize = 0;
    while (pos + 8 <= size) {
      fs.readSync(fd, hdr, 0, 16, pos);
      let bs = hdr.readUInt32BE(0);
      const type = hdr.toString('latin1', 4, 8);
      let header = 8;
      if (bs === 1) {
        bs = Number(hdr.readBigUInt64BE(8));
        header = 16;
      } else if (bs === 0) bs = size - pos;
      if (bs < 8) break;
      if (type === 'mdat') {
        off = pos + header;
        msize = bs - header;
        break;
      }
      pos += bs;
    }
    if (off < 0) return false;
    const len = Math.min(1_000_000, msize);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, off);
    let c = 0;
    while (c + 4 <= buf.length) {
      const n = buf.readUInt32BE(c);
      c += 4;
      if (n < 1 || c + n > buf.length) break;
      if ((buf[c] & 0x1f) === 6) return true;
      c += n;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** Newest event clip folder that has all six cameras across ≥2 segments. */
function pickMultiSegmentClip(): { dir: string; type: string } | null {
  for (const type of ['SavedClips', 'SentryClips']) {
    const base = path.join(ROOT, type);
    for (const name of listDirs(base).sort().reverse()) {
      const dir = path.join(base, name);
      const mp4s = fs.readdirSync(dir).filter((n) => n.endsWith('.mp4'));
      const stamps = new Set(mp4s.map((n) => n.slice(0, 19)));
      if (stamps.size >= 2 && mp4s.length >= stamps.size * 6) {
        return { dir, type };
      }
    }
  }
  return null;
}

test.describe('real TeslaCam drive', () => {
  test.skip(!HAS_DRIVE, `No TeslaCam drive at ${ROOT} (set TESLACAM_DIR)`);
  test.describe.configure({ mode: 'serial' });

  // ── Clip library scan ──

  test('genClips builds the whole library from a real drive', async () => {
    test.setTimeout(300000);
    const files = listAsFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);

    const clips = await genClips(files);
    expect(clips.length).toBeGreaterThan(0);

    const savedDirs = listDirs(path.join(ROOT, 'SavedClips'));
    const sentryDirs = listDirs(path.join(ROOT, 'SentryClips'));
    const hasRecent = fs.existsSync(path.join(ROOT, 'RecentClips'));

    const byType = (t: string) => clips.filter((c) => c.type === t);
    // Only folders that actually contain video become clips.
    expect(byType('saved').length).toBeLessThanOrEqual(savedDirs.length);
    expect(byType('sentry').length).toBeLessThanOrEqual(sentryDirs.length);
    if (hasRecent) expect(byType('recent').length).toBe(1);

    for (const clip of clips) {
      expect(clip.videos.length, `${clip.name} has videos`).toBeGreaterThan(0);
      // Every video is an mp4 whose name the camera resolver understands
      for (const v of clip.videos) {
        expect(v.name).toMatch(
          /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/,
        );
      }
      // Source paths feed the export + delete flows: absolute, deduped, real
      const paths = clip.sourcePaths ?? [];
      expect(paths.length).toBeGreaterThan(0);
      expect(new Set(paths).size).toBe(paths.length);
      for (const p of paths.slice(0, 20)) {
        expect(path.isAbsolute(p)).toBe(true);
        expect(fs.existsSync(p)).toBe(true);
      }
    }

    // Sorted newest-first — the sidebar relies on this
    const stamps = clips.map((c) => c.name);
    expect([...stamps].sort().reverse()).toEqual(stamps);

    console.log(
      `clips=${clips.length} (recent=${byType('recent').length} ` +
        `sentry=${byType('sentry').length} saved=${byType('saved').length}) ` +
        `from ${files.length} files`,
    );
  });

  test('event.json is parsed and classified for every event clip', async () => {
    test.setTimeout(300000);
    const eventDirs = ['SavedClips', 'SentryClips'].flatMap((t) =>
      listDirs(path.join(ROOT, t)).map((n) => path.join(ROOT, t, n)),
    );
    const withEventJson = eventDirs.filter((d) =>
      fs.existsSync(path.join(d, 'event.json')),
    );
    test.skip(withEventJson.length === 0, 'no event.json on this drive');

    const clips = await genClips(
      listAsFiles(ROOT, 'SavedClips').concat(listAsFiles(ROOT, 'SentryClips')),
    );
    const byName = new Map(clips.map((c) => [c.name, c]));

    for (const dir of withEventJson) {
      const clip = byName.get(path.basename(dir));
      if (!clip) continue; // folder without video files
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, 'event.json'), 'utf8'),
      );
      expect(clip.event, `${clip.name} event parsed`).toBeTruthy();
      expect(clip.event?.timestamp).toBe(raw.timestamp);
      expect(clip.event?.reason).toBe(raw.reason);

      // saveType drives the auto-jump offset and the "manual" no-marker rule
      if (raw.reason === 'vehicle_auto_emergency_braking') {
        expect(clip.saveType).toBe('aeb');
      } else if (String(raw.reason).startsWith('user_interaction_dashcam')) {
        expect(clip.saveType).toBe('manual');
      } else {
        expect(clip.saveType).toBeUndefined();
      }

      // Map links must be well-formed for real coordinates
      if (clip.event && !Number.isNaN(parseFloat(clip.event.est_lat))) {
        const url = genLocationUrl(clip.event);
        expect(url).toMatch(/^https:\/\//);
        expect(genAllMapLinks(clip.event)).toHaveLength(2);
      }
    }

    const reasons = new Set(
      withEventJson.map(
        (d) =>
          JSON.parse(fs.readFileSync(path.join(d, 'event.json'), 'utf8'))
            .reason,
      ),
    );
    console.log(
      `event clips=${withEventJson.length} reasons=${[...reasons].join(', ')}`,
    );
  });

  // ── MP4 duration probe ──

  test('probeMp4Duration matches ffmpeg on real footage, for every camera', async () => {
    test.setTimeout(300000);
    const clip = pickMultiSegmentClip();
    test.skip(!clip, 'no multi-segment event clip on this drive');

    const mp4s = fs
      .readdirSync(clip!.dir)
      .filter((n) => n.endsWith('.mp4'))
      .map((n) => path.join(clip!.dir, n));

    // One file per camera, plus the final (short, truncated) segment
    const lastStamp = [
      ...new Set(mp4s.map((p) => path.basename(p).slice(0, 19))),
    ]
      .sort()
      .at(-1)!;
    const sample = [
      ...CAMS.map((cam) => mp4s.find((p) => p.endsWith(`-${cam}.mp4`))).filter(
        (p): p is string => !!p,
      ),
      ...mp4s.filter((p) => path.basename(p).startsWith(lastStamp)).slice(0, 2),
    ];

    for (const file of sample) {
      const probed = await probeMp4DurationFromFile(
        diskFile(ROOT, file) as unknown as File,
      );
      const truth = ffmpegDuration(file);
      expect(probed, `${path.basename(file)} probed > 0`).toBeGreaterThan(0);
      expect(
        Math.abs(probed - truth),
        `${path.basename(file)}: probed ${probed} vs ffmpeg ${truth}`,
      ).toBeLessThan(0.05);
    }
    console.log(`duration probe verified on ${sample.length} real files`);
  });

  // ── Footage assembly ──

  test('genFootage assembles a real multi-segment clip', async () => {
    test.setTimeout(300000);
    const picked = pickMultiSegmentClip();
    test.skip(!picked, 'no multi-segment event clip on this drive');

    const files = listAsFiles(ROOT, path.relative(ROOT, picked!.dir)).filter(
      (f) => f.name.endsWith('.mp4'),
    );

    const footage = await genFootage(files);
    const stamps = [...new Set(files.map((f) => f.name.slice(0, 19)))].sort();

    expect(footage.segments.map((s) => s.name)).toEqual(stamps);

    let running = 0;
    for (const seg of footage.segments) {
      expect(seg.startSeconds).toBeCloseTo(running, 6);
      expect(seg.duration).toBeGreaterThan(0);
      expect(seg.duration).toBeLessThan(65); // Tesla writes ~60s segments
      running += seg.duration;
      // Each on-disk camera file must be wired into the segment
      for (const cam of CAMS) {
        const key =
          cam === 'left_repeater'
            ? 'left'
            : cam === 'right_repeater'
              ? 'right'
              : cam;
        const onDisk = fs.existsSync(
          path.join(picked!.dir, `${seg.name}-${cam}.mp4`),
        );
        expect(
          !!(seg as Record<string, unknown>)[key],
          `${seg.name} ${key} wired=${!!(seg as Record<string, unknown>)[key]} onDisk=${onDisk}`,
        ).toBe(onDisk);
      }
    }
    expect(footage.duration).toBeCloseTo(running, 6);
    expect(footage.urls.length).toBe(files.length);

    console.log(
      `${path.basename(picked!.dir)}: ${footage.segments.length} segments, ` +
        `${footage.duration.toFixed(2)}s total`,
    );
  });

  test('calcEventSeconds lands inside the real footage window', async () => {
    test.setTimeout(300000);
    const dirs = ['SavedClips', 'SentryClips'].flatMap((t) =>
      listDirs(path.join(ROOT, t)).map((n) => path.join(ROOT, t, n)),
    );
    const usable = dirs.filter((d) =>
      fs.existsSync(path.join(d, 'event.json')),
    );
    test.skip(usable.length === 0, 'no event clips on this drive');

    let checked = 0;
    for (const dir of usable.slice(0, 4)) {
      const files = listAsFiles(ROOT, path.relative(ROOT, dir));
      const clips = await genClips(files);
      const clip = clips.find((c) => c.name === path.basename(dir));
      if (!clip) continue;
      const footage = await genFootage(clip.videos);
      const at = calcEventSeconds(clip, footage);

      if (clip.saveType === 'manual') {
        expect(at, 'manual saves get no marker').toBeUndefined();
      } else if (at !== undefined) {
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(footage.duration);
        // The mark is placed before the recorded event moment, never after
        expect(at).toBeLessThan(footage.duration);
      }
      checked++;
      console.log(
        `${path.basename(dir)} reason=${clip.event?.reason} saveType=${clip.saveType ?? '-'} ` +
          `eventSeconds=${at?.toFixed(1) ?? 'none'} / ${footage.duration.toFixed(1)}s`,
      );
    }
    expect(checked).toBeGreaterThan(0);
  });

  // ── SEI telemetry ──

  test.describe('SEI telemetry', () => {
    const seiFiles: string[] = [];

    test.beforeAll(() => {
      const recent = path.join(ROOT, 'RecentClips');
      if (!fs.existsSync(recent)) return;
      const fronts = fs
        .readdirSync(recent)
        .filter((n) => n.endsWith('-front.mp4'))
        .sort()
        .map((n) => path.join(recent, n));
      const step = Math.max(1, Math.floor(fronts.length / 40));
      for (let i = 0; i < fronts.length && seiFiles.length < 6; i += step) {
        if (carriesSei(fronts[i])) seiFiles.push(fronts[i]);
      }
    });

    test('extracts dense, monotonic telemetry from real front footage', async () => {
      test.setTimeout(600000);
      test.skip(seiFiles.length === 0, 'no SEI-bearing footage on this drive');

      for (const file of seiFiles) {
        const f = diskFile(ROOT, file) as unknown as File;
        const duration = await probeMp4DurationFromFile(f);
        const msgs = await extractSEIFromFile(f);

        expect(msgs.length, `${path.basename(file)} has SEI`).toBeGreaterThan(
          0,
        );

        // One sample per telemetry tick: a desynced mdat scan truncates early,
        // so density is the assertion that actually catches a broken parse.
        const density = msgs.length / duration;
        expect(
          density,
          `${path.basename(file)} density ${density.toFixed(2)}/s`,
        ).toBeGreaterThan(10);
        expect(density).toBeLessThan(120);

        const seqs = msgs.map((m) => m.frameSeqNo);
        expect(seqs.every((s) => typeof s === 'number')).toBe(true);
        const seqRegression = seqs.findIndex(
          (s, i) => i > 0 && s! < seqs[i - 1]!,
        );
        expect(seqRegression, 'frameSeqNo must not go backwards').toBe(-1);

        const pts = convertToDataPoints(msgs, 0, duration);
        expect(pts).toHaveLength(msgs.length);
        const badOffset = pts.findIndex(
          (p, i) =>
            !(p.offsetSeconds >= 0) ||
            p.offsetSeconds > duration + 1e-6 ||
            (i > 0 && p.offsetSeconds < pts[i - 1].offsetSeconds),
        );
        expect(
          badOffset,
          badOffset < 0
            ? ''
            : `offset ${pts[badOffset]?.offsetSeconds} at index ${badOffset} of ${path.basename(file)} (duration ${duration})`,
        ).toBe(-1);
      }
    });

    test('telemetry values stay inside physically possible ranges', async () => {
      test.setTimeout(600000);
      test.skip(seiFiles.length === 0, 'no SEI-bearing footage on this drive');

      const all: RawSEIMessage[] = [];
      const pts = [];
      for (const file of seiFiles) {
        const f = diskFile(ROOT, file) as unknown as File;
        const duration = await probeMp4DurationFromFile(f);
        const msgs = await extractSEIFromFile(f);
        all.push(...msgs);
        pts.push(...convertToDataPoints(msgs, 0, duration));
      }
      expect(pts.length).toBeGreaterThan(100);

      // Aggregate the violations so one bad sample names itself instead of
      // running ~10k separate matchers over a full drive's telemetry.
      const violations: string[] = [];
      const note = (i: number, what: string) => {
        if (violations.length < 5) violations.push(`#${i} ${what}`);
      };
      pts.forEach((p, i) => {
        if (!(p.speedKph >= 0 && p.speedKph <= 300))
          note(i, `speed ${p.speedKph}`);
        // A steering wheel physically stops near ±2 turns.
        if (!(Math.abs(p.steeringAngleDeg) <= 900))
          note(i, `steering ${p.steeringAngleDeg.toFixed(1)}°`);
        if (!(p.throttlePct >= 0 && p.throttlePct <= 100))
          note(i, `throttle ${p.throttlePct}`);
        if (p.brakePct !== 0 && p.brakePct !== 100)
          note(i, `brake ${p.brakePct}`);
        if (!['P', 'R', 'N', 'D', 'UNKNOWN'].includes(p.gear))
          note(i, `gear ${p.gear}`);
        if (!['OFF', 'STANDBY', 'AP', 'FSD', 'UNKNOWN'].includes(p.apStatus))
          note(i, `ap ${p.apStatus}`);
      });
      expect(violations, violations.join('; ')).toEqual([]);

      // Throttle must not saturate: a real drive is mostly partial pedal.
      const pressed = pts.filter((p) => p.throttlePct > 0);
      if (pressed.length > 50) {
        const pinned = pressed.filter((p) => p.throttlePct >= 100).length;
        expect(
          pinned / pressed.length,
          `${pinned}/${pressed.length} throttle samples read as 100%`,
        ).toBeLessThan(0.5);
      }

      // Parked stretches must decode as P, not UNKNOWN — protobuf drops the
      // zero-valued gear field, and the park speed clamp depends on this.
      const stationary = pts.filter((p) => p.speedKph === 0);
      if (stationary.length > 100) {
        expect(stationary.some((p) => p.gear === 'P')).toBe(true);
      }

      console.log(
        `telemetry: ${pts.length} points  speedMax=${Math.max(...pts.map((p) => p.speedKph)).toFixed(1)}km/h ` +
          `steerAbsMax=${Math.max(...pts.map((p) => Math.abs(p.steeringAngleDeg))).toFixed(1)}° ` +
          `throttleMax=${Math.max(...pts.map((p) => p.throttlePct)).toFixed(1)}% ` +
          `gears=${[...new Set(pts.map((p) => p.gear))].join('/')} ` +
          `ap=${[...new Set(pts.map((p) => p.apStatus))].join('/')} ` +
          `gpsPoints=${pts.filter((p) => p.latitude !== 0 || p.longitude !== 0).length}`,
      );

      // CSV export must not lose samples or emit NaN
      const csv = buildSEICsv(all);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(all.length + 1);
      expect(csv).not.toContain('NaN');
      expect(csv).not.toContain('undefined');
    });

    test('hard-braking marks on real telemetry are justified by the data', async () => {
      test.setTimeout(600000);
      test.skip(seiFiles.length === 0, 'no SEI-bearing footage on this drive');

      let totalMarks = 0;
      for (const file of seiFiles) {
        const f = diskFile(ROOT, file) as unknown as File;
        const duration = await probeMp4DurationFromFile(f);
        const pts = convertToDataPoints(
          await extractSEIFromFile(f),
          0,
          duration,
        );
        const marks = detectHardBraking(pts);
        totalMarks += marks.length;

        for (let i = 1; i < marks.length; i++) {
          expect(marks[i] - marks[i - 1]).toBeGreaterThan(3); // merge window
        }
        for (const at of marks) {
          expect(at).toBeGreaterThanOrEqual(0);
          expect(at).toBeLessThanOrEqual(duration);
          // Re-derive: a real ≥15 km/h drop within 1.5s must exist here
          const start = pts.find((p) => p.offsetSeconds === at)!;
          const window = pts.filter(
            (p) => p.offsetSeconds > at && p.offsetSeconds - at <= 1.5,
          );
          const maxDrop = Math.max(
            ...window.map((p) => start.speedKph - p.speedKph),
          );
          expect(maxDrop, `mark at ${at.toFixed(2)}s`).toBeGreaterThanOrEqual(
            15,
          );
        }
      }
      console.log(`hard-braking marks across sampled footage: ${totalMarks}`);
    });
  });

  // ── Export ──

  test('compose export produces a real MP4 from unmodified footage', async () => {
    test.setTimeout(900000);
    const picked = pickMultiSegmentClip();
    test.skip(!picked, 'no multi-segment event clip on this drive');

    const files = listAsFiles(ROOT, path.relative(ROOT, picked!.dir)).filter(
      (f) => f.name.endsWith('.mp4'),
    );
    const footage = await genFootage(files);

    // Mirror useVideoExport.buildComposeSegments: real absolute paths per cam
    const camOf = (name: string): ComposeCamName | undefined => {
      const rest = name.slice(20);
      if (rest.startsWith('front')) return 'front';
      if (rest.startsWith('back')) return 'back';
      if (rest.startsWith('left_repeater')) return 'left';
      if (rest.startsWith('right_repeater')) return 'right';
      if (rest.startsWith('left_pillar')) return 'left_pillar';
      if (rest.startsWith('right_pillar')) return 'right_pillar';
      return undefined;
    };
    const segments: ComposeSegment[] = footage.segments.map((seg) => {
      const paths: Partial<Record<ComposeCamName, string>> = {};
      for (const f of files) {
        if (!f.name.startsWith(seg.name)) continue;
        const cam = camOf(f.name);
        if (cam) paths[cam] = path.join(picked!.dir, f.name);
      }
      return {
        name: seg.name,
        startSeconds: seg.startSeconds,
        duration: seg.duration,
        paths,
      };
    });

    // Straddle a segment boundary — concat across files is the risky part
    const boundary = segments[1].startSeconds;
    const startSeconds = Math.max(0, boundary - 2);
    const durationSeconds = 4;

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-real-'));
    const out = path.join(outDir, 'real-export.mp4');

    const prepared = prepareComposeExport(
      {
        sessionId: 'real-drive',
        fileName: 'real-export.mp4',
        viewType: 'grid6',
        startSeconds,
        durationSeconds,
        segments,
        labels: {
          front: '前',
          back: '后',
          left: '左',
          right: '右',
          left_pillar: 'L柱',
          right_pillar: 'R柱',
        },
        overlay: {
          showTime: true,
          showLocation: true,
          showDriveData: true,
          locationText: '深圳 宝安公园路 100%',
          baseTimestampEpoch: Math.floor(
            Date.parse('2026-07-26T17:29:55') / 1000,
          ),
          driveWindows: [
            { start: 0, end: 2, text: '45 km/h  D  AP' },
            { start: 2, end: 4, text: '0 km/h  P  OFF' },
          ],
        },
        fps: 30,
      },
      out,
    );

    // Every input handed to ffmpeg is a real file on the drive
    for (let i = 0; i < prepared.args.length; i++) {
      if (prepared.args[i] === '-i') {
        expect(fs.existsSync(prepared.args[i + 1])).toBe(true);
      }
    }
    // Boundary straddled ⇒ at least one camera contributes two trimmed pieces
    const inputCount = prepared.args.filter((a) => a === '-i').length;
    expect(inputCount).toBeGreaterThan(6);

    const started = Date.now();
    const r = spawnSync(ffmpeg, prepared.args, {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    expect(r.status, `ffmpeg failed:\n${(r.stderr || '').slice(-3000)}`).toBe(
      0,
    );

    const size = fs.statSync(out).size;
    expect(size).toBeGreaterThan(10000);

    // Output decodes cleanly and has the requested geometry / length
    const dec = spawnSync(
      ffmpeg,
      ['-v', 'error', '-i', out, '-f', 'null', '-'],
      {
        encoding: 'utf8',
      },
    );
    expect(dec.status, dec.stderr).toBe(0);
    expect(dec.stderr.trim()).toBe('');

    const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', out], {
      encoding: 'utf8',
    });
    expect(probe.stderr).toContain(`${prepared.width}x${prepared.height}`);
    const dur = ffmpegDuration(out);
    expect(Math.abs(dur - durationSeconds)).toBeLessThan(0.3);

    // Overlays actually rendered (the historical failure was silent blanks)
    const luma = (crop: string, at: number) => {
      const s = spawnSync(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(at),
          '-i',
          out,
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
      const m = (s.stdout || '').match(/signalstats\.YAVG=([\d.]+)/);
      expect(m, `signalstats for ${crop}`).toBeTruthy();
      return Number(m![1]);
    };
    const H = prepared.height;
    expect(luma(`600:24:0:${H - 44}`, 1)).toBeGreaterThan(18); // clock
    expect(luma(`600:22:0:${H - 22}`, 1)).toBeGreaterThan(18); // location (CJK + %)

    // Real video content reached the grid, not just black padding
    expect(luma(`960:540:960:0`, 1)).toBeGreaterThan(18);

    console.log(
      `compose export: ${inputCount} inputs → ${prepared.width}x${prepared.height} ` +
        `${dur.toFixed(2)}s ${(size / 1e6).toFixed(1)}MB in ${elapsed}s (libx264)`,
    );

    fs.rmSync(outDir, { recursive: true, force: true });
    if (prepared.tmpDir)
      fs.rmSync(prepared.tmpDir, { recursive: true, force: true });
  });

  test('export request over real paths passes main-process validation rules', async () => {
    test.setTimeout(120000);
    const picked = pickMultiSegmentClip();
    test.skip(!picked, 'no multi-segment event clip on this drive');
    const clip: CamClip = (
      await genClips(listAsFiles(ROOT, path.relative(ROOT, picked!.dir)))
    )[0];

    // main.ts rejects any source path that is not an absolute, existing .mp4
    for (const p of clip.sourcePaths ?? []) {
      if (!p.toLowerCase().endsWith('.mp4')) continue;
      expect(path.isAbsolute(p)).toBe(true);
      expect(path.extname(p).toLowerCase()).toBe('.mp4');
      expect(fs.statSync(p).isFile()).toBe(true);
    }
  });
});
