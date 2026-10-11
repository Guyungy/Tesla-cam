import type { CamClip, CamClipEvent } from './types';

/** Treat sidecar metadata as untrusted input, including valid non-object JSON. */
export function parseEvent(value: unknown): CamClipEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const text = (key: string) => typeof input[key] === 'string' ? (input[key] as string).slice(0, 4096) : '';
  const coord = (key: string, limit: number) => {
    const raw = input[key];
    if (typeof raw !== 'number' && typeof raw !== 'string') return '';
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? String(raw) : '';
  };
  return { timestamp: text('timestamp'), city: text('city'), street: text('street'),
    est_lat: coord('est_lat', 90), est_lon: coord('est_lon', 180), reason: text('reason'), camera: text('camera') };
}

export function readEvent(file: File): Promise<CamClip['event']> {
  if (file.size > 1024 * 1024) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(parseEvent(JSON.parse(reader.result as string))); }
      catch { resolve(undefined); }
    };
    reader.onerror = reader.onabort = () => resolve(undefined);
    reader.readAsText(file);
  });
}
