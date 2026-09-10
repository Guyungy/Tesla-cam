import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaFilter, FaSearch } from 'react-icons/fa';
import { MdLocalMovies, MdSdStorage, MdSecurity } from 'react-icons/md';

import { useI18n } from '../i18n';
import type { CamClip, ClipType } from '../utils';
import { layoutRows, parseTime, rowIndexAt, visibleRange } from '../utils';
import { Clip } from './Clip';

type Props = {
  items: CamClip[];
  activeClip?: CamClip;
  onSelect: (clip: CamClip) => void;
  onOpenFolder: () => void;
};

type FilterType = ClipType | 'all';

const SIDEBAR_WIDTH_KEY = 'tesla-cam-sidebar-width';

type DateGroup = {
  /** `YYYY-MM-DD` — stable identity, unlike the localized label */
  key: string;
  label: string;
  clips: CamClip[];
};

/**
 * Row heights are declared here and enforced on the row wrappers below. The
 * layout is computed rather than measured, so any drift between these numbers
 * and the markup shows up as overlapping rows.
 */
const HEADER_H = 28; // h-7
const CLIP_H = 72; // p-2 (16) + h-14 thumbnail (56)
const CLIP_GAP = 4; // gap-1
const GROUP_GAP = 8; // mb-2
const OVERSCAN = 6;
/** Used for the first paint, before the viewport has been measured. */
const FALLBACK_VIEWPORT_H = 800;

type Row =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'clip'; key: string; clip: CamClip };

type HeaderSpan = {
  top: number;
  height: number;
  label: string;
  count: number;
};

export function Sidebar({ items, activeClip, onSelect, onOpenFolder }: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  // ── Resize Handle (width persisted across sessions) ──
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= 240 && saved <= 600) return saved;
    } catch {
      /* ignore */
    }
    return 320;
  });
  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    isResizing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing.current) return;
    const newWidth = Math.max(240, Math.min(600, e.clientX));
    setSidebarWidth(newWidth);
  }, []);

  const handleResizeEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing.current) return;
      isResizing.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
      } catch {
        /* ignore */
      }
    },
    [sidebarWidth],
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;
      const searchLower = search.toLowerCase();
      const name = item.name.toLowerCase();
      const city = item.event?.city?.toLowerCase() || '';
      const street = item.event?.street?.toLowerCase() || '';
      const reason = item.event?.reason?.toLowerCase() || '';
      const formattedName = name.replace(/_/g, ' ').replace(/-/g, ':');
      const matchSearch =
        !searchLower ||
        name.includes(searchLower) ||
        formattedName.includes(searchLower) ||
        city.includes(searchLower) ||
        street.includes(searchLower) ||
        reason.includes(searchLower);
      return matchType && matchSearch;
    });
  }, [items, filter, search]);

  // Group filtered items by date
  const dateGroups = useMemo<DateGroup[]>(() => {
    const today = dayjs().startOf('day');
    const yesterday = today.subtract(1, 'day');
    const dateFmt = t('format.dateGroup');

    const groupMap = new Map<string, DateGroup & { sortKey: string }>();

    for (const clip of filteredItems) {
      const timeStr = parseTime(clip.name);
      const d = dayjs(timeStr);
      const dayStart = d.startOf('day');
      const dateKey = d.format('YYYY-MM-DD');

      let label: string;
      if (dayStart.isSame(today)) {
        label = t('sidebar.today');
      } else if (dayStart.isSame(yesterday)) {
        label = t('sidebar.yesterday');
      } else {
        label = d.format(dateFmt);
      }

      const existing = groupMap.get(dateKey);
      if (existing) {
        existing.clips.push(clip);
      } else {
        groupMap.set(dateKey, {
          key: dateKey,
          label,
          clips: [clip],
          sortKey: dateKey,
        });
      }
    }

    // Sort groups by date descending (newest first)
    return Array.from(groupMap.values()).sort((a, b) =>
      b.sortKey.localeCompare(a.sortKey),
    );
  }, [filteredItems, t]);

  // Per-type counts for tab badges
  const typeCounts = useMemo(() => {
    const counts: Record<FilterType, number> = {
      all: items.length,
      recent: 0,
      sentry: 0,
      saved: 0,
    };
    for (const item of items) {
      if (item.type) counts[item.type]++;
    }
    return counts;
  }, [items]);

  const tabs = [
    { id: 'all', label: t('sidebar.all'), icon: MdSdStorage },
    { id: 'recent', label: t('sidebar.recent'), icon: MdLocalMovies },
    { id: 'sentry', label: t('sidebar.sentry'), icon: MdSecurity },
    { id: 'saved', label: t('sidebar.saved'), icon: MdSdStorage },
  ] as const;

  // ── Virtualized list ──
  // A drive can hold thousands of clips and every card carries a thumbnail,
  // so rendering the whole filtered list means tens of thousands of DOM nodes
  // before the user scrolls a single pixel. Date headers and clip cards have
  // different heights, so rows are laid out once into absolute offsets and
  // only the on-screen window (plus overscan) is mounted.

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of dateGroups) {
      out.push({
        kind: 'header',
        key: `h:${group.key}`,
        label: group.label,
        count: group.clips.length,
      });
      for (const clip of group.clips) {
        out.push({ kind: 'clip', key: `c:${clip.name}`, clip });
      }
    }
    return out;
  }, [dateGroups]);

  const { spans, totalHeight } = useMemo(
    () =>
      layoutRows(
        rows.map((row) =>
          row.kind === 'header'
            ? { height: HEADER_H, gap: GROUP_GAP }
            : { height: CLIP_H, gap: CLIP_GAP },
        ),
      ),
    [rows],
  );

  /** Header rows with their offsets, for the pinned date label. */
  const headerSpans = useMemo(() => {
    const out: HeaderSpan[] = [];
    rows.forEach((row, index) => {
      if (row.kind !== 'header') return;
      const span = spans[index];
      if (span) out.push({ ...span, label: row.label, count: row.count });
    });
    return out;
  }, [rows, spans]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const measure = () => setViewportHeight(el.clientHeight);

    el.addEventListener('scroll', onScroll, { passive: true });
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  // A new folder or filter reshuffles the list, so the old offset is
  // meaningless — start from the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
  }, [items, filter, search]);

  // The active clip is now normally not mounted (it may be far outside the
  // window), so keyboard clip navigation has to bring it back into view.
  useEffect(() => {
    if (!activeClip) return;
    const el = scrollRef.current;
    if (!el) return;
    const index = rows.findIndex(
      (row) => row.kind === 'clip' && row.clip.name === activeClip.name,
    );
    const span = spans[index];
    if (!span) return;

    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (span.top >= viewTop && span.top + span.height <= viewBottom) return;
    el.scrollTo({ top: Math.max(0, span.top - HEADER_H), behavior: 'smooth' });
  }, [activeClip, rows, spans]);

  const range = useMemo(
    () =>
      visibleRange(
        spans,
        scrollTop,
        viewportHeight || FALLBACK_VIEWPORT_H,
        OVERSCAN,
      ),
    [spans, scrollTop, viewportHeight],
  );

  const pinnedHeader = useMemo(() => {
    const index = rowIndexAt(headerSpans, scrollTop);
    return index >= 0 ? headerSpans[index] : null;
  }, [headerSpans, scrollTop]);

  return (
    <div
      className="bg-surface-panel/50 relative flex flex-col border-r border-white/5 backdrop-blur-xl"
      style={{ width: sidebarWidth }}
    >
      {/* Header Area */}
      <div className="flex flex-col gap-3 p-4 pb-2">
        <div className="relative">
          <FaSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            placeholder={t('sidebar.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="focus:ring-brand-primary/50 w-full rounded-lg bg-white/5 py-2 pr-3 pl-9 text-sm text-gray-200 ring-1 ring-transparent transition-all outline-none focus:bg-white/10"
          />
        </div>

        <div className="flex gap-1 rounded-lg bg-neutral-900/50 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as FilterType)}
              className={clsx(
                'flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-all',
                filter === tab.id
                  ? 'text-brand-primary bg-neutral-800 shadow-sm'
                  : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200',
              )}
            >
              <tab.icon size={14} />
              {tab.label}
              {typeCounts[tab.id] > 0 && (
                <span
                  className={clsx(
                    'rounded-full px-1 text-[9px] leading-3 tabular-nums',
                    filter === tab.id
                      ? 'bg-brand-primary/15 text-brand-primary'
                      : 'bg-white/10 text-neutral-500',
                  )}
                >
                  {typeCounts[tab.id]}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={onOpenFolder}
          className="flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <MdSdStorage size={16} />
          <span>{t('sidebar.selectFolder')}</span>
        </button>
      </div>

      {/* List Area with Date Groups */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto px-2 pb-4">
          {rows.length === 0 ? (
            <div className="mt-10 flex flex-col items-center gap-2 text-neutral-500">
              <FaFilter size={24} />
              <span className="text-sm">{t('sidebar.noResults')}</span>
            </div>
          ) : (
            <div className="relative" style={{ height: totalHeight }}>
              {rows.slice(range.start, range.end).map((row, offset) => {
                const span = spans[range.start + offset];
                if (!span) return null;
                return (
                  <div
                    key={row.key}
                    className="absolute inset-x-0"
                    style={{ top: span.top, height: span.height }}
                  >
                    {row.kind === 'header' ? (
                      <div className="flex h-full items-center px-2 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">
                        {row.label}
                        <span className="ml-2 text-neutral-600">
                          {row.count}
                        </span>
                      </div>
                    ) : (
                      <Clip
                        item={row.clip}
                        active={row.clip.name === activeClip?.name}
                        onClick={() => onSelect(row.clip)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pinned date label — replaces the sticky header that absolute
            positioning would otherwise defeat */}
        {pinnedHeader && (
          <div className="pointer-events-none absolute inset-x-2 top-0 z-10 flex h-7 items-center bg-neutral-900/90 px-2 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase backdrop-blur-sm">
            {pinnedHeader.label}
            <span className="ml-2 text-neutral-600">{pinnedHeader.count}</span>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-white/5 p-2 text-center text-[10px] text-neutral-600">
        {t('sidebar.clipCount', {
          total: items.length,
          shown: filteredItems.length,
        })}
      </div>

      {/* Resize handle */}
      <div
        className="absolute top-0 -right-1 z-30 h-full w-2 cursor-col-resize touch-none opacity-0 transition-opacity hover:opacity-100"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
      >
        <div className="mx-auto h-full w-0.5 bg-white/20" />
      </div>
    </div>
  );
}
