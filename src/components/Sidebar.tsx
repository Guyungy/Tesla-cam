import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FaFilter, FaSearch } from 'react-icons/fa';
import { MdLocalMovies, MdSdStorage, MdSecurity } from 'react-icons/md';

import { useI18n } from '../i18n';
import type { CamClip, ClipType } from '../utils';
import { parseTime } from '../utils';
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
  label: string;
  clips: CamClip[];
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

    const groupMap = new Map<
      string,
      { label: string; clips: CamClip[]; sortKey: string }
    >();

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
        groupMap.set(dateKey, { label, clips: [clip], sortKey: dateKey });
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
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {filteredItems.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-2 text-neutral-500">
            <FaFilter size={24} />
            <span className="text-sm">{t('sidebar.noResults')}</span>
          </div>
        ) : (
          dateGroups.map((group) => (
            <div key={group.label} className="mb-2">
              {/* Date header */}
              <div className="sticky top-0 z-10 bg-neutral-900/90 px-2 py-1.5 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase backdrop-blur-sm">
                {group.label}
                <span className="ml-2 text-neutral-600">
                  {group.clips.length}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {group.clips.map((item, i) => (
                  <Clip
                    key={`${group.label}-${i}`}
                    item={item}
                    active={item.name === activeClip?.name}
                    onClick={() => onSelect(item)}
                  />
                ))}
              </div>
            </div>
          ))
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
