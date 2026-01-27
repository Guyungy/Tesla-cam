import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { FaSearch, FaFilter } from 'react-icons/fa';
import { MdLocalMovies, MdSecurity, MdSdStorage } from 'react-icons/md';
import type { CamClip, ClipType } from '../utils';
import { Clip } from './Clip';

type Props = {
  items: CamClip[];
  activeClip?: CamClip;
  onSelect: (clip: CamClip) => void;
  onOpenFolder: () => void;
};

type FilterType = ClipType | 'all';

export function Sidebar({ items, activeClip, onSelect, onOpenFolder }: Props) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;

      const searchLower = search.toLowerCase();
      // Searchable fields: name (timestamp), specific format, city, street, reason
      const name = item.name.toLowerCase();
      const city = item.event?.city?.toLowerCase() || '';
      const street = item.event?.street?.toLowerCase() || '';
      const reason = item.event?.reason?.toLowerCase() || '';

      // Allow searching by simple date parts (e.g. "2023-05", "14:30")
      // item.name is usually "YYYY-MM-DD_HH-mm-ss"
      const formattedName = name.replace(/_/g, ' ').replace(/-/g, ':');

      const matchSearch =
        name.includes(searchLower) ||
        formattedName.includes(searchLower) ||
        city.includes(searchLower) ||
        street.includes(searchLower) ||
        reason.includes(searchLower);

      return matchType && matchSearch;
    });
  }, [items, filter, search]);

  const tabs = [
    { id: 'all', label: '全部', icon: MdSdStorage },
    { id: 'sentry', label: '哨兵', icon: MdSecurity },
    { id: 'saved', label: '手动', icon: MdLocalMovies },
  ] as const;

  return (
    <div className="bg-surface-panel/50 flex w-80 flex-col border-r border-white/5 backdrop-blur-xl">
      {/* Header Area */}
      <div className="flex flex-col gap-3 p-4 pb-2">
        <div className="relative">
          <FaSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            placeholder="搜索日期、地点、原因..."
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
            </button>
          ))}
        </div>

        <button
          onClick={onOpenFolder}
          className="flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <MdSdStorage size={16} />
          <span>选择文件夹 / Select Folder</span>
        </button>
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="flex flex-col gap-1">
          {filteredItems.length === 0 ? (
            <div className="mt-10 flex flex-col items-center gap-2 text-neutral-500">
              <FaFilter size={24} />
              <span className="text-sm">没有找到相关片段</span>
            </div>
          ) : (
            filteredItems.map((item, i) => (
              <Clip
                key={i}
                item={item}
                active={item.name === activeClip?.name}
                onClick={() => onSelect(item)}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="border-t border-white/5 p-2 text-center text-[10px] text-neutral-600">
        {items.length} 个片段 · {filteredItems.length} 个显示
      </div>
    </div>
  );
}
