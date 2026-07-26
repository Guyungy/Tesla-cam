/**
 * Unit tests for hard-braking incident detection.
 */
import { expect, test } from '@playwright/test';

import { detectHardBraking } from '../src/utils/detectIncidents';
import type { SEIDataPoint } from '../src/utils/types';

function pt(
  offsetSeconds: number,
  speedKph: number,
  brakePct = 0,
): SEIDataPoint {
  return {
    offsetSeconds,
    speedKph,
    brakePct,
    gear: 'D',
    steeringAngleDeg: 0,
    throttlePct: 0,
    apStatus: 'OFF',
    latitude: 0,
    longitude: 0,
  };
}

/** Constant-speed cruise at `kph`, 10 samples/s. */
function cruise(from: number, to: number, kph: number): SEIDataPoint[] {
  const out: SEIDataPoint[] = [];
  for (let t = from; t < to; t += 0.1) out.push(pt(t, kph));
  return out;
}

test('detects an emergency stop', () => {
  // 60 km/h cruise, then braking to 5 km/h within ~1.2s
  const data = [
    ...cruise(0, 5, 60),
    pt(5.0, 60, 100),
    pt(5.3, 45, 100),
    pt(5.6, 30, 100),
    pt(5.9, 15, 100),
    pt(6.2, 5, 100),
    ...cruise(6.3, 10, 5),
  ];
  const marks = detectHardBraking(data);
  expect(marks.length).toBe(1);
  // The mark may land up to one window (1.5s) before the brake point —
  // a natural pre-roll for review.
  expect(marks[0]).toBeGreaterThanOrEqual(3.4);
  expect(marks[0]).toBeLessThanOrEqual(5.5);
});

test('ignores gentle deceleration', () => {
  // 60 → 0 km/h over 12 seconds (5 km/h per second, normal stop)
  const data: SEIDataPoint[] = [];
  for (let t = 0; t < 12; t += 0.1) {
    data.push(pt(t, Math.max(0, 60 - t * 5), 30));
  }
  expect(detectHardBraking(data)).toEqual([]);
});

test('ignores sharp drops without brake input (sensor noise)', () => {
  const data = [
    ...cruise(0, 3, 60),
    pt(3.0, 60, 0),
    pt(3.2, 20, 0), // implausible drop, no brake — noise
    ...cruise(3.3, 6, 60),
  ];
  expect(detectHardBraking(data)).toEqual([]);
});

test('ignores parking-speed jitter', () => {
  const data = [
    ...cruise(0, 2, 8),
    pt(2.0, 8, 100),
    pt(2.3, 0, 100),
    ...cruise(2.4, 5, 0),
  ];
  expect(detectHardBraking(data)).toEqual([]);
});

test('merges one incident into one mark', () => {
  // Long braking event: every sample pair within it qualifies
  const data: SEIDataPoint[] = [...cruise(0, 3, 90)];
  for (let t = 3; t < 5.5; t += 0.1) {
    data.push(pt(t, Math.max(5, 90 - (t - 3) * 35), 100));
  }
  const marks = detectHardBraking(data);
  expect(marks.length).toBe(1);
});

test('separate incidents produce separate marks', () => {
  const stop = (t0: number): SEIDataPoint[] => [
    pt(t0, 60, 100),
    pt(t0 + 0.4, 40, 100),
    pt(t0 + 0.8, 20, 100),
    pt(t0 + 1.2, 5, 100),
  ];
  const data = [
    ...cruise(0, 5, 60),
    ...stop(5),
    ...cruise(7, 20, 60),
    ...stop(20),
    ...cruise(22, 25, 60),
  ];
  const marks = detectHardBraking(data);
  expect(marks.length).toBe(2);
});

test('empty and tiny inputs are safe', () => {
  expect(detectHardBraking([])).toEqual([]);
  expect(detectHardBraking([pt(0, 60), pt(0.1, 30)])).toEqual([]);
});
