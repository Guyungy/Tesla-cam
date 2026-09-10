/**
 * Detect the video codec of a Tesla dashcam MP4 from its sample description.
 *
 * Why this exists: the SEI telemetry reader in `parseSEI.ts` mirrors Tesla's own
 * `dashcam-mp4.js`, which is H.264-only — it matches `avc1`/`avcC` sample entries,
 * looks for NAL type 6, and skips a one-byte NAL header. Newer dashcam footage is
 * H.265/HEVC, where those three assumptions all differ. Rather than fail silently
 * (an empty telemetry strip reads as "the car recorded nothing"), the app probes
 * the container and tells the user what it found.
 *
 * Codec lives in the `stsd` sample description:
 *   avc1 / avc3 → H.264      hvc1 / hev1 → H.265
 */
import type { VideoCodec } from './types';

/** H.264 sample entry formats. */
const AVC_FORMATS = new Set(['avc1', 'avc3']);
/** H.265 / HEVC sample entry formats. */
const HEVC_FORMATS = new Set(['hvc1', 'hev1']);

/** Codec config boxes that appear verbatim inside the matching sample entry. */
const AVC_CONFIG = 'avcC';
const HEVC_CONFIG = 'hvcC';

/** Tesla dashcam `moov` is a few KB; cap the read so a malformed file cannot balloon it. */
const MOOV_READ_LIMIT = 512 * 1024;

type Box = { type: string; start: number; end: number };

function readU32(view: DataView, pos: number): number {
  return view.getUint32(pos, false);
}

function readU64(view: DataView, pos: number): number {
  const high = view.getUint32(pos, false);
  const low = view.getUint32(pos + 4, false);
  return high * 2 ** 32 + low;
}

function readAscii(data: Uint8Array, pos: number): string {
  return String.fromCharCode(
    data[pos],
    data[pos + 1],
    data[pos + 2],
    data[pos + 3],
  );
}

function codecForFormat(format: string): VideoCodec {
  if (AVC_FORMATS.has(format)) return 'h264';
  if (HEVC_FORMATS.has(format)) return 'h265';
  return 'unknown';
}

/**
 * Walk the boxes in `[start, end)`. Stops on the first malformed length rather
 * than throwing: a container we cannot parse is reported as `unknown`, not fatal.
 */
function* iterBoxes(
  data: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = readU32(view, pos);
    const type = readAscii(data, pos + 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = readU64(view, pos + 8);
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type, start: pos + header, end: pos + size };
    pos += size;
  }
}

function firstChild(
  data: Uint8Array,
  view: DataView,
  parent: Box,
  type: string,
): Box | null {
  for (const box of iterBoxes(data, view, parent.start, parent.end)) {
    if (box.type === type) return box;
  }
  return null;
}

/**
 * Last-resort scan for a codec config box inside `moov`. Only used when the
 * structural walk fails (unusual nesting, truncated read); the config box name
 * cannot meaningfully collide with other box types inside a `moov`.
 */
function scanConfigBoxes(data: Uint8Array, moov: Box): VideoCodec {
  for (let i = moov.start; i + 4 <= moov.end; i++) {
    const name = readAscii(data, i);
    if (name === HEVC_CONFIG) return 'h265';
    if (name === AVC_CONFIG) return 'h264';
  }
  return 'unknown';
}

/**
 * Detect the codec from the *contents* of a `moov` box (its payload, header excluded).
 * Walks each `trak` down to `stsd` and reads the first recognised sample entry.
 */
export function detectCodecFromMoov(moov: Uint8Array): VideoCodec {
  if (moov.length < 8) return 'unknown';
  const data = moov;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const root: Box = { type: 'moov', start: 0, end: data.length };

  for (const trak of iterBoxes(data, view, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = firstChild(data, view, trak, 'mdia');
    if (!mdia) continue;
    const minf = firstChild(data, view, mdia, 'minf');
    if (!minf) continue;
    const stbl = firstChild(data, view, minf, 'stbl');
    if (!stbl) continue;
    const stsd = firstChild(data, view, stbl, 'stsd');
    if (!stsd) continue;

    // stsd payload: 4B version+flags, 4B entry_count, then the sample entries.
    for (const entry of iterBoxes(data, view, stsd.start + 8, stsd.end)) {
      const codec = codecForFormat(entry.type);
      if (codec !== 'unknown') return codec;
    }
  }

  return scanConfigBoxes(data, root);
}

/** Detect the codec from a complete MP4 byte range. Convenience over the `moov` form. */
export function detectCodecFromBuffer(mp4: Uint8Array): VideoCodec {
  const view = new DataView(mp4.buffer, mp4.byteOffset, mp4.byteLength);
  const root: Box = { type: '', start: 0, end: mp4.length };
  const moov = firstChild(mp4, view, root, 'moov');
  if (!moov) return 'unknown';
  return detectCodecFromMoov(mp4.subarray(moov.start, moov.end));
}

/**
 * Probe a file's codec without loading it: walk top-level boxes and read only `moov`.
 * Never throws — an unreadable container reports `unknown`.
 */
export async function probeCodecFromFile(file: File): Promise<VideoCodec> {
  try {
    const fileSize = file.size;
    let pos = 0;
    while (pos + 8 <= fileSize) {
      const headerBuf = await file
        .slice(pos, Math.min(pos + 16, fileSize))
        .arrayBuffer();
      if (headerBuf.byteLength < 8) break;
      const view = new DataView(headerBuf);
      let size = readU32(view, 0);
      const type = String.fromCharCode(
        view.getUint8(4),
        view.getUint8(5),
        view.getUint8(6),
        view.getUint8(7),
      );
      let header = 8;
      if (size === 1) {
        if (headerBuf.byteLength < 16) break;
        size = readU64(view, 8);
        header = 16;
      } else if (size === 0) {
        size = fileSize - pos;
      }
      if (size < header) break;

      if (type === 'moov') {
        const take = Math.min(size - header, MOOV_READ_LIMIT);
        const moov = new Uint8Array(
          await file.slice(pos + header, pos + header + take).arrayBuffer(),
        );
        return detectCodecFromMoov(moov);
      }
      pos += size;
    }
  } catch {
    /* Unreadable container — report unknown rather than failing the load. */
  }
  return 'unknown';
}

/**
 * Probe the codec of a clip from its camera files. Every camera in a segment
 * shares one codec, so a single sample answers for the clip; the front camera is
 * preferred because that is the stream the telemetry reader actually consumes.
 */
export async function probeCodecFromFiles(files: File[]): Promise<VideoCodec> {
  const front = files.find((f) => /-front\.mp4$/i.test(f.name));
  const target = front ?? files[0];
  if (!target) return 'unknown';
  return probeCodecFromFile(target);
}
