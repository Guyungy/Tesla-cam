import { VscClose } from 'react-icons/vsc';
import { useI18n } from '../i18n';

type Props = {
  open: boolean;
  progress: number; // 0-100
  onCancel: () => void;
};

export function ExportModal({ open, progress, onCancel }: Props) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel w-96 rounded-xl border border-white/10 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t('export.title')}</h3>
          <button
            onClick={onCancel}
            className="text-neutral-500 transition-colors hover:text-white"
          >
            <VscClose size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="bg-brand-primary h-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-neutral-400">
            <span>{t('export.processing')}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/5"
          >
            {t('export.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
