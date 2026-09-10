/**
 * Report which clips on a TeslaCam drive actually contain SEI driving data,
 * and which codec they use.
 *
 * The codec column matters: the telemetry reader (and Tesla's own
 * dashcam-mp4.js, which ours mirrors) is H.264-only. An HEVC clip reports zero
 * samples, which is indistinguishable from "the car recorded no telemetry"
 * unless the container is inspected — so this script inspects it.
 *
 *   node scripts/seiCoverage.mjs [root]
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.argv[2] ?? 'G:\\TeslaCam';

/** Top-level box ranges for the names asked for, read with seek (no full load). */
function findBoxes(fd, size, names) {
  const hdr = Buffer.alloc(16);
  const found = {};
  let pos = 0;
  while (pos + 8 <= size) {
    fs.readSync(fd, hdr, 0, 16, pos);
    let bs = hdr.readUInt32BE(0);
    const type = hdr.toString('latin1', 4, 8);
    let header = 8;
    if (bs === 1) {
      bs = Number(hdr.readBigUInt64BE(8));
      header = 16;
    } else if (bs === 0) {
      bs = size - pos;
    }
    if (bs < header) break;
    if (names.includes(type))
      found[type] = { off: pos + header, size: bs - header };
    pos += bs;
  }
  return found;
}

/**
 * Sample-description codec: `hvcC` ⇒ H.265, `avcC` ⇒ H.264. The config box name
 * appears verbatim inside the matching sample entry and cannot collide with
 * another box type inside a `moov`.
 */
function detectCodec(fd, size, moov) {
  if (!moov) return 'unknown';
  const len = Math.min(moov.size, 512 * 1024);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, moov.off);
  if (buf.includes('hvcC')) return 'h265';
  if (buf.includes('avcC')) return 'h264';
  return 'unknown';
}

/**
 * True when a SEI NAL carries Tesla's telemetry payload: payload type 5 with the
 * 0x42…0x69 marker that both the app's decoder and Tesla's look for.
 *
 * Requiring the marker is what separates real telemetry from the type-6 SEI that
 * libx264 writes into every clip it re-encodes (its own version string), which a
 * bare "NAL type 6" check happily miscounts as driving data.
 */
function isTeslaSei(buf, start, len, headerLen) {
  const end = start + len;
  let i = start + headerLen;

  let payloadType = 0;
  while (i < end && buf[i] === 0xff) {
    payloadType += 255;
    i++;
  }
  if (i >= end) return false;
  payloadType += buf[i];
  i++;
  if (payloadType !== 5) return false;

  let payloadSize = 0;
  while (i < end && buf[i] === 0xff) {
    payloadSize += 255;
    i++;
  }
  if (i >= end) return false;
  payloadSize += buf[i];
  i++;
  if (i + payloadSize > end) return false;

  const markerStart = i;
  while (i < end && buf[i] === 0x42) i++;
  return i > markerStart && i < end && buf[i] === 0x69;
}

function hasTelemetry(fd, mdat, codec) {
  if (!mdat) return false;
  const len = Math.min(1_500_000, mdat.size);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, mdat.off);

  let c = 0;
  while (c + 4 <= buf.length) {
    const n = buf.readUInt32BE(c);
    c += 4;
    if (n < 1 || c + n > buf.length) break;
    const b0 = buf[c];
    if (codec === 'h264') {
      // H.264 NAL header is one byte; SEI is type 6.
      if ((b0 & 0x1f) === 6 && isTeslaSei(buf, c, n, 1)) return true;
    } else if (codec === 'h265') {
      // H.265 NAL header is two bytes; SEI is prefix 39 / suffix 40.
      const nalType = (b0 >> 1) & 0x3f;
      if ((nalType === 39 || nalType === 40) && isTeslaSei(buf, c, n, 2)) {
        return true;
      }
    }
    c += n;
  }
  return false;
}

function probe(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const boxes = findBoxes(fd, size, ['moov', 'mdat']);
    const codec = detectCodec(fd, size, boxes.moov);
    return { codec, telemetry: hasTelemetry(fd, boxes.mdat, codec) };
  } finally {
    fs.closeSync(fd);
  }
}

const rows = [];
for (const type of ['RecentClips', 'SavedClips', 'SentryClips']) {
  const base = path.join(ROOT, type);
  if (!fs.existsSync(base)) continue;
  const dirs =
    type === 'RecentClips'
      ? [base]
      : fs
          .readdirSync(base, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join(base, e.name));

  for (const dir of dirs) {
    const fronts = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('-front.mp4'))
      .sort();
    if (!fronts.length) continue;

    let withSei = 0;
    let codec = 'unknown';
    for (const f of fronts) {
      const res = probe(path.join(dir, f));
      // Every camera in a segment shares one codec; the first answer is enough.
      if (codec === 'unknown') codec = res.codec;
      if (res.telemetry) withSei++;
    }
    rows.push({
      type,
      clip: path.basename(dir),
      segments: fronts.length,
      codec,
      withSei,
      first: fronts[0].slice(0, 19),
      last: fronts[fronts.length - 1].slice(0, 19),
    });
  }
}

console.log(
  '\n' +
    'TYPE         CLIP                  SEG  CODEC  WITH-TELEMETRY  RANGE'.padEnd(
      80,
    ),
);
console.log('-'.repeat(92));
for (const r of rows) {
  const pct = ((r.withSei / r.segments) * 100).toFixed(0);
  console.log(
    `${r.type.padEnd(12)} ${r.clip.padEnd(21)} ${String(r.segments).padStart(3)}  ` +
      `${r.codec.padStart(5)}  ${String(r.withSei).padStart(3)}/${String(r.segments).padEnd(3)} ${(pct + '%').padStart(5)}   ` +
      `${r.first} → ${r.last}`,
  );
}
const seg = rows.reduce((s, r) => s + r.segments, 0);
const sei = rows.reduce((s, r) => s + r.withSei, 0);
console.log('-'.repeat(92));
console.log(
  `TOTAL: ${sei}/${seg} front segments carry driving data (${((sei / seg) * 100).toFixed(1)}%)`,
);

// Where is the cutover?
const all = rows.flatMap((r) => (r.withSei > 0 ? [r.first] : [])).sort();
if (all.length) console.log(`earliest clip with telemetry: ${all[0]}`);

const hevc = rows.filter((r) => r.codec === 'h265');
if (hevc.length) {
  console.log(
    `\nWARNING: ${hevc.length} clip(s) are H.265/HEVC. The app's SEI reader — like\n` +
      `Tesla's own dashcam-mp4.js — is H.264-only, so those clips will show an empty\n` +
      `dashboard and report "0/N with telemetry" above. That is a codec limitation,\n` +
      `not missing data from the car.`,
  );
}
