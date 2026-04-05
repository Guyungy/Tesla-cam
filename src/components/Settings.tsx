import { VscClose } from 'react-icons/vsc';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import clsx from 'clsx';
import { useExportSettings } from './useExportSettings';

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
  const { exportSettings, setExportSettings } = useExportSettings();

  if (!open) return null;

  const toggles: { key: keyof typeof exportSettings; label: string }[] = [
    { key: 'showTime', label: t('settings.exportTime') },
    { key: 'showLocation', label: t('settings.exportLocation') },
    { key: 'showDriveData', label: t('settings.exportDriveData') },
  ];

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

        <div className="flex flex-col gap-5">
          {/* Language */}
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

          {/* Divider */}
          <div className="border-t border-white/5" />

          {/* Export Options */}
          <div>
            <label className="mb-3 block text-sm font-medium text-neutral-400">
              {t('settings.export')}
            </label>
            <div className="flex flex-col gap-2.5">
              {toggles.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-white/10"
                >
                  <span className="text-sm text-neutral-300">{label}</span>
                  <button
                    role="switch"
                    aria-checked={exportSettings[key]}
                    onClick={() => setExportSettings({ [key]: !exportSettings[key] })}
                    className={clsx(
                      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
                      exportSettings[key] ? 'bg-brand-primary' : 'bg-white/15',
                    )}
                  >
                    <span
                      className={clsx(
                        'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
                        exportSettings[key] ? 'translate-x-[18px]' : 'translate-x-[3px]',
                      )}
                    />
                  </button>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
