import clsx from 'clsx';
import { VscClose } from 'react-icons/vsc';

import type { Locale } from '../i18n';
import { useI18n } from '../i18n';
import { useAppSettings } from './useAppSettings';
import { useExportSettings, VIDEO_WIDTH_OPTIONS } from './useExportSettings';

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
  const { appSettings, setAppSettings } = useAppSettings();

  if (!open) return null;

  type BooleanSetting = {
    [K in keyof typeof exportSettings]: (typeof exportSettings)[K] extends boolean
      ? K
      : never;
  }[keyof typeof exportSettings];

  const toggles: { key: BooleanSetting; label: string }[] = [
    { key: 'showTime', label: t('settings.exportTime') },
    { key: 'showLocation', label: t('settings.exportLocation') },
    { key: 'showDriveData', label: t('settings.exportDriveData') },
    { key: 'hwAccel', label: t('settings.exportHwAccel') },
  ];

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel w-80 rounded-xl border border-white/10 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">
            {t('settings.title')}
          </h3>
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

          {/* Playback Options */}
          <div>
            <label className="mb-3 block text-sm font-medium text-neutral-400">
              {t('settings.playback')}
            </label>
            <div className="flex flex-col gap-2.5">
              <ToggleRow
                label={t('settings.autoAdvance')}
                checked={appSettings.autoAdvance}
                onToggle={() =>
                  setAppSettings({ autoAdvance: !appSettings.autoAdvance })
                }
              />
              <ToggleRow
                label={t('settings.autoSeekEvent')}
                checked={appSettings.autoSeekEvent}
                onToggle={() =>
                  setAppSettings({ autoSeekEvent: !appSettings.autoSeekEvent })
                }
              />
              <ToggleRow
                label={t('settings.sentryCameraFocus')}
                checked={appSettings.sentryCameraFocus}
                onToggle={() =>
                  setAppSettings({
                    sentryCameraFocus: !appSettings.sentryCameraFocus,
                  })
                }
              />
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
                <ToggleRow
                  key={key}
                  label={label}
                  checked={exportSettings[key]}
                  onToggle={() =>
                    setExportSettings({ [key]: !exportSettings[key] })
                  }
                />
              ))}

              {/* Video resolution — screenshots always use full quality */}
              <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-neutral-300">
                    {t('settings.exportVideoWidth')}
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    {t('settings.exportVideoWidthHint')}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {VIDEO_WIDTH_OPTIONS.map((w) => (
                    <button
                      key={w}
                      onClick={() => setExportSettings({ videoMaxWidth: w })}
                      className={clsx(
                        'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                        exportSettings.videoMaxWidth === w
                          ? 'bg-brand-primary text-white'
                          : 'bg-white/5 text-neutral-400 hover:bg-white/10',
                      )}
                    >
                      {w === 3840 ? '4K' : `${w}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-white/10">
      <span className="text-sm text-neutral-300">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={clsx(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? 'bg-brand-primary' : 'bg-white/15',
        )}
      >
        <span
          className={clsx(
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </label>
  );
}
