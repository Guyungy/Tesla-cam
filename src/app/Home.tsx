import { useCallback, useEffect, useRef, useState } from 'react';

import { Viewer } from '../components';
import { Dashboard } from '../components/Dashboard';
import { Sidebar } from '../components/Sidebar';
import { TitleBar } from '../components/TitleBar';
import { Toast } from '../components/Toast';
import { TslMark } from '../components/TslMark';
import { useAppSettings } from '../components/useAppSettings';
import { WheelScan } from '../components/WheelScan';
import { useI18n } from '../i18n';
import {
  type CamClip,
  clipIdentity,
  deleteCachedSei,
  type DeleteResult,
  deleteResultToast,
  footageCacheKey,
  genFootage,
  reconcileDeletedClip,
  revokeFootage,
} from '../utils';
import { type ClipSelection, createClipLoader } from '../utils/clipLoader';

type Props = {
  items: CamClip[];
  lastFolder?: string | null;
  onOpenFolder: () => void;
  onDeleteClip: (clip: CamClip, replacement?: CamClip) => void;
  onBusyChange: (busy: boolean) => void;
};

export function Home({
  items,
  lastFolder,
  onOpenFolder,
  onDeleteClip,
  onBusyChange,
}: Props) {
  const { t, locale } = useI18n();
  const { appSettings } = useAppSettings();
  const [selection, setSelection] = useState<ClipSelection>({ revision: 0 });
  const loaderRef = useRef<ReturnType<typeof createClipLoader> | null>(null);
  if (!loaderRef.current)
    loaderRef.current = createClipLoader({
      generate: genFootage,
      release: revokeFootage,
      change: setSelection,
    });
  const loader = loaderRef.current;
  const { clip, footage, progress: loadProgress, revision } = selection;
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [reviewSeek, setReviewSeek] = useState<{
    clipName: string;
    seconds: number;
    nonce: number;
  }>();
  const deletingRef = useRef(false);
  const exportingRef = useRef(false);
  const mountedRef = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const visibleRef = useRef(items);
  const handleVisibleItems = useCallback((visible: CamClip[]) => {
    visibleRef.current = visible;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loader.dispose();
      onBusyChange(false);
    };
  }, [loader, onBusyChange]);
  useEffect(() => {
    if (selection.error) setToastMsg(t('toast.loadFailed'));
  }, [selection.error, t]);

  const loadClip = useCallback(
    async (item: CamClip) => {
      if (deletingRef.current || exportingRef.current) return;
      await loader.select(item);
    },
    [loader],
  );
  const reviewWheelCandidate = useCallback(
    async (item: CamClip, seconds: number) => {
      setReviewSeek({ clipName: item.name, seconds, nonce: Date.now() });
      await loadClip(item);
    },
    [loadClip],
  );
  const selectRelativeClip = useCallback(
    (offset: number) => {
      const list = visibleRef.current;
      const current = loader.current().clip;
      const idx = current ? list.indexOf(current) : -1;
      const next = current ? list[idx + offset] : list[0];
      if (next && (!current || idx >= 0)) void loadClip(next);
    },
    [loader, loadClip],
  );

  const handleDeleteClip = async (
    item: CamClip,
  ): Promise<DeleteResult | undefined> => {
    const api = window.electronAPI;
    if (!api?.trashFiles || deletingRef.current || exportingRef.current) return;
    if (!itemsRef.current.includes(item)) return;
    deletingRef.current = true;
    onBusyChange(true);
    const previous = loader.current().clip;
    const active = previous === item;
    const visibleBefore = visibleRef.current;
    const index = visibleBefore.indexOf(item);
    if (active) {
      loader.reset();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }
    try {
      const result = await api.trashFiles(
        item.sourcePaths || [],
        item.name,
        locale,
      );
      if (!mountedRef.current) return result;
      if (!result.ok || !result.removedPaths?.length) {
        if (active) await loader.select(item, true);
        if (!result.canceled)
          setToastMsg(
            t('toast.deleteFailed', {
              error: result.error || t('toast.deleteNoChanges'),
            }),
          );
        return result;
      }
      const replacement = reconcileDeletedClip(item, result.removedPaths);
      onDeleteClip(item, replacement);
      void deleteCachedSei(footageCacheKey(item));
      if (active) {
        if (replacement) await loader.select(replacement, true);
        else {
          const remaining = visibleBefore.filter(
            (c) => c !== item && itemsRef.current.includes(c),
          );
          const next =
            remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
          if (next) await loader.select(next, true);
        }
      }
      const toast = deleteResultToast(result);
      setToastMsg(t(toast.key, toast.params));
      return result;
    } catch (error) {
      const result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      if (mountedRef.current) {
        if (active) await loader.select(item, true);
        setToastMsg(t('toast.deleteFailed', { error: result.error }));
      }
      return result;
    } finally {
      deletingRef.current = false;
      if (mountedRef.current) onBusyChange(exportingRef.current);
    }
  };
  const deleteClipRef = useRef(handleDeleteClip);
  deleteClipRef.current = handleDeleteClip;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        deletingRef.current ||
        exportingRef.current ||
        event.defaultPrevented ||
        target?.closest(
          'input, textarea, select, button, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        selectRelativeClip(event.code === 'ArrowUp' ? -1 : 1);
      } else if (event.code === 'Delete') {
        event.preventDefault();
        const current = loader.current().clip;
        if (current) void deleteClipRef.current(current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loader, selectRelativeClip]);
  const handleClipEnded = useCallback(() => {
    if (appSettings.autoAdvance) selectRelativeClip(1);
  }, [appSettings.autoAdvance, selectRelativeClip]);
  const openFolder = () => {
    if (!deletingRef.current && !exportingRef.current) onOpenFolder();
  };
  const handleExportingChange = useCallback(
    (busy: boolean) => {
      exportingRef.current = busy;
      onBusyChange(busy || deletingRef.current);
    },
    [onBusyChange],
  );

  return (
    <div className="bg-surface-base flex h-screen w-screen flex-col overflow-hidden text-gray-200">
      <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          items={items}
          activeClip={clip}
          onSelect={loadClip}
          onOpenFolder={openFolder}
          onVisibleItemsChange={handleVisibleItems}
        />
        <div className="from-surface-base relative flex flex-1 flex-col overflow-hidden bg-gradient-to-br to-[#111]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/50 to-transparent" />
          <WheelScan items={items} onReview={reviewWheelCandidate} />
          {clip ? (
            footage ? (
              <div className="flex h-full min-h-0 w-full flex-col">
                <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center p-4 delay-100">
                  <Viewer
                    key={`${clipIdentity(clip)}:${revision}:${reviewSeek?.clipName === clip.name ? reviewSeek.nonce : 0}`}
                    clip={clip}
                    footage={footage}
                    initialSeekSeconds={
                      reviewSeek?.clipName === clip.name
                        ? reviewSeek.seconds
                        : undefined
                    }
                    onFootageUpdate={(next) =>
                      loader.update(clip, revision, next)
                    }
                    onDelete={handleDeleteClip}
                    onExportingChange={handleExportingChange}
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
                    onClick={openFolder}
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
