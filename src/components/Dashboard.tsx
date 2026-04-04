import clsx from 'clsx';

import type { APStatus, GearState, SEIDataPoint } from '../utils';

type Props = {
  /** Current SEI data point for the current playback time, or null if unavailable */
  data: SEIDataPoint | null;
  /** Whether SEI metadata is available for this clip at all */
  hasMetadata: boolean;
};

/**
 * Dashboard component for real-time telemetry overlay.
 * Displays speed, gear, steering, pedals, Autopilot status, and GPS.
 */
export function Dashboard({ data, hasMetadata }: Props) {
  if (!hasMetadata) return null;

  const speed = data?.speedKph ?? null;
  const gear = data?.gear ?? 'UNKNOWN';
  const steering = data?.steeringAngleDeg ?? 0;
  const throttle = data?.throttlePct ?? 0;
  const brake = data?.brakePct ?? 0;
  const apStatus = data?.apStatus ?? 'UNKNOWN';
  const lat = data?.latitude ?? null;
  const lon = data?.longitude ?? null;

  const getSpeedColor = (s: number | null) => {
    if (s === null) return 'text-white/40';
    if (s > 120) return 'text-red-500';
    if (s > 80) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getGearClass = (g: GearState) => {
    switch (g) {
      case 'D': return 'bg-green-600 text-white';
      case 'R': return 'bg-red-600 text-white';
      case 'N': return 'bg-yellow-600 text-black';
      case 'P': return 'bg-neutral-600 text-white';
      default: return 'bg-neutral-800 text-white/50';
    }
  };

  const getAPClass = (status: APStatus) => {
    switch (status) {
      case 'AP': return 'text-blue-400 border-blue-400/30';
      case 'FSD': return 'text-indigo-400 border-indigo-400/30';
      case 'STANDBY': return 'text-yellow-400 border-yellow-400/30';
      case 'OFF': return 'text-neutral-500 border-neutral-700';
      default: return 'text-neutral-600 border-neutral-800';
    }
  };

  // Map steering angle (-540 to 540) to visual rotation (-150 to 150)
  const steeringRotation = (steering / 540) * 150;

  return (
    <div className="pointer-events-none absolute right-4 top-1/2 z-50 w-[200px] -translate-y-1/2 select-none">
      <div className={clsx(
        'glass-panel flex flex-col gap-6 rounded-xl p-4 transition-all duration-300',
        !data && 'opacity-60',
      )}>
        {/* Speed */}
        <div className="flex flex-col items-center">
          <div className={clsx(
            'text-5xl font-bold tabular-nums tracking-tighter transition-colors',
            getSpeedColor(speed),
          )}>
            {speed !== null ? Math.round(speed) : '--'}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-white/40">km/h</div>
        </div>

        {/* Gear */}
        <div className="flex justify-center gap-1">
          {(['P', 'R', 'N', 'D'] as GearState[]).map((g) => (
            <div
              key={g}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded text-sm font-bold transition-all duration-200',
                gear === g ? getGearClass(g) : 'bg-white/5 text-white/20',
              )}
            >
              {g}
            </div>
          ))}
        </div>

        {/* Steering */}
        <div className="flex flex-col items-center gap-2">
          <svg width="80" height="45" viewBox="0 0 80 40" className="overflow-visible">
            <path
              d="M 10 35 A 30 30 0 0 1 70 35"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-white/10"
            />
            <line
              x1="40" y1="35" x2="40" y2="5"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-brand-primary transition-transform duration-200"
              style={{ 
                transform: `rotate(${steeringRotation}deg)`,
                transformOrigin: '40px 35px',
              }}
            />
          </svg>
          <div className="font-mono text-xs tabular-nums text-white/60">
            {data ? `${Math.round(steering)}\u00B0` : '--\u00B0'}
          </div>
        </div>

        {/* Pedals */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="w-6 text-[9px] font-bold uppercase text-white/40">Thr</div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
              <div 
                className="h-full bg-green-500 transition-all duration-150"
                style={{ width: `${throttle}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-brand-primary w-6 text-[9px] font-bold uppercase">Brk</div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
              <div 
                className="bg-brand-primary h-full transition-all duration-75"
                style={{ width: brake > 0 ? '100%' : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* AP Status */}
        <div className="flex flex-col items-center">
          <div className={clsx(
            'rounded-full border px-4 py-1 text-[10px] font-bold uppercase tracking-widest transition-all',
            getAPClass(apStatus),
          )}>
            {apStatus === 'UNKNOWN' ? '---' : apStatus}
          </div>
        </div>

        {/* GPS */}
        <div className="flex flex-col gap-1 border-t border-white/5 pt-4">
          <div className="flex justify-between font-mono text-[10px] tabular-nums">
            <span className="uppercase text-white/30">Lat</span>
            <span className="text-white/70">{lat !== null ? lat.toFixed(6) : '---.------'}</span>
          </div>
          <div className="flex justify-between font-mono text-[10px] tabular-nums">
            <span className="uppercase text-white/30">Lon</span>
            <span className="text-white/70">{lon !== null ? lon.toFixed(6) : '---.------'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
