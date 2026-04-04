import { VscClose } from 'react-icons/vsc';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import clsx from 'clsx';

type Props = {
  open: boolean;
  onClose: () => void;
};

const LANGUAGE_OPTIONS: { id: Locale; label: string; flag: string }[] = [
  { id: 'zh-CN', label: '中文', flag: '🇨🇳' },
  { id: 'en', label: 'English', flag: '🇺🇸' },
];

export function Settings({ open, onClose }: Props) {
  const { locale, setLocale, t } = useI18n();

  if (!open) return null;

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel w-80 rounded-xl border border-white/10 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t('settings.title')}</h3>
          <button
            onClick={onClose}
            className="text-neutral-500 transition-colors hover:text-white"
          >
            <VscClose size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-400">
              {t('settings.language')}
            </label>
            <div className="flex gap-2">
              {LANGUAGE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setLocale(opt.id)}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all',
                    locale === opt.id
                      ? 'border-brand-primary bg-brand-primary/10 text-white'
                      : 'border-white/10 bg-white/5 text-neutral-400 hover:border-white/20 hover:text-neutral-200',
                  )}
                >
                  <span>{opt.flag}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
