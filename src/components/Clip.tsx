import clsx from 'clsx';
import dayjs from 'dayjs';

import { useI18n } from '../i18n';
import { type CamClip, parseTime } from '../utils';
import { ClipType } from './ClipType';
import { Thumb } from './Thumb';

type Props = {
  item: CamClip;
  active: boolean;
  onClick: () => void;
};

export function Clip({ item, active, onClick }: Props) {
  const { t } = useI18n();
  const time = dayjs(parseTime(item.name));
  const location = item.event
    ? [item.event.city, item.event.street].filter(Boolean).join(' ') ||
      t('sidebar.unknownLocation')
    : t('sidebar.unknownLocation');

  return (
    <button
      className={clsx(
        'group flex w-full gap-3 rounded-lg p-2 text-left transition-all',
        active
          ? 'bg-brand-primary/10 ring-brand-primary/30 ring-1'
          : 'hover:bg-white/5',
      )}
      onClick={onClick}
    >
      {/* Thumbnail — fixed 16:9 ratio */}
      <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded-md bg-neutral-800">
        <Thumb file={item.thumb} />
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-neutral-200">
            {time.format(t('format.clipDate'))}
          </span>
          <ClipType clip={item} />
        </div>
        <span className="truncate text-xs text-neutral-500">{location}</span>
        {item.event?.reason && (
          <span className="truncate text-[10px] text-neutral-600 italic">
            {item.event.reason}
          </span>
        )}
      </div>
    </button>
  );
}
