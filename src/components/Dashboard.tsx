import clsx from 'clsx';

import type { GearState, SEIDataPoint } from '../utils';

type Props = {
  /** Current SEI data point for the current playback time, or null if unavailable */
  data: SEIDataPoint | null;
  /**
   * Whether SEI metadata is available for this clip at all.
   * When false, the strip still renders dimly so chrome stays visible.
   */
  hasMetadata: boolean;
  /** Absolute / segment timestamp text shown at the start of the strip */
  timeText?: string;
  /** Location / address text shown after time */
  locationText?: string;
  /** Layout: docked bar (default) or absolute overlay on video */
  variant?: 'bar' | 'overlay';
};

/**
 * Compact telemetry strip: time · location · speed · gear · steering · pedals.
 * Time/location are the primary emphasis; drive metrics sit after.
 */
export function Dashboard({
  data,
  hasMetadata,
  timeText,
  locationText,
  variant = 'bar',
}: Props) {
  const speed = data?.speedKph ?? null;
  const gear = data?.gear ?? 'UNKNOWN';
  const steering = data?.steeringAngleDeg ?? 0;
  const throttle = data?.throttlePct ?? 0;
  const brake = data?.brakePct ?? 0;
  const isLive = hasMetadata && !!data;

  const getSpeedColor = (s: number | null) => {
    if (s === null) return 'text-white/40';
    if (s > 120) return 'text-red-400';
    if (s > 80) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getGearClass = (g: GearState) => {
    switch (g) {
      case 'D':
        return 'bg-green-600 text-white';
      case 'R':
        return 'bg-red-600 text-white';
      case 'N':
        return 'bg-yellow-500 text-black';
      case 'P':
        return 'bg-neutral-600 text-white';
      default:
        return 'bg-neutral-800 text-white/50';
    }
  };

  const thr = Math.min(100, Math.max(0, throttle));
  const brk = Math.min(100, Math.max(0, brake));

  return (
    <div
      className={clsx(
        'pointer-events-none z-40 w-full select-none',
        variant === 'overlay' && 'absolute inset-x-0 bottom-0',
        !isLive && 'opacity-80',
      )}
    >
      <div
        className={clsx(
          'flex items-center gap-3 px-3.5 py-2 text-[11px]',
          variant === 'overlay'
            ? 'bg-gradient-to-t from-black/85 via-black/70 to-black/20 backdrop-blur-[2px]'
            : 'glass-panel rounded-xl border border-white/5',
        )}
      >
        {/* Time + location — primary, high emphasis */}
        {(timeText || locationText) && (
          <>
            <div className="flex max-w-[48%] min-w-0 flex-col justify-center gap-0.5">
              {timeText && (
                <span className="truncate text-lg leading-tight font-bold tracking-wide text-white tabular-nums drop-shadow-sm sm:text-xl">
                  {timeText}
                </span>
              )}
              {locationText && (
                <span
                  className="truncate text-sm leading-tight font-medium text-white/85 sm:text-base"
                  title={locationText}
                >
                  {locationText}
                </span>
              )}
            </div>
            <Divider tall />
          </>
        )}

        {/* Speed */}
        <div className="flex min-w-[4.25rem] items-baseline gap-1">
          <span
            className={clsx(
              'text-2xl leading-none font-bold tracking-tight tabular-nums',
              getSpeedColor(speed),
            )}
          >
            {speed !== null ? Math.round(speed) : '--'}
          </span>
          <span className="text-[9px] font-medium tracking-wider text-white/35 uppercase">
            km/h
          </span>
        </div>

        <Divider />

        {/* Gear */}
        <div className="flex items-center gap-0.5">
          {(['P', 'R', 'N', 'D'] as GearState[]).map((g) => (
            <div
              key={g}
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold transition-all',
                gear === g ? getGearClass(g) : 'bg-white/5 text-white/20',
              )}
            >
              {g}
            </div>
          ))}
        </div>

        <Divider />

        {/* Steering */}
        <div className="flex min-w-[3.25rem] items-center gap-1.5">
          <span className="text-[9px] font-bold tracking-wider text-white/35 uppercase">
            Str
          </span>
          <span className="font-mono text-xs text-white/80 tabular-nums">
            {data ? `${Math.round(steering)}°` : '--°'}
          </span>
        </div>

        <Divider />

        {/* Pedals */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Pedal label="Thr" value={thr} color="bg-green-500" show={!!data} />
          <Pedal
            label="Brk"
            value={brk}
            color="bg-brand-primary"
            show={!!data}
          />
        </div>
      </div>
    </div>
  );
}

function Divider({ tall = false }: { tall?: boolean }) {
  return (
    <div className={clsx('w-px shrink-0 bg-white/12', tall ? 'h-9' : 'h-5')} />
  );
}

function Pedal({
  label,
  value,
  color,
  show,
}: {
  label: string;
  value: number;
  color: string;
  show: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className={clsx(
          'w-6 shrink-0 text-[9px] font-bold uppercase',
          label === 'Brk' ? 'text-brand-primary' : 'text-white/40',
        )}
      >
        {label}
      </span>
      <div className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={clsx('h-full transition-all duration-100', color)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[9px] text-white/40 tabular-nums">
        {show ? Math.round(value) : '--'}
      </span>
    </div>
  );
}
