import { VscClose } from 'react-icons/vsc';
import { useI18n } from '../i18n';

type Props = {
  open: boolean;
  progress: number; // 0-100
  frameCount?: number;
  eta?: string; // e.g. "12s", "1m 30s"
  encoding?: boolean;
  onCancel: () => void;
};

export function ExportModal({ open, progress, frameCount, eta, encoding, onCancel }: Props) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel w-96 rounded-xl border border-white/10 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">
            {encoding ? t('export.encoding') : t('export.title')}
          </h3>
          <button
            onClick={onCancel}
            className="text-neutral-500 transition-colors hover:text-white"
          >
            <VscClose size={20} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="bg-brand-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="tabular-nums text-neutral-400">
            {encoding ? t('export.encoding') : `${Math.round(progress)}%`}
          </span>
          <div className="flex flex-col items-end gap-0.5 text-xs text-neutral-500">
            {frameCount !== undefined && frameCount > 0 && (
              <span>{t('export.frames', { count: frameCount })}</span>
            )}
            {eta && !encoding && (
              <span>{t('export.eta', { time: eta })}</span>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/5"
          >
            {t('export.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
