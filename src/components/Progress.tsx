import { correctNum } from '../utils';
import { useRef } from 'react';
type Props = {
  value?: number;
  max?: number;
  mark?: number;
  onChange?: (val: number) => void;
};

export function Progress({ value = 1, max = 1, mark, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const percent = (value / max) * 100;
  const markPercent = mark && (mark / max) * 100;

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

  return (
    <div
      ref={containerRef}
      className="group -my-2 flex cursor-pointer touch-none items-center py-2 select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="relative h-1 w-full rounded-full bg-neutral-400/60 transition-all group-hover:h-1.5 group-hover:bg-neutral-400/80">
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full bg-neutral-200 group-hover:bg-white"
          style={{ width: `${percent}%` }}
        >
          {/* Handle knob (visible on hover or drag could be nice, but keeping simple first) */}
          <div className="absolute -top-1 right-0 hidden h-3 w-3 translate-x-1/2 rounded-full bg-white shadow group-hover:block" />
        </div>
        {markPercent && (
          <div
            className="absolute -top-1 -bottom-1 w-1 bg-red-700"
            style={{ left: `${markPercent}%` }}
          ></div>
        )}
      </div>
    </div>
  );
}
