/**
 * Unit tests for the trip summary.
 *
 * The numbers here end up in front of someone reviewing a drive, so the tests
 * pin down the two things that are easy to get quietly wrong: integration
 * across telemetry gaps (which would invent distance that was never driven)
 * and the classification of time as moving vs stationary.
 */
import { expect, test } from '@playwright/test';

import { computeTripStats } from '../src/utils/tripStats';
import type { SEIDataPoint } from '../src/utils/types';

function point(
  offsetSeconds: number,
  over: Partial<SEIDataPoint> = {},
): SEIDataPoint {
  return {
    offsetSeconds,
    speedKph: 0,
    gear: 'P',
    steeringAngleDeg: 0,
    brakePct: 0,
    throttlePct: 0,
    apStatus: 'OFF',
    latitude: 0,
    longitude: 0,
    ...over,
  };
}

/** A steady-speed run at 1 Hz, inclusive of both ends. */
function cruise(
  seconds: number,
  speedKph: number,
  over: Partial<SEIDataPoint> = {},
): SEIDataPoint[] {
  return Array.from({ length: seconds + 1 }, (_, i) =>
    point(i, { speedKph, ...over }),
  );
}

test('returns null for an empty series', () => {
  expect(computeTripStats([])).toBeNull();
});

test('integrates distance and moving time at a constant speed', () => {
  const stats = computeTripStats(cruise(60, 60));
  expect(stats).not.toBeNull();
  expect(stats!.distanceKm).toBeCloseTo(1, 6); // 60 km/h for 60 s
  expect(stats!.movingSeconds).toBeCloseTo(60, 6);
  expect(stats!.idleSeconds).toBeCloseTo(0, 6);
  expect(stats!.avgSpeedKph).toBeCloseTo(60, 4);
  expect(stats!.maxSpeedKph).toBeCloseTo(60, 6);
  expect(stats!.spanSeconds).toBeCloseTo(60, 6);
});

test('counts a parked recording as idle, not as distance', () => {
  const stats = computeTripStats(cruise(60, 0));
  expect(stats!.distanceKm).toBe(0);
  expect(stats!.movingSeconds).toBe(0);
  expect(stats!.idleSeconds).toBeCloseTo(60, 6);
  // Too little driving to score — withheld rather than guessed.
  expect(stats!.driveScore).toBeNull();
});

test('does not bridge a telemetry gap larger than the window', () => {
  // Two one-second clusters 10 minutes apart: a car parked in between. The
  // naive implementation integrates straight across and reports ~10 km.
  const data = [
    point(0, { speedKph: 60 }),
    point(1, { speedKph: 60 }),
    point(601, { speedKph: 60 }),
    point(602, { speedKph: 60 }),
  ];
  const stats = computeTripStats(data);
  expect(stats!.distanceKm).toBeCloseTo(2 / 60, 6); // two 1-second intervals
  expect(stats!.movingSeconds).toBeCloseTo(2, 6);
});

test('clamps implausible speeds instead of letting one sample dominate', () => {
  const data = [point(0, { speedKph: 0 }), point(1, { speedKph: 100_000 })];
  const stats = computeTripStats(data);
  // 400 km/h (the clamp) for 1 s, plus the 0 km/h start averaged in.
  expect(stats!.distanceKm).toBeCloseTo(200 / 3600, 6);
  expect(stats!.maxSpeedKph).toBe(400);
});

test('sorts an out-of-order series before integrating', () => {
  const shuffled = [
    point(2, { speedKph: 60 }),
    point(0, { speedKph: 60 }),
    point(1, { speedKph: 60 }),
  ];
  const stats = computeTripStats(shuffled);
  expect(stats!.distanceKm).toBeCloseTo(2 / 60, 6);
  expect(stats!.spanSeconds).toBeCloseTo(2, 6);
});

test('counts gear changes and ignores unknown gear states', () => {
  const data = [
    point(0, { gear: 'P' }),
    point(1, { gear: 'UNKNOWN' }),
    point(2, { gear: 'D' }),
    point(3, { gear: 'D' }),
    point(4, { gear: 'R' }),
  ];
  expect(computeTripStats(data)!.gearChanges).toBe(2); // P→D, D→R
});

test('accumulates autopilot time and distance separately', () => {
  const data = [
    point(0, { speedKph: 72, apStatus: 'OFF' }),
    point(1, { speedKph: 72, apStatus: 'FSD' }),
    point(2, { speedKph: 72, apStatus: 'FSD' }),
    point(3, { speedKph: 72, apStatus: 'OFF' }),
  ];
  const stats = computeTripStats(data)!;
  // The state at a sample holds until the next one, so the two intervals that
  // started while FSD was engaged count — not the one that merely ended in it.
  expect(stats.apSeconds).toBeCloseTo(2, 6);
  expect(stats.apDistanceKm).toBeCloseTo((72 * 2) / 3600, 6);
  expect(stats.distanceKm).toBeCloseTo((72 * 3) / 3600, 6);
});

test('detects hard braking and deducts it from the score', () => {
  const data = [
    ...Array.from({ length: 40 }, (_, i) => point(i, { speedKph: 50 })),
    point(40, { speedKph: 50, brakePct: 90 }),
    point(41, { speedKph: 20, brakePct: 90 }),
    ...Array.from({ length: 20 }, (_, i) => point(42 + i, { speedKph: 20 })),
  ];
  const stats = computeTripStats(data)!;
  expect(stats.hardBrakingCount).toBe(1);
  expect(stats.movingSeconds).toBeGreaterThan(20);
  expect(stats.driveScore).toBe(90); // 100 − one hard brake (10)
});

test('counts sustained harsh steering only while driving', () => {
  const data = [
    // Stopped, wheel at full lock: a parking manoeuvre, not a harsh input.
    point(0, { speedKph: 0, steeringAngleDeg: 200 }),
    point(1, { speedKph: 0, steeringAngleDeg: 200 }),
    // Moving and turning hard — this one counts.
    point(2, { speedKph: 50, steeringAngleDeg: -140 }),
    // Still turning, 1s later: same event, merged.
    point(3, { speedKph: 50, steeringAngleDeg: -150 }),
    // A separate event well after the merge window.
    point(10, { speedKph: 60, steeringAngleDeg: 130 }),
  ];
  const stats = computeTripStats(data)!;
  expect(stats.harshSteeringCount).toBe(2);
  expect(stats.maxSteeringDeg).toBe(200);
});

test('reports wall-clock bounds only when a start time is supplied', () => {
  const start = Date.UTC(2026, 0, 15, 12, 30, 45);
  const withoutBounds = computeTripStats(cruise(10, 40))!;
  expect(withoutBounds.startedAtMs).toBeUndefined();

  const withBounds = computeTripStats(cruise(10, 40), {
    startTimeMs: start,
  })!;
  expect(withBounds.startedAtMs).toBe(start);
  expect(withBounds.endedAtMs).toBe(start + 10_000);
});
