import { useCallback, useSyncExternalStore } from 'react';

import type { ViewType } from '../utils';

export type AppSettings = {
  /** Automatically play the next clip when the current one ends */
  autoAdvance: boolean;
  /** Last layout the user picked — restored for new clips when available */
  preferredView: ViewType | null;
  /** Jump to just before the recorded event when opening an event clip */
  autoSeekEvent: boolean;
  /** Open Sentry clips focused on the camera that triggered the event */
  sentryCameraFocus: boolean;
};

const STORAGE_KEY = 'tesla-cam-app-settings';

const DEFAULTS: AppSettings = {
  autoAdvance: true,
  preferredView: null,
  autoSeekEvent: true,
  sentryCameraFocus: true,
};

// ── Tiny external store (same pattern as useExportSettings) ──
let current: AppSettings = loadFromStorage();
const listeners = new Set<() => void>();

function loadFromStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

function persist(next: AppSettings) {
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
 * Hook: read & write app-level playback/UI settings.
 * No provider needed — backed by localStorage + useSyncExternalStore.
 */
export function useAppSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback((patch: Partial<AppSettings>) => {
    persist({ ...current, ...patch });
  }, []);

  return { appSettings: settings, setAppSettings: update };
}
