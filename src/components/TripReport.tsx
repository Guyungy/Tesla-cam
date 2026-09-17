import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { IoChevronDownOutline, IoSpeedometerOutline } from 'react-icons/io5';

import { useI18n } from '../i18n';
import type { SEIDataPoint } from '../utils';
import { computeTripStats, formatDuration } from '../utils';

type Props = {
  /** Full SEI series for the clip (chronological) */
  data: SEIDataPoint[];
  /** Wall-clock (epoch ms) of the clip's first frame, when known */
  startTimeMs?: number;
};

function km(value: number): string {
  if (!Number.isFinite(value)) return '--';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function scoreBarClass(score: number): string {
  if (score >= 85) return 'bg-green-500';
  if (score >= 70) return 'bg-yellow-500';
  return 'bg-brand-primary';
}

/**
 * Trip summary for the current clip: distance, driving time, speeds, incident
 * counts and autopilot usage, all aggregated from the SEI series the viewer
 * already decoded. Renders nothing when the clip carries no telemetry.
 */
export function TripReport({ data, startTimeMs }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  const stats = useMemo(
    () => computeTripStats(data, { startTimeMs }),
    [data, startTimeMs],
  );

  // A single sample (or a clip with no motion) has no meaningful summary.
  if (!stats || stats.spanSeconds < 1) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="glass-panel ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-neutral-400 transition-colors hover:text-white"
        title={t('trip.title')}
      >
        <IoSpeedometerOutline size={16} />
        {t('trip.title')}
      </button>
    );
  }

  const cells: { label: string; value: string }[] = [
    { label: t('trip.distance'), value: `${km(stats.distanceKm)} km` },
    { label: t('trip.moving'), value: formatDuration(stats.movingSeconds) },
    {
      label: t('trip.avgSpeed'),
      value: `${Math.round(stats.avgSpeedKph)} km/h`,
    },
    {
      label: t('trip.maxSpeed'),
      value: `${Math.round(stats.maxSpeedKph)} km/h`,
    },
    { label: t('trip.hardBraking'), value: String(stats.hardBrakingCount) },
    {
      label: t('trip.harshSteering'),
      value: String(stats.harshSteeringCount),
    },
    {
      label: t('trip.maxSteering'),
      value: `${Math.round(stats.maxSteeringDeg)}°`,
    },
    { label: t('trip.gearChanges'), value: String(stats.gearChanges) },
  ];

  return (
    <div className="glass-panel mx-auto flex w-full max-w-6xl items-center gap-4 overflow-hidden rounded-xl border border-white/10 px-3 py-2">
      <div className="flex shrink-0 items-center gap-2 border-r border-white/5 pr-3">
        <IoSpeedometerOutline className="text-neutral-500" size={15} />
        <span className="text-[10px] font-semibold tracking-widest whitespace-nowrap text-neutral-400 uppercase">
          {t('trip.title')}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded p-0.5 text-neutral-500 transition-colors hover:text-white"
          title={t('trip.hide')}
        >
          <IoChevronDownOutline size={12} />
        </button>
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-5 gap-x-5 gap-y-1.5 lg:grid-cols-10">
        {cells.map((cell) => (
          <div key={cell.label} className="flex min-w-0 flex-col">
            <span className="truncate text-[9px] font-medium tracking-wider text-white/40 uppercase">
              {cell.label}
            </span>
            <span className="font-mono text-xs text-white/85 tabular-nums">
              {cell.value}
            </span>
          </div>
        ))}

        <div className="flex min-w-0 flex-col">
          <span className="text-[9px] font-medium tracking-wider text-white/40 uppercase">
            {t('trip.apUsage')}
          </span>
          <span className="font-mono text-xs text-white/85 tabular-nums">
            {stats.apSeconds > 0
              ? `${formatDuration(stats.apSeconds)} · ${km(stats.apDistanceKm)} km`
              : t('trip.none')}
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[9px] font-medium tracking-wider text-white/40 uppercase">
            {t('trip.score')}
          </span>
          <span
            className={clsx(
              'font-mono text-sm tabular-nums',
              stats.driveScore === null ? 'text-white/40' : 'text-white/90',
            )}
          >
            {stats.driveScore === null
              ? t('trip.scoreInsufficient')
              : stats.driveScore}
          </span>
          {stats.driveScore !== null && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={clsx('h-full', scoreBarClass(stats.driveScore))}
                style={{ width: `${stats.driveScore}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
