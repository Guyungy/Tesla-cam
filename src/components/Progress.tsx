import { useMemo, useRef } from 'react';

import { correctNum } from '../utils';
import type { SEIDataPoint } from '../utils';

type Props = {
  value?: number;
  max?: number;
  mark?: number;
  /** SEI speed data for rendering speed curve background */
  speedData?: SEIDataPoint[];
  onChange?: (val: number) => void;
};

export function Progress({ value = 1, max = 1, mark, speedData, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const percent = (value / max) * 100;
  const markPercent = mark !== undefined ? (mark / max) * 100 : undefined;

  const handleInteraction = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const width = rect.width;
    const newVal = (x / width) * max;
    const limitVal = correctNum(newVal, 0, max);
    onChange?.(limitVal);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    handleInteraction(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    handleInteraction(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging.current) {
      isDragging.current = false;
      handleInteraction(e.clientX);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Generate speed curve SVG path from SEI data
  const speedCurvePath = useMemo(() => {
    if (!speedData || speedData.length === 0 || max <= 0) return null;

    // Downsample to ~200 points for performance
    const maxPoints = 200;
    const step = Math.max(1, Math.floor(speedData.length / maxPoints));
    const points: { x: number; y: number }[] = [];

    // Find max speed for normalization
    let maxSpeed = 0;
    for (let i = 0; i < speedData.length; i += step) {
      if (speedData[i].speedKph > maxSpeed) maxSpeed = speedData[i].speedKph;
    }
    if (maxSpeed === 0) return null;

    const svgWidth = 1000;
    const svgHeight = 30;

    for (let i = 0; i < speedData.length; i += step) {
      const d = speedData[i];
      const x = (d.offsetSeconds / max) * svgWidth;
      const y = svgHeight - (d.speedKph / maxSpeed) * (svgHeight - 2);
      points.push({ x, y });
    }

    if (points.length < 2) return null;

    // Build SVG area path (filled under curve)
    const lineParts = points.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`));
    const areaPath = `${lineParts.join(' ')} L ${points[points.length - 1].x},${svgHeight} L ${points[0].x},${svgHeight} Z`;
    const linePath = lineParts.join(' ');

    return { areaPath, linePath, svgWidth, svgHeight };
  }, [speedData, max]);

  return (
    <div
      ref={containerRef}
      className="group -my-2 flex cursor-pointer touch-none items-center py-2 select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="relative h-1 w-full rounded-full bg-neutral-400/60 transition-all group-hover:h-6 group-hover:bg-neutral-400/20">
        {/* Speed curve background (visible on hover) */}
        {speedCurvePath && (
          <svg
            viewBox={`0 0 ${speedCurvePath.svgWidth} ${speedCurvePath.svgHeight}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full opacity-0 transition-opacity group-hover:opacity-100"
          >
            <path
              d={speedCurvePath.areaPath}
              fill="rgba(232, 33, 39, 0.15)"
            />
            <path
              d={speedCurvePath.linePath}
              fill="none"
              stroke="rgba(232, 33, 39, 0.4)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {/* Played portion */}
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full bg-neutral-200 group-hover:bg-white"
          style={{ width: `${percent}%` }}
        >
          {/* Handle knob */}
          <div className="absolute -top-1 right-0 hidden h-3 w-3 translate-x-1/2 rounded-full bg-white shadow group-hover:block" />
        </div>

        {/* Event mark */}
        {markPercent !== undefined && (
          <div
            className="absolute -top-1 -bottom-1 w-1 bg-red-700"
            style={{ left: `${markPercent}%` }}
          />
        )}
      </div>
    </div>
  );
}
