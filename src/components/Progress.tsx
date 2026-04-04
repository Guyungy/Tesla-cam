import { useCallback, useMemo, useRef, useState } from 'react';

import { correctNum, formatDuration } from '../utils';
import type { SEIDataPoint } from '../utils';

type Props = {
  value?: number;
  max?: number;
  mark?: number;
  /** Export IN point (seconds) */
  exportIn?: number;
  /** Export OUT point (seconds) */
  exportOut?: number;
  /** SEI speed data for rendering speed curve background */
  speedData?: SEIDataPoint[];
  onChange?: (val: number) => void;
};

export function Progress({
  value = 1, max = 1, mark, exportIn, exportOut, speedData, onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<string>('');

  const percent = (value / max) * 100;
  const markPercent = mark !== undefined ? (mark / max) * 100 : undefined;

  // IN/OUT range
  const inPct = exportIn !== undefined ? (exportIn / max) * 100 : undefined;
  const outPct = exportOut !== undefined ? (exportOut / max) * 100 : undefined;
  const hasRange = inPct !== undefined && outPct !== undefined && outPct > inPct;

  const getSecondsFromX = useCallback((clientX: number): number => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return correctNum((x / rect.width) * max, 0, max);
  }, [max]);

  const handleInteraction = (clientX: number) => {
    const seconds = getSecondsFromX(clientX);
    onChange?.(seconds);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    handleInteraction(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // Update hover tooltip
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const seconds = correctNum((localX / rect.width) * max, 0, max);
      setHoverX(localX);
      setHoverTime(formatDuration(seconds));
    }

    if (isDragging.current) {
      handleInteraction(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging.current) {
      isDragging.current = false;
      handleInteraction(e.clientX);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePointerLeave = () => {
    setHoverX(null);
  };

  // Speed curve SVG
  const speedCurvePath = useMemo(() => {
    if (!speedData || speedData.length === 0 || max <= 0) return null;

    const maxPoints = 200;
    const step = Math.max(1, Math.floor(speedData.length / maxPoints));
    const points: { x: number; y: number }[] = [];

    let maxSpeed = 0;
    for (let i = 0; i < speedData.length; i += step) {
      if (speedData[i].speedKph > maxSpeed) maxSpeed = speedData[i].speedKph;
    }
    if (maxSpeed === 0) return null;

    const svgWidth = 1000;
    const svgHeight = 40;

    for (let i = 0; i < speedData.length; i += step) {
      const d = speedData[i];
      const x = (d.offsetSeconds / max) * svgWidth;
      const y = svgHeight - (d.speedKph / maxSpeed) * (svgHeight - 2);
      points.push({ x, y });
    }
    if (points.length < 2) return null;

    const lineParts = points.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`));
    const areaPath = `${lineParts.join(' ')} L ${points[points.length - 1].x},${svgHeight} L ${points[0].x},${svgHeight} Z`;
    const linePath = lineParts.join(' ');
    return { areaPath, linePath, svgWidth, svgHeight };
  }, [speedData, max]);

  return (
    <div
      ref={containerRef}
      className="group relative flex cursor-pointer touch-none items-center py-3 select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* Hover time tooltip */}
      {hoverX !== null && (
        <div
          className="pointer-events-none absolute -top-8 z-30 -translate-x-1/2 rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white shadow"
          style={{ left: hoverX }}
        >
          {hoverTime}
        </div>
      )}

      {/* Track */}
      <div className="relative h-2 w-full rounded-full bg-white/10 transition-all group-hover:h-8 group-hover:bg-white/5">
        {/* Speed curve */}
        {speedCurvePath && (
          <svg
            viewBox={`0 0 ${speedCurvePath.svgWidth} ${speedCurvePath.svgHeight}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full opacity-0 transition-opacity group-hover:opacity-100"
          >
            <path d={speedCurvePath.areaPath} fill="rgba(232, 33, 39, 0.15)" />
            <path d={speedCurvePath.linePath} fill="none" stroke="rgba(232, 33, 39, 0.4)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {/* IN/OUT range highlight */}
        {hasRange && (
          <div
            className="absolute top-0 bottom-0 rounded-sm bg-blue-500/25"
            style={{ left: `${inPct}%`, width: `${outPct! - inPct!}%` }}
          />
        )}

        {/* Played portion */}
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full bg-neutral-300 transition-colors group-hover:bg-white"
          style={{ width: `${percent}%` }}
        >
          <div className="absolute -top-1 right-0 h-4 w-4 translate-x-1/2 rounded-full bg-white shadow-md ring-2 ring-white/30 transition-transform group-hover:scale-125" />
        </div>

        {/* Event mark */}
        {markPercent !== undefined && (
          <div
            className="absolute -top-1 -bottom-1 w-1 rounded-sm bg-red-600"
            style={{ left: `${markPercent}%` }}
          />
        )}

        {/* IN marker */}
        {inPct !== undefined && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 bg-blue-400"
            style={{ left: `${inPct}%` }}
          />
        )}

        {/* OUT marker */}
        {outPct !== undefined && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 bg-blue-400"
            style={{ left: `${outPct}%` }}
          />
        )}

        {/* Hover line */}
        {hoverX !== null && containerRef.current && (
          <div
            className="pointer-events-none absolute -top-1 -bottom-1 w-px bg-white/40"
            style={{ left: `${(hoverX / containerRef.current.getBoundingClientRect().width) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
