import clsx from 'clsx';
import { useEffect, useState } from 'react';

type Props = {
  message: string | null;
  onClose: () => void;
  duration?: number;
};

export function Toast({ message, onClose, duration = 3000 }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        const closeTimer = setTimeout(onClose, 300); // Wait for fade out
        return () => clearTimeout(closeTimer);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [message, duration, onClose]);

  if (!message) return null;

  return (
    <div
      className={clsx(
        'bg-surface-panel fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 px-6 py-3 shadow-2xl backdrop-blur-md transition-all duration-300',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        <span className="text-sm font-medium tracking-wide text-white">
          {message}
        </span>
      </div>
    </div>
  );
}
