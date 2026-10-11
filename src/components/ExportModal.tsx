import { VscClose } from 'react-icons/vsc';

import { useI18n } from '../i18n';

type Props = {
  open: boolean;
  progress: number; // 0-100
  clipName: string;
  range: string;
  view: string;
  resolution: string;
  frameCount?: number;
  eta?: string; // e.g. "12s", "1m 30s"
  encoding?: boolean;
  onCancel: () => void;
};

export function ExportModal({
  open,
  progress,
  clipName,
  range,
  view,
  resolution,
  frameCount,
  eta,
  encoding,
  onCancel,
}: Props) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="bg-surface-panel w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3
              id="export-dialog-title"
              className="text-lg font-semibold text-white"
            >
              {t('export.title')}
            </h3>
            <p
              className="mt-1 truncate text-xs text-neutral-400"
              title={clipName}
            >
              {clipName}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('export.cancel')}
          >
            <VscClose size={20} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
          <div className="min-w-0">
            <div className="text-neutral-500">{t('export.range')}</div>
            <div className="mt-1 truncate font-medium text-white" title={range}>
              {range}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-neutral-500">{t('export.view')}</div>
            <div className="mt-1 truncate font-medium text-white" title={view}>
              {view}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-neutral-500">{t('export.resolution')}</div>
            <div className="mt-1 font-medium text-white">{resolution}</div>
          </div>
        </div>

        <div className="mt-5 flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-neutral-200">
            {encoding ? t('export.encoding') : t('export.processing')}
          </span>
          <span className="text-xl font-semibold text-white tabular-nums">
            {Math.round(Math.max(0, Math.min(100, progress)))}%
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={Math.round(Math.max(0, Math.min(100, progress)))}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="bg-brand-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-neutral-500">
          <div>
            {frameCount !== undefined && frameCount > 0 && (
              <span>{t('export.frames', { count: frameCount })}</span>
            )}
          </div>
          {eta && <span>{t('export.eta', { time: eta })}</span>}
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
