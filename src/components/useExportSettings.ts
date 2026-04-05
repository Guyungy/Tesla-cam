import { useCallback, useSyncExternalStore } from 'react';

export type ExportSettings = {
  showTime: boolean;
  showLocation: boolean;
  showDriveData: boolean;
};

const STORAGE_KEY = 'tesla-cam-export-settings';

const DEFAULTS: ExportSettings = {
  showTime: true,
  showLocation: true,
  showDriveData: false,
};

// ── Tiny external store (avoids React context + provider boilerplate) ──
let current: ExportSettings = loadFromStorage();
const listeners = new Set<() => void>();

function loadFromStorage(): ExportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function persist(next: ExportSettings) {
  current = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
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
