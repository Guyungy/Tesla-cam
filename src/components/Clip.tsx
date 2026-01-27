import clsx from 'clsx';
import dayjs from 'dayjs';

import { type CamClip, parseTime } from '../utils';
import { ClipType } from './ClipType';
import { Thumb } from './Thumb';

type Props = {
  item: CamClip;
  active?: boolean;
  onClick?: () => void;
};

export function Clip({ item, active, onClick }: Props) {
  const timeStr = parseTime(item.name);
  const dateObj = dayjs(timeStr);
  const date = dateObj.format('MM/DD');
  const time = dateObj.format('HH:mm');

  const location =
    [item.event?.city, item.event?.street].filter(Boolean).join(' ') ||
    '未知位置';

  return (
    <div
      className={clsx(
        'group relative flex cursor-pointer items-start gap-3 rounded-lg p-2.5 transition-all',
        active
          ? 'bg-gradient-to-r from-red-900/20 to-transparent'
          : 'hover:bg-white/5',
      )}
      onClick={onClick}
    >
      {/* Active Indicator Bar */}
      {active && (
        <div className="bg-brand-primary absolute top-2 left-0 h-[calc(100%-16px)] w-0.5 rounded-full shadow-[0_0_8px_rgba(232,33,39,0.5)]" />
      )}

      <div className="shrink-0 overflow-hidden rounded-md border border-white/10 transition-colors group-hover:border-white/20">
        <Thumb file={item.thumb} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span
            className={clsx(
              'text-sm font-medium tabular-nums',
              active ? 'text-white' : 'text-neutral-300',
            )}
          >
            {date} <span className="text-brand-primary opacity-80">{time}</span>
          </span>
          <ClipType clip={item} />
        </div>

        <div className="truncate text-xs text-neutral-500 transition-colors group-hover:text-neutral-400">
          {location}
        </div>
      </div>
    </div>
  );
}
