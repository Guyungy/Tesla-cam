import { detectHardBraking } from './detectIncidents';
import type { GearState, SEIDataPoint } from './types';

/**
 * Aggregate a clip's SEI series into a trip summary.
 *
 * Every number here is already on disk — speed, gear, pedals, autopilot state
 * and GPS all arrive in the telemetry — so this module is pure arithmetic over
 * data the viewer has already decoded. Nothing is inferred from the video.
 *
 * Two rules keep the numbers honest:
 * - Samples are integrated with the trapezoid rule, and a gap longer than
 *   {@link MAX_GAP_S} is skipped rather than bridged. Telemetry stops while the
 *   car is parked, so bridging a gap would invent distance that was never
 *   driven.
 * - Speeds are clamped to a physically plausible range before integration, so
 *   one corrupt sample cannot dominate the distance.
 */

/** Ignore inter-sample gaps longer than this (parked / telemetry dropout). */
const MAX_GAP_S = 2;
/** Below this speed the car counts as stationary, not driving. */
const MOVING_KPH = 3;
/** Implausible speeds are clamped rather than dropped, to keep time accounted. */
const MAX_KPH = 400;
/** Steering at/above this while moving counts as a harsh input. */
const HARSH_STEER_DEG = 120;
/** Harsh steering only counts above this speed (parking manoeuvres excluded). */
const HARSH_STEER_MIN_KPH = 40;
/** Harsh-steering marks within this window merge into one. */
const HARSH_STEER_MERGE_S = 3;
/** Below this much driving the score is withheld rather than guessed. */
const MIN_MOVING_SECONDS_FOR_SCORE = 20;
/** Score deductions — deliberately blunt, and shown as a breakdown in the UI. */
const PENALTY_PER_HARD_BRAKE = 10;
const PENALTY_PER_HARSH_STEER = 4;

export type TripStats = {
  /** Telemetry time span in seconds (last sample − first sample). */
  spanSeconds: number;
  /** Seconds the car was actually moving. */
  movingSeconds: number;
  /** Seconds recording while stationary. */
  idleSeconds: number;
  /** Integrated distance in km. */
  distanceKm: number;
  /** Mean speed over moving time, km/h. */
  avgSpeedKph: number;
  /** Highest sample, km/h. */
  maxSpeedKph: number;
  /** Hard-braking marks — the same detector the timeline uses. */
  hardBrakingCount: number;
  /** Sustained high-angle steering inputs while moving. */
  harshSteeringCount: number;
  /** Peak absolute steering angle, degrees. */
  maxSteeringDeg: number;
  /** Seconds spent under Autopilot / FSD. */
  apSeconds: number;
  /** Distance covered under Autopilot / FSD, km. */
  apDistanceKm: number;
  /** Gear selector changes (P→D, D→R …), ignoring the first known gear. */
  gearChanges: number;
  /**
   * Heuristic 0–100 safety score: 100 minus the penalties above. `null` when
   * there is too little driving in the clip to judge.
   */
  driveScore: number | null;
  /** Absolute wall-clock bounds, only when the caller supplied a start time. */
  startedAtMs?: number;
  endedAtMs?: number;
};

export type TripStatsOptions = {
  /** Wall-clock (epoch ms) of the first telemetry sample. */
  startTimeMs?: number;
};

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isApEngaged(point: SEIDataPoint): boolean {
  return point.apStatus === 'AP' || point.apStatus === 'FSD';
}

/** Sustained high-angle steering while driving, merged into distinct events. */
function countHarshSteering(data: SEIDataPoint[]): number {
  let count = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const point of data) {
    if (num(point.speedKph) < HARSH_STEER_MIN_KPH) continue;
    if (Math.abs(num(point.steeringAngleDeg)) < HARSH_STEER_DEG) continue;
    if (point.offsetSeconds - lastAt > HARSH_STEER_MERGE_S) count++;
    lastAt = point.offsetSeconds;
  }
  return count;
}

export function computeTripStats(
  data: SEIDataPoint[],
  options: TripStatsOptions = {},
): TripStats | null {
  if (data.length === 0) return null;

  const sorted = [...data].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let distanceKm = 0;
  let apDistanceKm = 0;
  let movingSeconds = 0;
  let idleSeconds = 0;
  let apSeconds = 0;
  let maxSpeedKph = 0;
  let maxSteeringDeg = 0;
  let gearChanges = 0;
  let previousGear: GearState | undefined;

  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    const speed = Math.min(MAX_KPH, Math.max(0, num(point.speedKph)));
    if (speed > maxSpeedKph) maxSpeedKph = speed;
    const steer = Math.abs(num(point.steeringAngleDeg));
    if (steer > maxSteeringDeg) maxSteeringDeg = steer;

    if (point.gear !== 'UNKNOWN') {
      if (previousGear !== undefined && point.gear !== previousGear) {
        gearChanges++;
      }
      previousGear = point.gear;
    }

    if (i === 0) continue;

    const previous = sorted[i - 1];
    const dt = point.offsetSeconds - previous.offsetSeconds;
    if (!(dt > 0) || dt > MAX_GAP_S) continue;

    const previousSpeed = Math.min(
      MAX_KPH,
      Math.max(0, num(previous.speedKph)),
    );
    const avg = (speed + previousSpeed) / 2;

    distanceKm += (avg * dt) / 3600;
    if (avg >= MOVING_KPH) movingSeconds += dt;
    else idleSeconds += dt;

    if (isApEngaged(previous)) {
      // Telemetry is a step function: the state read at a sample holds until
      // the next one. Counting "either end engaged" instead would charge the
      // interval that *precedes* engagement to Autopilot as well.
      apSeconds += dt;
      apDistanceKm += (avg * dt) / 3600;
    }
  }

  const hardBrakingCount = detectHardBraking(sorted).length;
  const harshSteeringCount = countHarshSteering(sorted);
  const avgSpeedKph =
    movingSeconds > 0 ? (distanceKm / movingSeconds) * 3600 : 0;

  const driveScore =
    movingSeconds >= MIN_MOVING_SECONDS_FOR_SCORE
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              100 -
                hardBrakingCount * PENALTY_PER_HARD_BRAKE -
                harshSteeringCount * PENALTY_PER_HARSH_STEER,
            ),
          ),
        )
      : null;

  const stats: TripStats = {
    spanSeconds: Math.max(0, last.offsetSeconds - first.offsetSeconds),
    movingSeconds,
    idleSeconds,
    distanceKm,
    avgSpeedKph,
    maxSpeedKph,
    hardBrakingCount,
    harshSteeringCount,
    maxSteeringDeg,
    apSeconds,
    apDistanceKm,
    gearChanges,
    driveScore,
  };

  const { startTimeMs } = options;
  if (typeof startTimeMs === 'number' && Number.isFinite(startTimeMs)) {
    stats.startedAtMs = startTimeMs + first.offsetSeconds * 1000;
    stats.endedAtMs = startTimeMs + last.offsetSeconds * 1000;
  }

  return stats;
}
