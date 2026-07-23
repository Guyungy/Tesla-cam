import { useState } from 'react';

import { Sidebar } from '../components/Sidebar';
import { TslMark } from '../components/TslMark';
import { Toast } from '../components/Toast';
import { Viewer } from '../components';
import { TitleBar } from '../components/TitleBar';
import {
  type CamClip,
  type CamFootage,
  genFootage,
  revokeFootage,
} from '../utils';
import { useI18n } from '../i18n';

type Props = {
  items: CamClip[];
  lastFolder?: string | null;
  onOpenFolder: () => void;
  onDeleteClip: (clip: CamClip) => void;
};

export function Home({ items, lastFolder, onOpenFolder, onDeleteClip }: Props) {
  const { t } = useI18n();
  const [clip, setClip] = useState<CamClip>();
  const [footage, setFootage] = useState<CamFootage>();
  const [loadProgress, setLoadProgress] = useState<{ current: number; total: number }>();
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const waitForUiRelease = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

  const loadClip = async (item: CamClip) => {
    if (item === clip) return;
    setClip(item);
    revokeFootage(footage);
    setFootage(undefined);
    setLoadProgress({ current: 0, total: item.videos.length });

    const res = await genFootage(item.videos, (current, total) => {
      setLoadProgress({ current, total });
    });
    setLoadProgress(undefined);
    setFootage(res);
  };

  const handleDeleteClip = async (item: CamClip) => {
    if (!window.electronAPI?.trashFiles) return;

    const deletingActiveClip = item === clip;
    if (deletingActiveClip) {
      setClip(undefined);
      revokeFootage(footage);
      setFootage(undefined);
      await waitForUiRelease();
    }

    const result = await window.electronAPI.trashFiles(item.sourcePaths || [], item.name);
    if (!result.ok) {
      if (deletingActiveClip) {
        await loadClip(item);
      }
      return result;
    }

    onDeleteClip(item);

    const remaining = items.filter((current) => current !== item);
    if (remaining.length > 0) {
      const nextClip = remaining[0];
      await loadClip(nextClip);
    } else {
      setClip(undefined);
    }

    setToastMsg(t('toast.clipDeleted'));
    return result;
  };

  return (
    <div className="bg-surface-base flex h-screen w-screen flex-col overflow-hidden text-gray-200">
      <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          items={items}
          activeClip={clip}
          onSelect={loadClip}
          onOpenFolder={onOpenFolder}
        />

        <div className="from-surface-base relative flex flex-1 flex-col overflow-hidden bg-gradient-to-br to-[#111]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/50 to-transparent" />

          {clip ? (
            footage ? (
              <div className="flex h-full min-h-0 w-full flex-col">
                <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center p-4 delay-100">
                  <Viewer
                    key={clip.name}
                    clip={clip}
                    footage={footage}
                    onFootageUpdate={setFootage}
                    onDelete={handleDeleteClip}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="border-brand-primary h-12 w-12 animate-spin rounded-full border-2 border-t-transparent" />
                  <span className="text-sm font-medium tracking-wider text-neutral-400">
                    {loadProgress
                      ? t('home.loadingProgress', {
                          current: loadProgress.current,
                          total: loadProgress.total,
                        })
                      : t('home.loading')}
                  </span>
                  {loadProgress && loadProgress.total > 0 && (
                    <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="bg-brand-primary h-full transition-all duration-200"
                        style={{ width: `${(loadProgress.current / loadProgress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-neutral-600 select-none">
              <div className="flex flex-col items-center gap-4">
                <TslMark size="lg" />
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="text-xs font-semibold tracking-[0.45em] text-brand-primary/80 uppercase">
                    TSL
                  </div>
                  <div className="text-lg font-light tracking-[0.25em] uppercase opacity-70">
                    {t('home.selectClip')}
                  </div>
                  <div className="max-w-md text-sm text-neutral-500">
                    Tesla cinema workspace for synchronized camera review and export.
                  </div>
                </div>
              </div>
              {lastFolder && items.length === 0 && (
                <button
                  onClick={onOpenFolder}
                  className="mt-2 flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 text-neutral-500 transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-neutral-300"
                >
                  <span className="text-xs uppercase tracking-wider">{t('sidebar.selectFolder')}</span>
                  <span className="text-[10px] text-neutral-600">{lastFolder}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
