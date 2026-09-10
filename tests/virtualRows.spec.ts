/**
 * Unit tests for the sidebar's virtualized layout maths.
 *
 * These two functions decide which rows exist in the DOM, so an off-by-one
 * shows up as a missing clip at the edge of the viewport and a prefix-sum
 * mistake shows up as overlapping rows. `visibleRange` is additionally
 * cross-checked against a literal linear scan, which is what it replaced.
 */
import { expect, test } from '@playwright/test';

import {
  layoutRows,
  rowIndexAt,
  type RowSpan,
  visibleRange,
} from '../src/utils/virtualRows';

/** Reference implementation: every row whose span touches the viewport. */
function referenceRange(
  spans: RowSpan[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  const from = Math.max(0, scrollTop);
  const to = from + Math.max(0, viewportHeight);
  let start = spans.length;
  let end = 0;
  spans.forEach((span, index) => {
    if (span.top + span.height > from && span.top < to) {
      start = Math.min(start, index);
      end = Math.max(end, index + 1);
    }
  });
  if (start === spans.length) return { start: 0, end: 0 };
  return {
    start: Math.max(0, start - overscan),
    end: Math.min(spans.length, end + overscan),
  };
}

test('lays out an empty list', () => {
  expect(layoutRows([])).toEqual({ spans: [], totalHeight: 0 });
});

test('prefix-sums heights and gaps', () => {
  const { spans, totalHeight } = layoutRows([
    { height: 28, gap: 8 },
    { height: 72, gap: 4 },
    { height: 72 },
  ]);
  expect(spans).toEqual([
    { top: 0, height: 28 },
    { top: 36, height: 72 },
    { top: 112, height: 72 },
  ]);
  // 28+8 + 72+4 + 72
  expect(totalHeight).toBe(184);
});

test('treats a missing gap as zero and clamps negatives', () => {
  const { spans, totalHeight } = layoutRows([
    { height: 10 },
    { height: -5, gap: -2 },
    { height: 10 },
  ]);
  expect(spans).toEqual([
    { top: 0, height: 10 },
    { top: 10, height: 0 },
    { top: 10, height: 10 },
  ]);
  expect(totalHeight).toBe(20);
});

test('selects no rows for an empty list', () => {
  expect(visibleRange([], 0, 500)).toEqual({ start: 0, end: 0 });
});

test('selects only the rows touching the viewport', () => {
  const { spans } = layoutRows(
    Array.from({ length: 10 }, () => ({ height: 100 })),
  );
  expect(visibleRange(spans, 0, 300)).toEqual({ start: 0, end: 3 });
  expect(visibleRange(spans, 250, 300)).toEqual({ start: 2, end: 6 });
});

test('pads the window by the overscan on both sides', () => {
  const { spans } = layoutRows(
    Array.from({ length: 10 }, () => ({ height: 100 })),
  );
  expect(visibleRange(spans, 500, 100, 2)).toEqual({ start: 3, end: 8 });
});

test('clamps at both ends of the list', () => {
  const { spans } = layoutRows(
    Array.from({ length: 5 }, () => ({ height: 100 })),
  );
  expect(visibleRange(spans, 0, 100, 4)).toEqual({ start: 0, end: 5 });
  // Scrolled past the end: the browser would normally clamp scrollTop, but a
  // transient overshoot during momentum scroll must still render the tail
  // rather than an empty list.
  expect(visibleRange(spans, 10_000, 100, 3)).toEqual({ start: 2, end: 5 });
});

test('handles a viewport shorter than a single row', () => {
  const { spans } = layoutRows([{ height: 400 }, { height: 400 }]);
  expect(visibleRange(spans, 0, 10)).toEqual({ start: 0, end: 1 });
  // Scrolled into the seam between the two rows.
  expect(visibleRange(spans, 390, 20)).toEqual({ start: 0, end: 2 });
});

test('matches a linear scan across a range of scroll positions', () => {
  // Irregular heights, mirroring headers interleaved with clip cards.
  const { spans, totalHeight } = layoutRows([
    { height: 28, gap: 8 },
    ...Array.from({ length: 40 }, (_, i) =>
      i % 10 === 9 ? { height: 28, gap: 8 } : { height: 72, gap: 4 },
    ),
  ]);
  // Stay within the scrollable range: beyond it the two implementations differ
  // on purpose (see the clamping test above).
  for (let scrollTop = 0; scrollTop <= totalHeight - 100; scrollTop += 37) {
    for (const viewport of [200, 600, 1200]) {
      expect(visibleRange(spans, scrollTop, viewport, 3)).toEqual(
        referenceRange(spans, scrollTop, viewport, 3),
      );
    }
  }
});

test('locates the row under a given offset', () => {
  const { spans } = layoutRows([
    { height: 28, gap: 8 },
    { height: 72, gap: 4 },
    { height: 72, gap: 4 },
  ]);
  expect(rowIndexAt(spans, -50)).toBe(0);
  expect(rowIndexAt(spans, 0)).toBe(0);
  expect(rowIndexAt(spans, 27)).toBe(0);
  expect(rowIndexAt(spans, 36)).toBe(1);
  expect(rowIndexAt(spans, 107)).toBe(1);
  expect(rowIndexAt(spans, 112)).toBe(2);
  expect(rowIndexAt(spans, 100_000)).toBe(2);
  expect(rowIndexAt([], 0)).toBe(-1);
});
