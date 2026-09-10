import type { ViewType } from './types';

/**
 * Export geometry for the canvas paths (screenshot + RGBA video fallback).
 *
 * Two things went wrong here before and both are encoded as invariants:
 *
 * 1. Grid layouts multiplied the *native* source size by the grid shape with no
 *    ceiling. Real HW4 footage is 2896x1876, so a 6-grid screenshot allocated
 *    8688x3812 — 33 megapixels, a 132 MB backing store, ~1.0 s just to JPEG
 *    encode, and 431 ms per getImageData in the video path. Capping the width
 *    brings that to 7 MP / 28 MB / 88 ms with no visible loss (the FFmpeg
 *    compose export, the primary path, only outputs 2880x1140).
 *
 * 2. The bottom info bar was a fixed 60 px while every element inside it scaled
 *    with width/1280. At export scale the icon was 204 px and the timestamp
 *    190 px inside that 60 px bar, so they were drawn over the video, and the
 *    brand line landed past the bottom edge of the image entirely. The bar is
 *    now derived from its own contents, so it fits by construction.
 */

/** Widest canvas we will allocate for any export. */
export const EXPORT_MAX_WIDTH = 3840;

/** Overlay type sizes are authored against this width. */
export const OVERLAY_BASE_WIDTH = 1280;

function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

/** Columns / rows of source-sized cells for a layout. */
export function gridShape(viewType: ViewType): { cols: number; rows: number } {
  switch (viewType) {
    case 'grid6':
      return { cols: 3, rows: 2 };
    case 'grid4':
      return { cols: 2, rows: 2 };
    case 'grid4old':
      return { cols: 3, rows: 2 };
    default:
      return { cols: 1, rows: 1 };
  }
}

export type OverlayBarLayout = {
  padding: number;
  brandSize: number;
  titleSize: number;
  subSize: number;
  gap: number;
  iconSize: number;
  /** Height the bar needs so its contents fit with even padding. */
  barHeight: number;
};

/**
 * Bottom-bar metrics for a given overlay scale. The height is *derived* from
 * the stacked contents (padding, brand line, gap, timestamp, padding) rather
 * than fixed, which is what keeps the text inside the bar at every size.
 */
export function resolveOverlayBarLayout(scale: number): OverlayBarLayout {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const padding = Math.max(4, Math.round(8 * s));
  const brandSize = Math.max(9, Math.round(11 * s));
  const titleSize = Math.max(16, Math.round(28 * s));
  const subSize = Math.max(12, Math.round(15 * s));
  const gap = Math.max(2, Math.round(4 * s));
  const iconSize = Math.max(22, Math.round(30 * s));
  return {
    padding,
    brandSize,
    titleSize,
    subSize,
    gap,
    iconSize,
    barHeight: even(padding * 2 + brandSize + gap + titleSize),
  };
}

export type ExportCanvasSize = {
  width: number;
  height: number;
  /** Height of the video grid area; the bar occupies the remainder. */
  videoHeight: number;
  barHeight: number;
  /** Overlay scale factor relative to OVERLAY_BASE_WIDTH. */
  scale: number;
};

/**
 * Canvas size for exporting `viewType` from a source of the given dimensions.
 * All returned values are even — H.264 rejects odd dimensions.
 */
export function resolveExportCanvasSize(params: {
  viewType: ViewType;
  sourceWidth: number;
  sourceHeight: number;
  maxWidth?: number;
}): ExportCanvasSize {
  const maxWidth = params.maxWidth ?? EXPORT_MAX_WIDTH;
  const srcW = params.sourceWidth > 0 ? params.sourceWidth : 1280;
  const srcH = params.sourceHeight > 0 ? params.sourceHeight : 720;
  const { cols, rows } = gridShape(params.viewType);

  let width = srcW * cols;
  let videoHeight = srcH * rows;
  if (width > maxWidth) {
    videoHeight = (videoHeight * maxWidth) / width;
    width = maxWidth;
  }
  width = even(width);
  videoHeight = even(videoHeight);

  const scale = width / OVERLAY_BASE_WIDTH;
  const { barHeight } = resolveOverlayBarLayout(scale);

  return {
    width,
    height: even(videoHeight + barHeight),
    videoHeight,
    barHeight,
    scale,
  };
}

/**
 * Segments that overlap [start, start + duration).
 *
 * The compose export used to hand the main process every segment of the clip.
 * For a RecentClips folder that is 174 segments / 1044 absolute paths, each of
 * which the main process stats for validation, to encode a window that touches
 * one or two of them.
 */
export function selectSegmentsInRange<
  T extends { startSeconds: number; duration: number },
>(segments: T[], start: number, duration: number): T[] {
  const end = start + duration;
  return segments.filter((seg) => {
    const segEnd = seg.startSeconds + seg.duration;
    // Same rule as collectCamPieces in the main process: ignore slivers.
    return Math.min(end, segEnd) - Math.max(start, seg.startSeconds) > 0.01;
  });
}
