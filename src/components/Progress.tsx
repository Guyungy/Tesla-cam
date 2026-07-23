import { useCallback, useMemo, useRef } from 'react';

import { correctNum, formatDuration } from '../utils';
import type { SEIDataPoint } from '../utils';

type Props = {
  value?: number;
  max?: number;
  mark?: number;
  exportIn?: number;
  exportOut?: number;
  speedData?: SEIDataPoint[];
  onChange?: (val: number) => void;
};

export function Progress({
  value = 1, max = 1, mark, exportIn, exportOut, speedData, onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverLineRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const percent = (value / max) * 100;
  const markPercent = mark !== undefined ? (mark / max) * 100 : undefined;

  const inPct = exportIn !== undefined ? (exportIn / max) * 100 : undefined;
  const outPct = exportOut !== undefined ? (exportOut / max) * 100 : undefined;
  const hasRange = inPct !== undefined && outPct !== undefined && outPct > inPct;

  const handleInteraction = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const seconds = correctNum((x / rect.width) * max, 0, max);
    onChange?.(seconds);
  };

  // Update tooltip position via DOM refs (no re-render)
  const updateTooltip = useCallback((clientX: number) => {
    if (!containerRef.current || !tooltipRef.current || !hoverLineRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const localX = clientX - rect.left;
    const pct = correctNum(localX / rect.width, 0, 1);
    const seconds = pct * max;

    tooltipRef.current.textContent = formatDuration(seconds);
    tooltipRef.current.style.left = `${localX}px`;
    tooltipRef.current.style.display = 'block';

    hoverLineRef.current.style.left = `${pct * 100}%`;
    hoverLineRef.current.style.display = 'block';
  }, [max]);

  const hideTooltip = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
    if (hoverLineRef.current) hoverLineRef.current.style.display = 'none';
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    handleInteraction(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    updateTooltip(e.clientX);
    if (isDragging.current) handleInteraction(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging.current) {
      isDragging.current = false;
      handleInteraction(e.clientX);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Speed curve SVG
  const speedCurvePath = useMemo(() => {
    if (!speedData || speedData.length === 0 || max <= 0) return null;
    const maxPoints = 200;
    const step = Math.max(1, Math.floor(speedData.length / maxPoints));
    let maxSpeed = 0;
    for (let i = 0; i < speedData.length; i += step) {
      if (speedData[i].speedKph > maxSpeed) maxSpeed = speedData[i].speedKph;
    }
    if (maxSpeed === 0) return null;

    const svgW = 1000, svgH = 40;
    const pts: string[] = [];
    for (let i = 0; i < speedData.length; i += step) {
      const d = speedData[i];
      const x = (d.offsetSeconds / max) * svgW;
      const y = svgH - (d.speedKph / maxSpeed) * (svgH - 2);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x},${y}`);
    }
    if (pts.length < 2) return null;
    const lastX = (speedData[Math.min(speedData.length - 1, (pts.length - 1) * step)].offsetSeconds / max) * svgW;
    const area = `${pts.join(' ')} L ${lastX},${svgH} L ${(speedData[0].offsetSeconds / max) * svgW},${svgH} Z`;
    return { area, line: pts.join(' '), svgW, svgH };
  }, [speedData, max]);

  return (
    <div
      ref={containerRef}
      className="group relative flex cursor-pointer touch-none items-center py-3 select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => { handlePointerUp(e as unknown as React.PointerEvent); hideTooltip(); }}
    >
      {/* Hover time tooltip — positioned via ref, no re-renders */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute -top-8 z-30 hidden -translate-x-1/2 rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white shadow"
      />

      {/* Track */}
      <div className="relative h-2 w-full rounded-full bg-white/10 transition-all group-hover:h-8 group-hover:bg-white/5">
        {/* Speed curve */}
        {speedCurvePath && (
          <svg
            viewBox={`0 0 ${speedCurvePath.svgW} ${speedCurvePath.svgH}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full opacity-0 transition-opacity group-hover:opacity-100"
          >
            <path d={speedCurvePath.area} fill="rgba(232,33,39,0.15)" />
            <path d={speedCurvePath.line} fill="none" stroke="rgba(232,33,39,0.4)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {/* IN/OUT range */}
        {hasRange && (
          <div
            className="absolute top-0 bottom-0 rounded-sm bg-blue-500/25"
            style={{ left: `${inPct}%`, width: `${outPct! - inPct!}%` }}
          />
        )}

        {/* Played */}
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full bg-neutral-300 transition-colors group-hover:bg-white"
          style={{ width: `${percent}%` }}
        >
          <div className="absolute -top-1 right-0 h-4 w-4 translate-x-1/2 rounded-full bg-white shadow-md ring-2 ring-white/30 transition-transform group-hover:scale-125" />
        </div>

        {/* Event mark */}
        {markPercent !== undefined && (
          <div className="absolute -top-1 -bottom-1 w-1 rounded-sm bg-red-600" style={{ left: `${markPercent}%` }} />
        )}

        {/* IN/OUT markers */}
        {inPct !== undefined && <div className="absolute -top-1 -bottom-1 w-0.5 bg-blue-400" style={{ left: `${inPct}%` }} />}
        {outPct !== undefined && <div className="absolute -top-1 -bottom-1 w-0.5 bg-blue-400" style={{ left: `${outPct}%` }} />}

        {/* Hover line — positioned via ref */}
        <div ref={hoverLineRef} className="pointer-events-none absolute -top-1 -bottom-1 hidden w-px bg-white/40" />
      </div>
    </div>
  );
}
