/**
 * Unit tests for MP4 codec detection.
 *
 * These matter because the SEI reader is H.264-only (it mirrors Tesla's own
 * `dashcam-mp4.js`), so an HEVC clip decodes to zero telemetry samples with no
 * error. Detection is what lets the UI tell those two cases apart, so it is
 * tested against hand-built containers covering both codec families plus the
 * malformed shapes that must degrade to `unknown` rather than throw.
 */
import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import {
  detectCodecFromBuffer,
  detectCodecFromMoov,
  probeCodecFromFiles,
} from '../src/utils/detectCodec';
import { diskFile } from './helpers/diskFile';

// ── Tiny MP4 container builder ──────────────────────────────────────

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** Standard 8-byte-header box. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, body.length + 8, false);
  header.set(ascii(type), 4);
  return concat(header, body);
}

/** 16-byte-header box, as production files use for payloads over 4 GB. */
function box64(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, false); // size == 1 ⇒ 64-bit largesize follows
  header.set(ascii(type), 4);
  const total = body.length + 16;
  view.setUint32(8, Math.floor(total / 2 ** 32), false);
  view.setUint32(12, total >>> 0, false);
  return concat(header, body);
}

/**
 * A sample entry: a 78-byte visual sample entry header, then the codec config
 * box. The 78-byte offset is what Tesla's parser hard-codes, so keeping it here
 * keeps the fixture honest.
 */
function sampleEntry(format: string, configType: string): Uint8Array {
  return box(format, new Uint8Array(78), box(configType, new Uint8Array(7)));
}

function stsd(entries: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(8); // version+flags, then entry_count
  new DataView(head.buffer).setUint32(4, entries.length, false);
  return box('stsd', head, ...entries);
}

/** Build a `moov` *payload* containing one video track for `format`. */
function moovPayloadFor(
  format: string,
  configType: string,
  opts: { extended?: boolean } = {},
): Uint8Array {
  const stbl = box('stbl', stsd([sampleEntry(format, configType)]));
  const minf = opts.extended ? box64('minf', stbl) : box('minf', stbl);
  return box('trak', box('mdia', minf));
}

const AVC = moovPayloadFor('avc1', 'avcC');
const AVC3 = moovPayloadFor('avc3', 'avcC');
const HEVC = moovPayloadFor('hvc1', 'hvcC');
const HEV1 = moovPayloadFor('hev1', 'hvcC');

// ── Sample description mapping ──────────────────────────────────────

test('maps AVC sample entry formats to h264', () => {
  expect(detectCodecFromMoov(AVC)).toBe('h264');
  expect(detectCodecFromMoov(AVC3)).toBe('h264');
});

test('maps HEVC sample entry formats to h265', () => {
  expect(detectCodecFromMoov(HEVC)).toBe('h265');
  expect(detectCodecFromMoov(HEV1)).toBe('h265');
});

test('skips non-video tracks and reports the video codec', () => {
  // An audio track first (its stsd entry is not a recognised video format),
  // then the video track. Detection must not stop at the first track.
  const audio = box(
    'trak',
    box(
      'mdia',
      box('minf', box('stbl', stsd([box('mp4a', new Uint8Array(28))]))),
    ),
  );
  const moov = concat(audio, moovPayloadFor('avc1', 'avcC'));
  expect(detectCodecFromMoov(moov)).toBe('h264');
});

test('reads through 64-bit extended box sizes', () => {
  const extended = moovPayloadFor('hvc1', 'hvcC', { extended: true });
  expect(detectCodecFromMoov(extended)).toBe('h265');
});

// ── Whole-file entry point ──────────────────────────────────────────

test('finds moov inside a complete file and reads its codec', () => {
  const ftyp = box('ftyp', ascii('isom'), new Uint8Array(4));
  const mdat = box('mdat', new Uint8Array(32));
  expect(detectCodecFromBuffer(concat(ftyp, mdat, box('moov', AVC)))).toBe(
    'h264',
  );
  expect(detectCodecFromBuffer(concat(ftyp, box('moov', HEVC), mdat))).toBe(
    'h265',
  );
});

// ── Degradation: never throw, never guess ───────────────────────────

test('reports unknown when there is no video track', () => {
  expect(detectCodecFromMoov(box('trak', box('mdia', new Uint8Array(8))))).toBe(
    'unknown',
  );
});

test('reports unknown for a truncated or malformed container', () => {
  expect(detectCodecFromMoov(new Uint8Array(0))).toBe('unknown');
  expect(detectCodecFromMoov(new Uint8Array(4))).toBe('unknown');
  // Length field claims far more data than is present.
  const bogus = new Uint8Array(16);
  new DataView(bogus.buffer).setUint32(0, 0xffff_fff0, false);
  bogus.set(ascii('trak'), 4);
  expect(detectCodecFromMoov(bogus)).toBe('unknown');
  expect(detectCodecFromBuffer(bogus)).toBe('unknown');
  expect(detectCodecFromBuffer(new Uint8Array(0))).toBe('unknown');
});

// ── Streaming path against a real container ─────────────────────────

test('probes the codec of the committed sample clip over File.slice', async () => {
  // `_sample_TeslaCam` is committed (x264 re-encode of real footage, 3s clips),
  // so this exercises probeCodecFromFile's slice-walk on a genuine MP4 produced
  // by a real encoder rather than a hand-built fixture.
  const dir = path.resolve(process.cwd(), '_sample_TeslaCam/RecentClips');
  if (!fs.existsSync(dir)) {
    test.skip(true, 'sample footage not present');
    return;
  }
  const front = fs.readdirSync(dir).find((n) => n.endsWith('-front.mp4'));
  if (!front) {
    test.skip(true, 'no front camera clip in sample footage');
    return;
  }

  const file = diskFile(
    path.resolve(process.cwd(), '_sample_TeslaCam'),
    path.join(dir, front),
  );
  const codec = await probeCodecFromFiles([file as unknown as File]);
  expect(codec).toBe('h264');
});
