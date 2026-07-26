/**
 * Unit tests for SEI → datapoint conversion (timeline mapping, fps
 * estimation, speed sanitation). Pure logic — no browser needed.
 */
import { expect, test } from '@playwright/test';

import { convertToDataPoints, type RawSEIMessage } from '../src/utils/parseSEI';

function msgs(
  count: number,
  base: Partial<RawSEIMessage> = {},
  seqStart?: number,
): RawSEIMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    vehicleSpeedMps: 20,
    gearState: 1,
    ...(seqStart !== undefined ? { frameSeqNo: seqStart + i } : {}),
    ...base,
  }));
}

test('estimates fps from frameSeqNo span and clamps to segment window', () => {
  // 72 samples spanning 71 frames over a 2s segment → ~35.5 fps estimate
  const pts = convertToDataPoints(msgs(72, {}, 100), 60, 2);
  expect(pts).toHaveLength(72);
  expect(pts[0].offsetSeconds).toBeCloseTo(60, 3);
  expect(pts[pts.length - 1].offsetSeconds).toBeCloseTo(62, 2);
  for (const p of pts) {
    expect(p.offsetSeconds).toBeGreaterThanOrEqual(60);
    expect(p.offsetSeconds).toBeLessThanOrEqual(62);
  }
});

test('falls back to index-based offsets without frameSeqNo', () => {
  // 600 samples over 60s → ~10 fps estimated from density
  const pts = convertToDataPoints(msgs(600), 0, 60);
  expect(pts[0].offsetSeconds).toBe(0);
  expect(pts[599].offsetSeconds).toBeCloseTo(60, 0);
});

test('sparse series (< 5 samples/s) keeps default fps — no stretching', () => {
  // 60 samples in a 60s segment is far below any real SEI rate; estimation
  // is rejected and the default 36 fps keeps them packed at the start.
  const pts = convertToDataPoints(msgs(60), 0, 60);
  expect(pts[59].offsetSeconds).toBeCloseTo(59 / 36, 1);
});

test('does not stretch a short series onto a parked tail', () => {
  // 36 samples ≈ 1s of driving data in a 60s segment: offsets must stay
  // near the start rather than being spread across the full minute.
  const pts = convertToDataPoints(msgs(36, {}, 0), 0, 60);
  expect(pts[pts.length - 1].offsetSeconds).toBeLessThan(10);
});

test('speed conversion: m/s → km/h, park low-speed clamp, absurd values capped', () => {
  const drive = convertToDataPoints(msgs(1, { vehicleSpeedMps: 20 }), 0, 0);
  expect(drive[0].speedKph).toBeCloseTo(72, 1);

  const parked = convertToDataPoints(
    msgs(1, { vehicleSpeedMps: 0.3, gearState: 0 }),
    0,
    0,
  );
  expect(parked[0].speedKph).toBe(0);

  const negative = convertToDataPoints(msgs(1, { vehicleSpeedMps: -5 }), 0, 0);
  expect(negative[0].speedKph).toBe(0);

  const absurd = convertToDataPoints(msgs(1, { vehicleSpeedMps: 500 }), 0, 0);
  expect(absurd[0].speedKph).toBeLessThanOrEqual(300);
});

test('gear / AP status mapping and pedal + steering units', () => {
  const pts = convertToDataPoints(
    msgs(1, {
      gearState: 2,
      autopilotState: 1,
      acceleratorPedalPosition: 38,
      steeringWheelAngle: 389.3,
      brakeApplied: true,
    }),
    0,
    0,
  );
  expect(pts[0].gear).toBe('R');
  expect(pts[0].apStatus).toBe('FSD');
  // Pedal is a percent, not a 0–1 fraction: 38 means 38%, not 100%.
  expect(pts[0].throttlePct).toBe(38);
  // Steering is degrees, not radians: 389.3 must not become 22,300°.
  expect(pts[0].steeringAngleDeg).toBeCloseTo(389.3, 3);
  expect(pts[0].brakePct).toBe(100);

  const unknown = convertToDataPoints(msgs(1, { gearState: 99 }), 0, 0);
  expect(unknown[0].gear).toBe('UNKNOWN');
});

test('absent gear / AP fields decode as the protobuf default (P / OFF)', () => {
  // proto3 omits zero-valued fields, so a parked car sends no gear_state at all.
  const pts = convertToDataPoints(
    [{ vehicleSpeedMps: 0, frameSeqNo: 0 }],
    0,
    0,
  );
  expect(pts[0].gear).toBe('P');
  expect(pts[0].apStatus).toBe('OFF');
});

test('out-of-range pedal and steering are clamped, not wrapped', () => {
  const pts = convertToDataPoints(
    msgs(1, { acceleratorPedalPosition: 170, steeringWheelAngle: -5000 }),
    0,
    0,
  );
  expect(pts[0].throttlePct).toBe(100);
  expect(pts[0].steeringAngleDeg).toBe(-900);

  const negative = convertToDataPoints(
    msgs(1, { acceleratorPedalPosition: -5 }),
    0,
    0,
  );
  expect(negative[0].throttlePct).toBe(0);
});

test('empty input yields empty output', () => {
  expect(convertToDataPoints([], 0, 60)).toEqual([]);
});
