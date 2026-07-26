/**
 * Report which clips on a TeslaCam drive actually contain SEI driving data.
 *   node scripts/seiCoverage.mjs [root]
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.argv[2] ?? 'G:\\TeslaCam';

function mdatRange(fd, size) {
  const hdr = Buffer.alloc(16);
  let pos = 0;
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
    if (type === 'mdat') return { off: pos + header, size: bs - header };
    pos += bs;
  }
  return null;
}

function hasSei(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const m = mdatRange(fd, size);
    if (!m) return false;
    const len = Math.min(1_500_000, m.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, m.off);
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
    for (const f of fronts) if (hasSei(path.join(dir, f))) withSei++;
    rows.push({
      type,
      clip: path.basename(dir),
      segments: fronts.length,
      withSei,
      first: fronts[0].slice(0, 19),
      last: fronts[fronts.length - 1].slice(0, 19),
    });
  }
}

console.log(
  '\n' +
    'TYPE         CLIP                  SEG  WITH-TELEMETRY  RANGE'.padEnd(80),
);
console.log('-'.repeat(88));
for (const r of rows) {
  const pct = ((r.withSei / r.segments) * 100).toFixed(0);
  console.log(
    `${r.type.padEnd(12)} ${r.clip.padEnd(21)} ${String(r.segments).padStart(3)}  ` +
      `${String(r.withSei).padStart(3)}/${String(r.segments).padEnd(3)} ${(pct + '%').padStart(5)}   ` +
      `${r.first} → ${r.last}`,
  );
}
const seg = rows.reduce((s, r) => s + r.segments, 0);
const sei = rows.reduce((s, r) => s + r.withSei, 0);
console.log('-'.repeat(88));
console.log(
  `TOTAL: ${sei}/${seg} front segments carry driving data (${((sei / seg) * 100).toFixed(1)}%)`,
);

// Where is the cutover?
const all = rows.flatMap((r) => (r.withSei > 0 ? [r.first] : [])).sort();
if (all.length) console.log(`earliest clip with telemetry: ${all[0]}`);
