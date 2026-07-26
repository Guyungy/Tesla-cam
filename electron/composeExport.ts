/**
 * Build FFmpeg args that compose multi-camera Tesla footage from source files
 * (filter_complex: trim → concat per cam → layout stack → overlays).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import type {
  CamName,
  ComposeExportRequest,
  ComposeSegment,
  ComposeViewType,
} from './composeTypes.js';

export type { ComposeExportRequest } from './composeTypes.js';

export type PreparedCompose = {
  args: string[];
  width: number;
  height: number;
  fps: number;
  /** Temp dir holding drawtext textfiles — caller removes it after ffmpeg exits. */
  tmpDir: string | null;
};

type Piece = {
  path: string;
  trimStart: number;
  trimDuration: number;
};

const CELL_W = 960;
const CELL_H = 540;
const BOTTOM_BAR = 60;

function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

/**
 * Escape a path for use as a quoted filtergraph option value:
 * `fontfile='C\:/Windows/…'`. Verified against ffmpeg 6.1: an UNQUOTED
 * `\:` does NOT protect the colon (the value splits and the remainder leaks
 * into the next positional option) — quoting plus `\:` is the only form the
 * graph parser handles correctly.
 */
function escPathValue(p: string): string {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
}

const CJK_RE = /[\u3000-\u9fff\uf900-\ufaff]/;

/** Resolve a system font so drawtext works with ffmpeg-static builds. */
function resolveFontFile(needsCJK: boolean): string | undefined {
  const win = needsCJK
    ? ['C:\\Windows\\Fonts\\msyh.ttc', 'C:\\Windows\\Fonts\\arial.ttf']
    : [
        'C:\\Windows\\Fonts\\arial.ttf',
        'C:\\Windows\\Fonts\\segoeui.ttf',
        'C:\\Windows\\Fonts\\msyh.ttc',
      ];
  const mac = needsCJK
    ? [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
      ]
    : [
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
      ];
  const linux = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ];
  const candidates =
    process.platform === 'win32'
      ? win
      : process.platform === 'darwin'
        ? mac
        : linux;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Writes drawtext literal texts to temp files and hands out `textfile=` refs.
 *
 * Why files instead of `text='…'`: (1) filtergraph text escaping is
 * two-leveled and quote-tricks silently render nothing on ffmpeg 6.1;
 * (2) non-ASCII argv is mangled on Windows builds (CJK became boxes).
 * A UTF-8 textfile sidesteps both. Identical texts share one file.
 */
class TextFilePool {
  private dir: string | null = null;
  private files = new Map<string, string>();

  ref(text: string): string {
    let file = this.files.get(text);
    if (!file) {
      if (!this.dir) {
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-compose-'));
      }
      file = path.join(this.dir, `t${this.files.size}.txt`);
      fs.writeFileSync(file, text, 'utf8');
      this.files.set(text, file);
    }
    return `textfile=${escPathValue(file)}`;
  }

  get tmpDir(): string | null {
    return this.dir;
  }
}

/**
 * Build a drawtext filter for a LITERAL text (goes through a textfile).
 * `expansion=none` — textfile content is otherwise still `%`-expanded, and a
 * bare `%` (e.g. "100% grade") makes drawtext silently render nothing.
 */
function drawtextFile(
  pool: TextFilePool,
  text: string,
  style: string,
): string | null {
  if (!text) return null;
  const font = resolveFontFile(CJK_RE.test(text));
  const fontPart = font ? `fontfile=${escPathValue(font)}:` : '';
  return `drawtext=${fontPart}${pool.ref(text.replace(/\r?\n/g, ' '))}:expansion=none:${style}`;
}

/**
 * Build a drawtext filter for a RAW `text=` value we fully control
 * (e.g. `%{pts\:localtime\:…}` expansion — ASCII only, pre-escaped).
 */
function drawtextRaw(rawText: string, style: string): string | null {
  if (!rawText) return null;
  const font = resolveFontFile(false);
  const fontPart = font ? `fontfile=${escPathValue(font)}:` : '';
  return `drawtext=${fontPart}text='${rawText}':${style}`;
}

/** Collect trimmed pieces for one camera across the export window. */
export function collectCamPieces(
  segments: ComposeSegment[],
  cam: CamName,
  rangeStart: number,
  rangeDuration: number,
): Piece[] {
  const rangeEnd = rangeStart + rangeDuration;
  const pieces: Piece[] = [];

  for (const seg of segments) {
    const path = seg.paths[cam];
    if (!path) continue;
    const segStart = seg.startSeconds;
    const segEnd = seg.startSeconds + seg.duration;
    const overlapStart = Math.max(rangeStart, segStart);
    const overlapEnd = Math.min(rangeEnd, segEnd);
    if (overlapEnd - overlapStart <= 0.01) continue;
    pieces.push({
      path,
      trimStart: Math.max(0, overlapStart - segStart),
      trimDuration: overlapEnd - overlapStart,
    });
  }
  return pieces;
}

function camsForView(viewType: ComposeViewType): CamName[] {
  switch (viewType) {
    case 'grid6':
      return ['left', 'front', 'right', 'left_pillar', 'back', 'right_pillar'];
    case 'grid4':
      return ['front', 'back', 'left', 'right'];
    case 'grid4old':
      return ['front', 'left', 'back', 'right'];
    default:
      return [viewType];
  }
}

function layoutSize(viewType: ComposeViewType): {
  width: number;
  height: number;
  videoHeight: number;
} {
  if (viewType === 'grid6') {
    return {
      width: even(CELL_W * 3),
      height: even(CELL_H * 2 + BOTTOM_BAR),
      videoHeight: CELL_H * 2,
    };
  }
  if (viewType === 'grid4') {
    return {
      width: even(CELL_W * 2),
      height: even(CELL_H * 2 + BOTTOM_BAR),
      videoHeight: CELL_H * 2,
    };
  }
  if (viewType === 'grid4old') {
    return {
      width: even(CELL_W * 3),
      height: even(CELL_H * 2 + BOTTOM_BAR),
      videoHeight: CELL_H * 2,
    };
  }
  return {
    width: even(CELL_W * 2),
    height: even(CELL_H * 2 + BOTTOM_BAR),
    videoHeight: CELL_H * 2,
  };
}

/**
 * Prepare ffmpeg argv (without binary path). Throws if required camera files missing.
 */
export function prepareComposeExport(
  req: ComposeExportRequest,
  outputPath: string,
): PreparedCompose {
  const fps = req.fps && req.fps > 0 ? req.fps : 30;
  const cams = camsForView(req.viewType);
  const { width, height, videoHeight } = layoutSize(req.viewType);

  const inputPaths: string[] = [];
  const camGroups: { cam: CamName; pieces: Piece[]; inputOffset: number }[] =
    [];

  for (const cam of cams) {
    const pieces = collectCamPieces(
      req.segments,
      cam,
      req.startSeconds,
      req.durationSeconds,
    );
    // Allow missing optional cameras — black placeholder is generated later.
    // Still require at least one camera to have real media overall.
    const inputOffset = inputPaths.length;
    for (const p of pieces) inputPaths.push(p.path);
    camGroups.push({ cam, pieces, inputOffset });
  }

  if (inputPaths.length === 0) {
    throw new Error('No source video files found for export range');
  }

  const filterParts: string[] = [];
  const camLabels = req.labels || {};
  const scaledPads: string[] = [];
  const textPool = new TextFilePool();

  for (let g = 0; g < camGroups.length; g++) {
    const group = camGroups[g];
    const pieceLabels: string[] = [];

    let cellW = CELL_W;
    let cellH = CELL_H;
    if (req.viewType === 'grid4old' && group.cam === 'front') {
      cellW = CELL_W * 3;
      cellH = Math.round(CELL_H * 2 * 0.6);
    } else if (req.viewType === 'grid4old') {
      cellW = CELL_W;
      cellH = Math.round(CELL_H * 2 * 0.4);
    } else if (!req.viewType.startsWith('grid')) {
      cellW = width;
      cellH = videoHeight;
    }

    const concatOut = `cam${g}`;

    if (group.pieces.length === 0) {
      // Black placeholder for missing camera in this export window
      filterParts.push(
        `color=c=black:s=${even(cellW)}x${even(cellH)}:d=${req.durationSeconds.toFixed(3)}:r=${fps}[${concatOut}raw]`,
      );
    } else {
      for (let p = 0; p < group.pieces.length; p++) {
        const piece = group.pieces[p];
        const inIdx = group.inputOffset + p;
        const lab = `c${g}p${p}`;
        const trimStart = Math.max(0, piece.trimStart);
        const trimDur = Math.max(0.04, piece.trimDuration);
        filterParts.push(
          `[${inIdx}:v]trim=start=${trimStart.toFixed(3)}:duration=${trimDur.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps}[${lab}]`,
        );
        pieceLabels.push(`[${lab}]`);
      }

      if (pieceLabels.length === 1) {
        filterParts.push(`${pieceLabels[0]}null[${concatOut}raw]`);
      } else {
        filterParts.push(
          `${pieceLabels.join('')}concat=n=${pieceLabels.length}:v=1:a=0[${concatOut}raw]`,
        );
      }
    }

    const label = camLabels[group.cam];
    let scaleChain = `[${concatOut}raw]scale=${even(cellW)}:${even(cellH)}:force_original_aspect_ratio=decrease,pad=${even(cellW)}:${even(cellH)}:(ow-iw)/2:(oh-ih)/2:black`;
    if (label) {
      const dt = drawtextFile(
        textPool,
        label,
        'fontsize=18:fontcolor=white@0.9:box=1:boxcolor=black@0.5:boxborderw=6:x=w-tw-12:y=h-th-12',
      );
      if (dt) scaleChain += `,${dt}`;
    }
    scaleChain += `[${concatOut}]`;
    filterParts.push(scaleChain);
    scaledPads.push(`[${concatOut}]`);
  }

  if (req.viewType === 'grid6') {
    filterParts.push(
      `${scaledPads.join('')}xstack=inputs=6:layout=0_0|${CELL_W}_0|${CELL_W * 2}_0|0_${CELL_H}|${CELL_W}_${CELL_H}|${CELL_W * 2}_${CELL_H}[grid]`,
    );
  } else if (req.viewType === 'grid4') {
    filterParts.push(
      `${scaledPads.join('')}xstack=inputs=4:layout=0_0|${CELL_W}_0|0_${CELL_H}|${CELL_W}_${CELL_H}[grid]`,
    );
  } else if (req.viewType === 'grid4old') {
    filterParts.push(
      `${scaledPads[1]}${scaledPads[2]}${scaledPads[3]}hstack=inputs=3[bottom]`,
    );
    filterParts.push(`${scaledPads[0]}[bottom]vstack=inputs=2[grid]`);
  } else {
    filterParts.push(`${scaledPads[0]}copy[grid]`);
  }

  const overlay = req.overlay || {};
  filterParts.push(`[grid]pad=${width}:${height}:0:0:black[base]`);

  let current = 'base';
  let step = 0;
  const pushOverlay = (dt: string | null) => {
    if (!dt) return;
    const next = `ov${step++}`;
    filterParts.push(`[${current}]${dt}[${next}]`);
    current = next;
  };

  if (overlay.showTime !== false) {
    const epoch = overlay.baseTimestampEpoch;
    const timeStyle = `fontsize=22:fontcolor=white:x=16:y=h-${BOTTOM_BAR}+18`;
    if (typeof epoch === 'number' && Number.isFinite(epoch)) {
      // Live clock: pts (starts at 0 after setpts) + export-start epoch,
      // rendered with localtime's default '%Y-%m-%d %H:%M:%S' format.
      pushOverlay(
        drawtextRaw(`%{pts\\:localtime\\:${Math.round(epoch)}}`, timeStyle),
      );
    } else if (overlay.baseTimestampLabel) {
      pushOverlay(
        drawtextFile(textPool, overlay.baseTimestampLabel, timeStyle),
      );
    }
  }

  if (overlay.showLocation && overlay.locationText) {
    pushOverlay(
      drawtextFile(
        textPool,
        overlay.locationText,
        `fontsize=18:fontcolor=0xD4D4D8:x=16:y=h-${BOTTOM_BAR}+40`,
      ),
    );
  }

  if (overlay.showDriveData && overlay.driveWindows?.length) {
    // One drawtext per pre-sampled window, gated by enable=between(t,…).
    // The renderer caps window count, but clamp here too as a backstop.
    const windows = overlay.driveWindows.slice(0, 400);
    for (const w of windows) {
      if (!w.text || !(w.end > w.start)) continue;
      pushOverlay(
        drawtextFile(
          textPool,
          w.text,
          `fontsize=20:fontcolor=0x22c55e:x=w-tw-16:y=h-${BOTTOM_BAR}+24:enable='between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})'`,
        ),
      );
    }
  }

  filterParts.push(`[${current}]format=yuv420p[vout]`);

  const filterComplex = filterParts.join(';');
  const args: string[] = ['-y', '-hide_banner'];
  for (const p of inputPaths) {
    args.push('-i', p);
  }
  args.push(
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-r',
    String(fps),
    '-t',
    req.durationSeconds.toFixed(3),
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  );

  return { args, width, height, fps, tmpDir: textPool.tmpDir };
}
