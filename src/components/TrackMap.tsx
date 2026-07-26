import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { IoMapOutline } from 'react-icons/io5';

import type { SEIDataPoint } from '../utils';

type Props = {
  /** Full SEI series for the clip (chronological) */
  data: SEIDataPoint[];
  /** Current playhead position in clip seconds */
  playedSeconds: number;
};

const VIEW_W = 200;
const VIEW_H = 140;
const PAD = 14;
const MAX_POINTS = 400;

type Projected = {
  path: string;
  points: { x: number; y: number; offsetSeconds: number }[];
};

/**
 * Equirectangular-ish projection of the GPS track into the SVG viewBox.
 * Fine at clip scale (a few km at most).
 */
function projectTrack(data: SEIDataPoint[]): Projected | null {
  const gps = data.filter(
    (d) =>
      Number.isFinite(d.latitude) &&
      Number.isFinite(d.longitude) &&
      (d.latitude !== 0 || d.longitude !== 0),
  );
  if (gps.length < 2) return null;

  const step = Math.max(1, Math.floor(gps.length / MAX_POINTS));
  const sampled = gps.filter((_, i) => i % step === 0);
  if (sampled[sampled.length - 1] !== gps[gps.length - 1]) {
    sampled.push(gps[gps.length - 1]);
  }

  const midLat = sampled.reduce((s, d) => s + d.latitude, 0) / sampled.length;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const xs = sampled.map((d) => d.longitude * cos);
  const ys = sampled.map((d) => -d.latitude);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const span = Math.max(spanX, spanY, 1e-7);

  // Uniform scale, centered
  const scale = (Math.min(VIEW_W, VIEW_H) - PAD * 2) / span;
  const offX = (VIEW_W - spanX * scale) / 2;
  const offY = (VIEW_H - spanY * scale) / 2;

  const points = sampled.map((d, i) => ({
    x: offX + (xs[i] - minX) * scale,
    y: offY + (ys[i] - minY) * scale,
    offsetSeconds: d.offsetSeconds,
  }));

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  return { path, points };
}

/**
 * Compact GPS track panel: the clip's driving path with a live playhead
 * marker. Pure SVG — works fully offline, no map tiles.
 */
export function TrackMap({ data, playedSeconds }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const projected = useMemo(() => projectTrack(data), [data]);

  // Index of the last projected point at/before the playhead
  const currentIndex = useMemo(() => {
    if (!projected) return 0;
    const pts = projected.points;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].offsetSeconds <= playedSeconds) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [projected, playedSeconds]);

  if (!projected) return null;

  const traveled = projected.points.slice(0, currentIndex + 1);
  const traveledPath = traveled
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const cur = projected.points[currentIndex];

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="glass-panel absolute bottom-3 left-3 z-20 rounded-lg p-2 text-neutral-400 transition-colors hover:text-white"
        title="GPS"
      >
        <IoMapOutline size={16} />
      </button>
    );
  }

  return (
    <div className="glass-panel absolute bottom-3 left-3 z-20 overflow-hidden rounded-xl border border-white/10">
      <button
        onClick={() => setCollapsed(true)}
        className="absolute top-1 right-1 z-10 rounded p-1 text-neutral-500 transition-colors hover:text-white"
        title="Hide"
      >
        <IoMapOutline size={12} />
      </button>
      <svg
        width={VIEW_W}
        height={VIEW_H}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block"
      >
        {/* Full route */}
        <path
          d={projected.path}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Traveled portion */}
        {traveled.length > 1 && (
          <path
            d={traveledPath}
            fill="none"
            stroke="#e82127"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* Start dot */}
        <circle
          cx={projected.points[0].x}
          cy={projected.points[0].y}
          r="3"
          fill="rgba(255,255,255,0.5)"
        />
        {/* Playhead */}
        <circle
          className={clsx('transition-all duration-200')}
          cx={cur.x}
          cy={cur.y}
          r="4.5"
          fill="#e82127"
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}
