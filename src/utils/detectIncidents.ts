import type { SEIDataPoint } from './types';

/**
 * Detect hard-braking moments from SEI telemetry.
 *
 * A mark is emitted where speed drops sharply within a short window while the
 * brake is applied — the signature of a collision, near-miss, or emergency
 * stop. This is the single most useful navigation aid for incident review:
 * the data is already on disk, it just needs one layer of inference.
 *
 * Tuning:
 * - window ≤ 1.5s, speed drop ≥ 15 km/h → sustained hard deceleration
 * - starting speed ≥ 20 km/h filters parking-crawl noise
 * - marks within 3s merge (one incident spans many samples)
 */
export function detectHardBraking(data: SEIDataPoint[]): number[] {
  if (data.length < 4) return [];

  const WINDOW_S = 1.5;
  const MIN_DROP_KPH = 15;
  const MIN_START_KPH = 20;
  const MERGE_GAP_S = 3;

  const marks: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const start = data[i];
    if (start.speedKph < MIN_START_KPH) continue;

    for (
      let j = i + 1;
      j < data.length &&
      data[j].offsetSeconds - start.offsetSeconds <= WINDOW_S;
      j++
    ) {
      const end = data[j];
      const drop = start.speedKph - end.speedKph;
      if (drop >= MIN_DROP_KPH && (end.brakePct > 0 || start.brakePct > 0)) {
        const at = start.offsetSeconds;
        const prev = marks[marks.length - 1];
        if (prev === undefined || at - prev > MERGE_GAP_S) {
          marks.push(at);
        }
        break;
      }
    }
  }

  return marks;
}
