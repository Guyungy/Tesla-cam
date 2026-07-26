import { useCallback, useSyncExternalStore } from 'react';

/** Widest video export. Screenshots always use full quality. */
export const VIDEO_WIDTH_OPTIONS = [3840, 2880, 1920] as const;
export type VideoMaxWidth = (typeof VIDEO_WIDTH_OPTIONS)[number];

export type ExportSettings = {
  showTime: boolean;
  showLocation: boolean;
  showDriveData: boolean;
  /** Prefer a hardware H.264 encoder when the machine has one (much faster) */
  hwAccel: boolean;
  /**
   * Video export width. Matching the screenshot (3840) doubles both file size
   * and encode time versus 2880 — measured at 135 MB / 37 s vs 61 MB / 16 s
   * for the same 24 s clip — so it is worth being able to trade down.
   */
  videoMaxWidth: VideoMaxWidth;
};

const STORAGE_KEY = 'tesla-cam-export-settings';

const DEFAULTS: ExportSettings = {
  showTime: true,
  showLocation: true,
  showDriveData: false,
  hwAccel: true,
  // Defaults to screenshot parity, which is what was asked for; the option
  // exists to trade resolution back for size and encode time.
  videoMaxWidth: 3840,
};

// ── Tiny external store (avoids React context + provider boilerplate) ──
let current: ExportSettings = loadFromStorage();
const listeners = new Set<() => void>();

function loadFromStorage(): ExportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

function persist(next: ExportSettings) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return current;
}

/**
 * Hook: read & write export settings.
 * No provider needed — backed by localStorage + useSyncExternalStore.
 */
export function useExportSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback((patch: Partial<ExportSettings>) => {
    persist({ ...current, ...patch });
  }, []);

  return { exportSettings: settings, setExportSettings: update };
}
