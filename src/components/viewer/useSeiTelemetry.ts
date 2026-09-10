import { useCallback, useEffect, useMemo } from 'react';

import type { CamClip, CamFootage, SEIDataPoint } from '../../utils';
import {
  detectHardBraking,
  extractFootageSEI,
  shareInflight,
} from '../../utils';

/**
 * Extractions currently running, keyed by clip name, so repeated effect runs
 * for the same clip attach to one parse instead of starting or blocking each
 * other. Module scope: it must outlive an effect cleanup/setup cycle.
 */
const inflightSei = new Map<string, Promise<SEIDataPoint[] | undefined>>();

type Params = {
  clip: CamClip;
  footage: CamFootage;
  /** Callback to update footage with SEI data once loaded */
  onFootageUpdate?: (footage: CamFootage) => void;
  /** Current playhead position in clip seconds */
  clipPlayedSeconds: number;
};

/**
 * SEI telemetry for a clip: lazy background extraction, the current sample
 * at the playhead (with staleness handling), and pre-sampled drive-text
 * windows for the compose export overlay.
 */
export function useSeiTelemetry({
  clip,
  footage,
  onFootageUpdate,
  clipPlayedSeconds,
}: Params) {
  // ── Lazy SEI metadata extraction (runs once per clip, off-thread) ──
  useEffect(() => {
    if (footage.seiData) return; // Already loaded
    const clipName = clip.name;

    // Share the in-flight extraction by clip rather than latching a boolean.
    // StrictMode runs effects twice in development: the first pass' cleanup
    // discarded its own result, and the old boolean guard was never reset, so
    // the second pass returned early and telemetry stayed blank forever.
    // Reusing the promise makes the second pass adopt the first pass' work
    // instead of re-parsing several hundred MB.
    const task = shareInflight(inflightSei, clipName, () => {
      console.log(
        '[SEI] Starting metadata extraction for',
        clip.videos.length,
        'video files...',
      );
      return extractFootageSEI(clip.videos, footage);
    });

    // Still drop the result on a real unmount — delivering it would push a
    // previous clip's footage back into a viewer that has moved on.
    let cancelled = false;
    task
      .then((seiData) => {
        if (cancelled) return;
        if (seiData?.length) {
          console.log('[SEI] Found', seiData.length, 'data points');
          onFootageUpdate?.({ ...footage, seiData });
        } else {
          console.log(
            '[SEI] No telemetry in this clip (parked or pre-2025.44)',
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[SEI] Extraction failed:', e);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.name]); // Only run once per clip

  // ── Series (real data only — never invent speed/gear) ──
  const seiSeries = useMemo<SEIDataPoint[]>(
    () =>
      footage.seiData && footage.seiData.length > 0 ? footage.seiData : [],
    [footage.seiData],
  );
  const hasRealMetadata = seiSeries.length > 0;

  const currentSEI: SEIDataPoint | null = useMemo(() => {
    if (seiSeries.length === 0) return null;
    // Nearest sample at/before playhead; if playhead is before first sample,
    // use first. Do not hold the last driving sample across a long parked
    // gap: if the gap since the last sample > 2s, clear motion metrics.
    const target = clipPlayedSeconds;
    const data = seiSeries;
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (data[mid].offsetSeconds <= target) lo = mid;
      else hi = mid - 1;
    }
    const sample = data[lo];
    if (!sample) return null;
    if (sample.offsetSeconds > target) {
      // playhead before any sample
      return target + 0.5 < sample.offsetSeconds ? null : sample;
    }
    const age = target - sample.offsetSeconds;
    if (age > 2.0) {
      // Stale: keep GPS/gear context but force stopped speed/pedals
      return {
        ...sample,
        offsetSeconds: target,
        speedKph: sample.gear === 'P' || age > 5 ? 0 : sample.speedKph,
        throttlePct: age > 5 ? 0 : sample.throttlePct,
        brakePct: age > 5 ? 0 : sample.brakePct,
      };
    }
    return sample;
  }, [seiSeries, clipPlayedSeconds]);

  /**
   * Pre-sample SEI telemetry into merged text windows for the compose
   * overlay. Times are relative to export start. Consecutive identical texts
   * merge; step widens for long exports so the window count stays bounded.
   */
  const buildDriveWindows = useCallback(
    (rangeStart: number, rangeDuration: number) => {
      if (seiSeries.length === 0) return [];
      const MAX_WINDOWS = 240;
      const step = Math.max(1, rangeDuration / MAX_WINDOWS);
      const windows: { start: number; end: number; text: string }[] = [];

      const sampleAt = (target: number): SEIDataPoint | null => {
        let lo = 0;
        let hi = seiSeries.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (seiSeries[mid].offsetSeconds <= target) lo = mid;
          else hi = mid - 1;
        }
        const s = seiSeries[lo];
        if (!s) return null;
        // Same staleness rule as the live dashboard: don't show old samples
        if (s.offsetSeconds > target + 0.5 || target - s.offsetSeconds > 2)
          return null;
        return s;
      };

      for (let t0 = 0; t0 < rangeDuration; t0 += step) {
        const sample = sampleAt(rangeStart + t0);
        if (!sample) continue;
        const text = `${Math.round(sample.speedKph)} km/h  ${sample.gear}  ${sample.apStatus}`;
        const end = Math.min(t0 + step, rangeDuration);
        const prev = windows[windows.length - 1];
        if (prev && prev.text === text && Math.abs(prev.end - t0) < 0.01) {
          prev.end = end;
        } else {
          windows.push({ start: t0, end, text });
        }
      }
      return windows;
    },
    [seiSeries],
  );

  // Hard-braking incident marks for the timeline (derived once per series)
  const incidentMarks = useMemo(
    () => detectHardBraking(seiSeries),
    [seiSeries],
  );

  return {
    seiSeries,
    hasRealMetadata,
    currentSEI,
    buildDriveWindows,
    incidentMarks,
  };
}
