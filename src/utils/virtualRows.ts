/**
 * Layout maths for a virtualized list whose rows are not all the same height.
 *
 * The sidebar mixes 28px date headers with 72px clip cards, so a plain
 * `index * rowHeight` window does not work. These helpers turn a list of row
 * sizes into absolute offsets once, then answer "which rows are on screen"
 * without walking the whole list on every scroll event.
 */

export type RowSpan = {
  /** Vertical offset of the row's top edge, in px. */
  top: number;
  /** Row height, in px. */
  height: number;
};

export type RowSize = {
  height: number;
  /** Extra space inserted after the row (list gap / group spacing). */
  gap?: number;
};

export type RowLayout = {
  spans: RowSpan[];
  /** Total height of all rows including their trailing gaps. */
  totalHeight: number;
};

/** Prefix-sum the row sizes into absolute offsets. */
export function layoutRows(sizes: RowSize[]): RowLayout {
  const spans: RowSpan[] = [];
  let top = 0;
  for (const size of sizes) {
    const height = Math.max(0, size.height);
    spans.push({ top, height });
    top += height + Math.max(0, size.gap ?? 0);
  }
  return { spans, totalHeight: top };
}

/**
 * Index of the row whose vertical span contains `offset`, or of the last row
 * starting at or before it. Returns -1 for an empty list.
 *
 * Used for the pinned date header: the row under the top edge of the viewport
 * tells us which day is currently on screen.
 */
export function rowIndexAt(spans: RowSpan[], offset: number): number {
  if (spans.length === 0) return -1;
  let lo = 0;
  let hi = spans.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].top <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Half-open index range `[start, end)` of rows intersecting the viewport,
 * padded by `overscan` rows on each side.
 *
 * The end is found by scanning forward from the start rather than by a second
 * binary search: the number of on-screen rows is small and bounded, while a
 * scan reads contiguous memory the binary searches would chase.
 */
export function visibleRange(
  spans: RowSpan[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 0,
): { start: number; end: number } {
  if (spans.length === 0) return { start: 0, end: 0 };

  const from = Math.max(0, scrollTop);
  const to = from + Math.max(0, viewportHeight);
  const pad = Math.max(0, Math.trunc(overscan));

  // First row that is not entirely above the viewport.
  let lo = 0;
  let hi = spans.length - 1;
  let first = spans.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].top + spans[mid].height > from) {
      first = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  let last = first;
  while (last < spans.length && spans[last].top < to) last++;

  return {
    start: Math.max(0, first - pad),
    end: Math.min(spans.length, last + pad),
  };
}
