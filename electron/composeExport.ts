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
  /** Encoder selected for this run ('libx264' or a hardware encoder). */
  encoder: string;
  /** Temp dir holding drawtext textfiles — caller removes it after ffmpeg exits. */
  tmpDir: string | null;
};

/**
 * Encoder-specific output args, quality-matched around "visually great
 * dashcam footage". Hardware encoders trade a little compression efficiency
 * for a large wall-clock speedup.
 */
function encoderArgs(encoder: string): string[] {
  switch (encoder) {
    case 'h264_nvenc':
      return [
        '-c:v',
        'h264_nvenc',
        '-preset',
        'p4',
        '-rc',
        'vbr',
        '-cq',
        '23',
        '-b:v',
        '0',
      ];
    case 'h264_qsv':
      return [
        '-c:v',
        'h264_qsv',
        '-preset',
        'veryfast',
        '-global_quality',
        '23',
      ];
    case 'h264_amf':
      return [
        '-c:v',
        'h264_amf',
        '-quality',
        'balanced',
        '-rc',
        'cqp',
        '-qp_i',
        '22',
        '-qp_p',
        '24',
      ];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'];
  }
}

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

/** Round down to even, so N cells never exceed the canvas they sit in. */
function evenDown(n: number): number {
  const r = Math.max(2, Math.floor(n));
  return r % 2 === 0 ? r : r - 1;
}

/**
 * Bar metrics when the renderer did not supply a layout. Mirrors
 * resolveOverlayBarLayout in the renderer: the bar is sized by its contents so
 * the text can never spill out of it.
 */
function defaultBarLayout(width: number) {
  const s = width / 1280;
  const padding = Math.max(4, Math.round(8 * s));
  const brandSize = Math.max(9, Math.round(11 * s));
  const titleSize = Math.max(16, Math.round(28 * s));
  const subSize = Math.max(12, Math.round(15 * s));
  const gap = Math.max(2, Math.round(4 * s));
  const iconSize = Math.max(22, Math.round(30 * s));
  const hPad = Math.round(22 * s);
  return {
    scale: s,
    padding,
    brandSize,
    titleSize,
    subSize,
    gap,
    iconSize,
    hPad,
    leftTextX: hPad + iconSize + Math.round(16 * s),
    barHeight: even(padding * 2 + brandSize + gap + titleSize),
  };
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

  /** Temp dir, created on demand — also used for the filtergraph script. */
  ensureDir(): string {
    if (!this.dir) {
      this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-compose-'));
    }
    return this.dir;
  }

  ref(text: string): string {
    let file = this.files.get(text);
    if (!file) {
      file = path.join(this.ensureDir(), `t${this.files.size}.txt`);
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
  opts: { encoder?: string; iconPath?: string } = {},
): PreparedCompose {
  const encoder = opts.encoder || 'libx264';
  const fps = req.fps && req.fps > 0 ? req.fps : 30;
  const cams = camsForView(req.viewType);
  const legacy = layoutSize(req.viewType);
  const width = req.layout?.width ?? legacy.width;
  const videoHeight = req.layout?.videoHeight ?? legacy.videoHeight;
  const bar = req.layout ?? defaultBarLayout(width);
  const barHeight = bar.barHeight;
  const height = req.layout?.height ?? even(videoHeight + barHeight);
  const gridCellW = evenDown(width / (req.viewType === 'grid4' ? 2 : 3));
  const gridCellH = evenDown(videoHeight / 2);

  // The overlay glyph is decorative: if it cannot be read, drop it rather than
  // handing FFmpeg an input that fails the whole encode. This bit an installed
  // build, where the path resolved inside app.asar and only ffmpeg could tell.
  const iconPath =
    opts.iconPath && bar.iconSize > 0 && fs.existsSync(opts.iconPath)
      ? opts.iconPath
      : undefined;

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

    // Cells are carved out of the real canvas rather than fixed 16:9 blocks.
    // Tesla cameras are 1.54:1, so 960x540 cells letterboxed every one of them.
    let cellW = gridCellW;
    let cellH = gridCellH;
    if (req.viewType === 'grid4old' && group.cam === 'front') {
      cellW = evenDown(width);
      cellH = evenDown(videoHeight * 0.6);
    } else if (req.viewType === 'grid4old') {
      cellW = evenDown(width / 3);
      cellH = evenDown(videoHeight * 0.4);
    } else if (!req.viewType.startsWith('grid')) {
      cellW = evenDown(width);
      cellH = evenDown(videoHeight);
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
      // Label metrics track the canvas overlay (labelFontSize = 14 * scale)
      // instead of a fixed 18px that vanishes at export resolutions.
      const labelFont = Math.max(11, Math.round(14 * bar.scale));
      const labelPad = Math.max(4, Math.round(6 * bar.scale));
      const labelMargin = Math.max(8, Math.round(12 * bar.scale));
      const dt = drawtextFile(
        textPool,
        label,
        `fontsize=${labelFont}:fontcolor=white@0.9:box=1:boxcolor=black@0.5:` +
          `boxborderw=${labelPad}:x=w-tw-${labelMargin}:y=h-th-${labelMargin}`,
      );
      if (dt) scaleChain += `,${dt}`;
    }
    scaleChain += `[${concatOut}]`;
    filterParts.push(scaleChain);
    scaledPads.push(`[${concatOut}]`);
  }

  if (req.viewType === 'grid6') {
    filterParts.push(
      `${scaledPads.join('')}xstack=inputs=6:layout=0_0|${gridCellW}_0|${gridCellW * 2}_0|0_${gridCellH}|${gridCellW}_${gridCellH}|${gridCellW * 2}_${gridCellH}[grid]`,
    );
  } else if (req.viewType === 'grid4') {
    filterParts.push(
      `${scaledPads.join('')}xstack=inputs=4:layout=0_0|${gridCellW}_0|0_${gridCellH}|${gridCellW}_${gridCellH}[grid]`,
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
  /** Chain any single-input filter expression onto the overlay stack. */
  const chain = (expr: string | null) => {
    if (!expr) return;
    const next = `ov${step++}`;
    filterParts.push(`[${current}]${expr}[${next}]`);
    current = next;
  };

  // ── Bottom info bar, matching the canvas overlay in Viewer.drawFrame ──
  const barY = videoHeight;
  const brandY = barY + bar.padding;
  const titleY = brandY + bar.brandSize + bar.gap;

  chain(
    `drawbox=x=0:y=${barY}:w=${width}:h=${barHeight}:color=0x111111@1:t=fill`,
  );
  chain(`drawbox=x=0:y=${barY}:w=${width}:h=1:color=white@0.1:t=fill`);

  // Tesla mark on a faint red plate, vertically centred in the bar.
  if (iconPath) {
    const iconX = bar.hPad;
    const iconY = Math.round(barY + (barHeight - bar.iconSize) / 2);
    const plateX = iconX - Math.round(8 * bar.scale);
    const plateY = iconY - Math.round(6 * bar.scale);
    chain(
      `drawbox=x=${plateX}:y=${plateY}:` +
        `w=${bar.iconSize + Math.round(16 * bar.scale)}:` +
        `h=${bar.iconSize + Math.round(12 * bar.scale)}:` +
        `color=0xe11d48@0.12:t=fill`,
    );
    const iconIn = inputPaths.length; // appended after every video input
    filterParts.push(
      `[${iconIn}:v]scale=${bar.iconSize}:${bar.iconSize}[teslaicon]`,
    );
    const next = `ov${step++}`;
    filterParts.push(
      `[${current}][teslaicon]overlay=${iconX}:${iconY}:format=auto[${next}]`,
    );
    current = next;
  }

  if (overlay.showTime !== false) {
    if (overlay.brandText) {
      chain(
        drawtextFile(
          textPool,
          overlay.brandText,
          `fontsize=${bar.brandSize}:fontcolor=0xfb7185:x=${bar.leftTextX}:y=${brandY}`,
        ),
      );
    }

    const titleStyle = `fontsize=${bar.titleSize}:fontcolor=0xfafafa:x=${bar.leftTextX}:y=${titleY}`;
    if (overlay.timeWindows?.length) {
      // Pre-rendered localized timestamps, one gated window per second.
      for (const w of overlay.timeWindows) {
        if (!w.text || !(w.end > w.start)) continue;
        chain(
          drawtextFile(
            textPool,
            w.text,
            `${titleStyle}:enable='between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})'`,
          ),
        );
      }
    } else if (
      typeof overlay.baseTimestampEpoch === 'number' &&
      Number.isFinite(overlay.baseTimestampEpoch)
    ) {
      // Fallback: ffmpeg's own clock, fixed 'YYYY-MM-DD HH:MM:SS' format.
      chain(
        drawtextRaw(
          `%{pts\\:localtime\\:${Math.round(overlay.baseTimestampEpoch)}}`,
          titleStyle,
        ),
      );
    } else if (overlay.baseTimestampLabel) {
      chain(drawtextFile(textPool, overlay.baseTimestampLabel, titleStyle));
    }
  }

  const hasDriveText = !!(
    overlay.showDriveData && overlay.driveWindows?.length
  );

  if (overlay.showLocation && overlay.locationText) {
    // Location is centred when it owns the right side, and moves up when the
    // drive readout also needs a row there.
    const locY = hasDriveText
      ? barY + bar.padding
      : Math.round(barY + (barHeight - bar.subSize) / 2);
    const locStyle = `fontsize=${bar.subSize}:x=w-tw-${bar.hPad}:y=${locY}`;

    // The red accent to the left of the text. FFmpeg cannot reference another
    // filter's text width, and measuring it in the renderer misplaces the bar
    // because the two use different fonts. Instead draw the same string twice,
    // both right-aligned to the same edge: the red pass carries a leading bar
    // glyph and is wider, so once the plain pass paints over it only that
    // glyph is left showing — exact at any width, no measurement.
    chain(
      drawtextFile(
        textPool,
        `▌ ${overlay.locationText}`,
        `${locStyle}:fontcolor=0xef4444`,
      ),
    );
    chain(
      drawtextFile(
        textPool,
        overlay.locationText,
        `${locStyle}:fontcolor=0xD4D4D8`,
      ),
    );
  }

  if (overlay.showDriveData && overlay.driveWindows?.length) {
    // One drawtext per pre-sampled window, gated by enable=between(t,…).
    for (const w of overlay.driveWindows) {
      if (!w.text || !(w.end > w.start)) continue;
      chain(
        drawtextFile(
          textPool,
          w.text,
          `fontsize=${bar.subSize}:fontcolor=0x22c55e:x=w-tw-${bar.hPad}:` +
            `y=${barY + barHeight - bar.subSize - bar.padding}:` +
            `enable='between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})'`,
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
  if (iconPath) {
    args.push('-i', iconPath);
  }

  // The graph goes in a file, not argv. Windows caps a command line at 32767
  // characters and one gated drawtext per second of export runs ~240 chars —
  // past ~150 windows ffmpeg simply failed to spawn, so long exports with
  // drive data or a localized clock could never work from argv.
  const graphFile = path.join(textPool.ensureDir(), 'filtergraph.txt');
  fs.writeFileSync(graphFile, filterComplex, 'utf8');
  args.push(
    '-filter_complex_script',
    graphFile,
    '-map',
    '[vout]',
    '-an',
    ...encoderArgs(encoder),
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

  return { args, width, height, fps, encoder, tmpDir: textPool.tmpDir };
}
