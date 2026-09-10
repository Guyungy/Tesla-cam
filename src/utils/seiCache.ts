import { createLruMap } from './lruMap';
import type { CamClip, SEIDataPoint } from './types';

/**
 * Cache for extracted SEI telemetry.
 *
 * Decoding a clip means walking the NAL units of every front-camera segment,
 * which for a full-hour Sentry event is tens of megabytes of I/O and real CPU
 * time on two workers. The result is deterministic for a given set of files,
 * yet it was thrown away on every clip switch — so triaging a folder meant
 * paying for the same clip again each time you came back to it, and paying
 * again after every restart.
 *
 * Two layers:
 * - an in-memory LRU, so revisiting a clip in one session is instant;
 * - a disk cache in the main process (`userData/sei-cache`), so it survives a
 *   restart. Writes are fire-and-forget: a cache miss costs time, but a cache
 *   failure must never cost correctness.
 */

/** How many clips stay decoded in memory. Each entry is a few hundred KB. */
const MEMORY_ENTRIES = 8;

const memory = createLruMap<string, SEIDataPoint[]>(MEMORY_ENTRIES);

const GEARS = new Set(['P', 'R', 'N', 'D', 'UNKNOWN']);
const AP_STATUSES = new Set(['OFF', 'STANDBY', 'AP', 'FSD', 'UNKNOWN']);

const NUMERIC_FIELDS = [
  'offsetSeconds',
  'speedKph',
  'steeringAngleDeg',
  'brakePct',
  'throttlePct',
  'latitude',
  'longitude',
] as const;

/**
 * Cache key for a clip: its name plus the identity of every file that feeds
 * the extraction (name, byte size, mtime). Re-encoding a clip or replacing the
 * drive changes the key; re-opening the same untouched clip does not.
 */
export function footageCacheKey(
  clip: Pick<CamClip, 'name' | 'videos'>,
): string {
  const parts = clip.videos
    .map((video) => `${video.name}:${video.size}:${video.lastModified}`)
    .sort();
  return `${clip.name}|${parts.join(',')}`;
}

/**
 * Structural check on anything coming back from disk. A stale or truncated
 * cache file must degrade to "no cache", never to a dashboard built from
 * half-parsed numbers.
 */
export function isValidSeiSeries(value: unknown): value is SEIDataPoint[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!item || typeof item !== 'object') return false;
    const point = item as Record<string, unknown>;
    for (const field of NUMERIC_FIELDS) {
      const v = point[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    }
    if (typeof point.gear !== 'string' || !GEARS.has(point.gear)) return false;
    if (typeof point.apStatus !== 'string' || !AP_STATUSES.has(point.apStatus))
      return false;
  }
  return true;
}

function electronApi() {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
}

/** In-memory hit only — never touches disk or IPC. */
export function peekCachedSei(key: string): SEIDataPoint[] | undefined {
  return memory.get(key);
}

export async function readCachedSei(
  key: string,
): Promise<SEIDataPoint[] | undefined> {
  const inMemory = memory.get(key);
  if (inMemory) return inMemory;

  const api = electronApi();
  if (!api?.seiCacheRead) return undefined;

  try {
    const stored = await api.seiCacheRead(key);
    if (!isValidSeiSeries(stored)) return undefined;
    memory.set(key, stored);
    return stored;
  } catch {
    return undefined;
  }
}

/** Remember a freshly extracted series in memory and, best-effort, on disk. */
export function writeCachedSei(key: string, points: SEIDataPoint[]): void {
  memory.set(key, points);

  const api = electronApi();
  if (!api?.seiCacheWrite) return;

  // Deliberately not awaited: the caller has telemetry to render, and a failed
  // cache write is not worth surfacing to the user.
  void Promise.resolve(api.seiCacheWrite(key, points)).catch(() => {});
}

export async function deleteCachedSei(key: string): Promise<void> {
  memory.delete(key);
  const api = electronApi();
  if (!api?.seiCacheDelete) return;
  try {
    await api.seiCacheDelete(key);
  } catch {
    /* best effort */
  }
}

export async function clearSeiCache(): Promise<void> {
  memory.clear();
  const api = electronApi();
  if (!api?.seiCacheClear) return;
  try {
    await api.seiCacheClear();
  } catch {
    /* best effort */
  }
}
