/**
 * Export geometry regressions, measured against real HW4 footage (2896x1876).
 */
import { expect, test } from '@playwright/test';

import {
  EXPORT_MAX_WIDTH,
  resolveExportCanvasSize,
  resolveOverlayBarLayout,
  selectSegmentsInRange,
} from '../src/utils/exportLayout';

const SRC = { sourceWidth: 2896, sourceHeight: 1876 };

test('grid exports are capped instead of multiplying native resolution', () => {
  // Uncapped this was 8688x3812 — 33 MP and a 132 MB backing store.
  const grid6 = resolveExportCanvasSize({ viewType: 'grid6', ...SRC });
  expect(grid6.width).toBe(EXPORT_MAX_WIDTH);
  expect((grid6.width * grid6.height) / 1e6).toBeLessThan(10);

  // Aspect ratio of the video area is preserved by the cap.
  const grid6Ar = grid6.width / grid6.videoHeight;
  expect(grid6Ar).toBeCloseTo((2896 * 3) / (1876 * 2), 2);
});

test('every layout yields even, H.264-safe dimensions', () => {
  for (const viewType of [
    'grid6',
    'grid4',
    'grid4old',
    'front',
    'left_pillar',
  ] as const) {
    const s = resolveExportCanvasSize({ viewType, ...SRC });
    expect(s.width % 2, `${viewType} width`).toBe(0);
    expect(s.height % 2, `${viewType} height`).toBe(0);
    expect(s.videoHeight % 2, `${viewType} videoHeight`).toBe(0);
    expect(s.height).toBe(s.videoHeight + s.barHeight);
    expect(s.width).toBeLessThanOrEqual(EXPORT_MAX_WIDTH);
  }
});

test('the video resolution setting scales the whole layout coherently', () => {
  // 4K parity costs roughly double the bytes and encode time of 2880, so the
  // tier has to actually take effect — and the bar must follow it.
  const tiers = [3840, 2880, 1920].map((maxWidth) =>
    resolveExportCanvasSize({ viewType: 'grid6', ...SRC, maxWidth }),
  );

  expect(tiers.map((t) => t.width)).toEqual([3840, 2880, 1920]);
  for (const t of tiers) {
    expect(t.width % 2).toBe(0);
    expect(t.height % 2).toBe(0);
    expect(t.height).toBe(t.videoHeight + t.barHeight);
    // Overlay type scales with the canvas, so the bar shrinks with it.
    expect(t.barHeight).toBe(resolveOverlayBarLayout(t.scale).barHeight);
  }
  // Same framing at every tier — only the pixel count changes. Exact equality
  // is not available: each tier snaps to even dimensions independently.
  const ideal = (2896 * 3) / (1876 * 2);
  for (const t of tiers) {
    expect(t.width / t.videoHeight, `${t.width} wide`).toBeCloseTo(ideal, 2);
  }
  expect(tiers[0].barHeight).toBeGreaterThan(tiers[2].barHeight);
});

test('a single camera below the cap keeps native resolution', () => {
  const single = resolveExportCanvasSize({ viewType: 'front', ...SRC });
  expect(single.width).toBe(2896);
  expect(single.videoHeight).toBe(1876);
});

test('overlay bar always fits its own contents', () => {
  // The old bar was a fixed 60px while its contents scaled with width/1280:
  // at export scale the timestamp was 190px tall inside it.
  for (const scale of [0.5, 1, 1.5, 2, 3, 6.79]) {
    const l = resolveOverlayBarLayout(scale);
    const stacked = l.padding + l.brandSize + l.gap + l.titleSize + l.padding;
    expect(l.barHeight, `scale ${scale}`).toBeGreaterThanOrEqual(stacked);
    expect(l.barHeight % 2).toBe(0);
  }
});

test('brand and timestamp lines do not overlap', () => {
  for (const scale of [1, 2, 3]) {
    const l = resolveOverlayBarLayout(scale);
    const brandTop = l.padding;
    const titleTop = brandTop + l.brandSize + l.gap;
    // Brand must end before the title begins, and the title inside the bar.
    expect(brandTop + l.brandSize, `scale ${scale}`).toBeLessThanOrEqual(
      titleTop,
    );
    expect(titleTop + l.titleSize).toBeLessThanOrEqual(l.barHeight);
  }
});

test('the icon fits inside the bar at export scale', () => {
  for (const scale of [1, 2, 3]) {
    const l = resolveOverlayBarLayout(scale);
    expect(l.iconSize, `scale ${scale}`).toBeLessThanOrEqual(l.barHeight);
  }
});

// ── Segment selection ──

const segments = Array.from({ length: 174 }, (_, i) => ({
  name: `seg-${i}`,
  startSeconds: i * 60,
  duration: 60,
}));

test('only segments overlapping the export window are sent', () => {
  // A 10s export inside one segment must not ship the other 173.
  expect(selectSegmentsInRange(segments, 125, 10).map((s) => s.name)).toEqual([
    'seg-2',
  ]);

  // A window straddling a boundary takes both.
  expect(selectSegmentsInRange(segments, 55, 10).map((s) => s.name)).toEqual([
    'seg-0',
    'seg-1',
  ]);
});

test('touching a boundary exactly does not pull in a zero-length neighbour', () => {
  // [60, 120) belongs to seg-1 alone — seg-0 ends exactly at 60.
  expect(selectSegmentsInRange(segments, 60, 60).map((s) => s.name)).toEqual([
    'seg-1',
  ]);
});

test('a window past the end selects nothing', () => {
  const clipEnd = segments.length * 60; // 10440s
  expect(selectSegmentsInRange(segments, clipEnd + 100, 30)).toEqual([]);
});

test('a full-clip export still selects everything', () => {
  expect(selectSegmentsInRange(segments, 0, 174 * 60)).toHaveLength(174);
});
