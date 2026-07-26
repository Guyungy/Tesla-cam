import { useCallback, useEffect, useRef, useState } from 'react';

import { Viewer } from '../components';
import { Dashboard } from '../components/Dashboard';
import { Sidebar } from '../components/Sidebar';
import { TitleBar } from '../components/TitleBar';
import { Toast } from '../components/Toast';
import { TslMark } from '../components/TslMark';
import { useAppSettings } from '../components/useAppSettings';
import { useI18n } from '../i18n';
import {
  type CamClip,
  type CamFootage,
  deleteResultToast,
  genFootage,
  revokeFootage,
} from '../utils';

type Props = {
  items: CamClip[];
  lastFolder?: string | null;
  onOpenFolder: () => void;
  onDeleteClip: (clip: CamClip) => void;
};

export function Home({ items, lastFolder, onOpenFolder, onDeleteClip }: Props) {
  const { t } = useI18n();
  const { appSettings } = useAppSettings();
  const [clip, setClip] = useState<CamClip>();
  const [footage, setFootage] = useState<CamFootage>();
  const [loadProgress, setLoadProgress] = useState<{
    current: number;
    total: number;
  }>();
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

  // Keep latest values in refs so global handlers stay stable
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const loadClipRef = useRef(loadClip);
  loadClipRef.current = loadClip;
  const deletingRef = useRef(false);

  /** Select the clip `offset` positions away in sidebar order (newest first). */
  const selectRelativeClip = useCallback((offset: number) => {
    const list = itemsRef.current;
    if (list.length === 0) return;
    const cur = clipRef.current;
    if (!cur) {
      loadClipRef.current(list[0]);
      return;
    }
    const idx = list.indexOf(cur);
    if (idx < 0) return;
    const next = list[idx + offset];
    if (next) loadClipRef.current(next);
  }, []);

  // ── Keyboard: ↑/↓ navigate clips; Delete = triage flow (delete + next) ──
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      if (event.code === 'ArrowUp') {
        event.preventDefault();
        selectRelativeClip(-1);
      } else if (event.code === 'ArrowDown') {
        event.preventDefault();
        selectRelativeClip(1);
      } else if (event.code === 'Delete') {
        // Confirmation still happens in the native dialog; deletion then
        // auto-selects the next clip, so triage is a pure keyboard loop.
        event.preventDefault();
        const cur = clipRef.current;
        if (!cur || deletingRef.current) return;
        deletingRef.current = true;
        deleteClipRef.current(cur)?.finally(() => {
          deletingRef.current = false;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectRelativeClip]);

  // ── Auto-advance to the next clip when the current one ends ──
  const handleClipEnded = useCallback(() => {
    if (!appSettings.autoAdvance) return;
    selectRelativeClip(1);
  }, [appSettings.autoAdvance, selectRelativeClip]);

  const handleDeleteClip = async (item: CamClip) => {
    if (!window.electronAPI?.trashFiles) return;

    const deletingActiveClip = item === clip;
    if (deletingActiveClip) {
      setClip(undefined);
      revokeFootage(footage);
      setFootage(undefined);
      await waitForUiRelease();
    }

    const result = await window.electronAPI.trashFiles(
      item.sourcePaths || [],
      item.name,
    );
    if (!result.ok) {
      if (deletingActiveClip) {
        await loadClip(item);
      }
      return result;
    }

    const deletedIndex = items.indexOf(item);
    onDeleteClip(item);

    // Select the clip that took the deleted one's place (i.e. the next one
    // in sidebar order) — this is what makes keyboard triage flow.
    const remaining = items.filter((current) => current !== item);
    if (remaining.length > 0) {
      const nextClip =
        remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)];
      await loadClip(nextClip);
    } else {
      setClip(undefined);
    }

    const toast = deleteResultToast(result);
    setToastMsg(t(toast.key, toast.params));
    return result;
  };

  const deleteClipRef = useRef(handleDeleteClip);
  deleteClipRef.current = handleDeleteClip;

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
                    onClipEnded={handleClipEnded}
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
                        style={{
                          width: `${(loadProgress.current / loadProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="relative flex flex-1 flex-col text-neutral-600 select-none">
              <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
                <div className="flex flex-col items-center gap-4">
                  <TslMark size="lg" />
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="text-brand-primary/80 text-xs font-semibold tracking-[0.45em] uppercase">
                      TSL
                    </div>
                    <div className="text-lg font-light tracking-[0.25em] uppercase opacity-70">
                      {t('home.selectClip')}
                    </div>
                    <div className="max-w-md text-sm text-neutral-500">
                      Tesla cinema workspace for synchronized camera review and
                      export.
                    </div>
                  </div>
                </div>
                {lastFolder && items.length === 0 && (
                  <button
                    onClick={onOpenFolder}
                    className="mt-2 flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 text-neutral-500 transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-neutral-300"
                  >
                    <span className="text-xs tracking-wider uppercase">
                      {t('sidebar.selectFolder')}
                    </span>
                    <span className="text-[10px] text-neutral-600">
                      {lastFolder}
                    </span>
                  </button>
                )}
              </div>
              <div className="px-4 pt-2 pb-4">
                <Dashboard
                  data={null}
                  hasMetadata={false}
                  timeText="--"
                  locationText="—"
                  variant="bar"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
