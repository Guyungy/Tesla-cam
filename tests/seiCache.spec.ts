/**
 * Unit tests for the telemetry cache's identity and validation rules.
 *
 * The key decides when a cached series may be reused, so a key that ignores
 * part of the clip's identity would show one drive's telemetry on another's
 * video — far worse than a cache miss. The validator is the other half: a
 * stale or truncated cache file must degrade to "not cached", never to a
 * dashboard drawn from half-parsed numbers.
 */
import { expect, test } from '@playwright/test';

import { footageCacheKey, isValidSeiSeries } from '../src/utils/seiCache';
import type { SEIDataPoint } from '../src/utils/types';

function video(name: string, size: number, lastModified: number): File {
  return { name, size, lastModified } as File;
}

function point(over: Partial<SEIDataPoint> = {}): SEIDataPoint {
  return {
    offsetSeconds: 0,
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

test('the key is stable regardless of the order files arrive in', () => {
  const a = footageCacheKey({
    name: '2026-01-15_12-30-45',
    videos: [video('...-front.mp4', 10, 1), video('...-back.mp4', 20, 2)],
  });
  const b = footageCacheKey({
    name: '2026-01-15_12-30-45',
    videos: [video('...-back.mp4', 20, 2), video('...-front.mp4', 10, 1)],
  });
  expect(a).toBe(b);
});

test('the key changes when a file is replaced', () => {
  const base = {
    name: '2026-01-15_12-30-45',
    videos: [video('...-front.mp4', 10, 1)],
  };
  const key = footageCacheKey(base);
  expect(
    footageCacheKey({
      name: base.name,
      videos: [video('...-front.mp4', 11, 1)],
    }),
  ).not.toBe(key);
  expect(
    footageCacheKey({
      name: base.name,
      videos: [video('...-front.mp4', 10, 2)],
    }),
  ).not.toBe(key);
  expect(
    footageCacheKey({
      name: base.name,
      videos: [video('...-front.mp4', 10, 1), video('...-back.mp4', 5, 3)],
    }),
  ).not.toBe(key);
});

test('the key distinguishes clips with the same name on different drives', () => {
  // Two TeslaCam folders can both hold `2026-01-15_12-30-45-front.mp4`; the
  // byte size and mtime are what tell them apart.
  const mine = footageCacheKey({
    name: '2026-01-15_12-30-45',
    videos: [video('...-front.mp4', 1234, 1000)],
  });
  const theirs = footageCacheKey({
    name: '2026-01-15_12-30-45',
    videos: [video('...-front.mp4', 5678, 2000)],
  });
  expect(mine).not.toBe(theirs);
});

test('accepts a well-formed series', () => {
  expect(isValidSeiSeries([])).toBe(true);
  expect(
    isValidSeiSeries([
      point({ gear: 'D', apStatus: 'FSD', speedKph: 42.5, latitude: 31.2 }),
    ]),
  ).toBe(true);
});

test('rejects anything that is not an array', () => {
  expect(isValidSeiSeries(null)).toBe(false);
  expect(isValidSeiSeries(undefined)).toBe(false);
  expect(isValidSeiSeries({ points: [] })).toBe(false);
  expect(isValidSeiSeries('[]')).toBe(false);
});

test('rejects entries with a missing or non-finite field', () => {
  expect(isValidSeiSeries([null])).toBe(false);
  expect(isValidSeiSeries([42])).toBe(false);

  const missingSpeed: Record<string, unknown> = { ...point() };
  delete missingSpeed.speedKph;
  expect(isValidSeiSeries([missingSpeed])).toBe(false);

  expect(isValidSeiSeries([point({ offsetSeconds: Number.NaN })])).toBe(false);
  expect(isValidSeiSeries([point({ latitude: Infinity })])).toBe(false);
  expect(
    isValidSeiSeries([
      { ...point(), speedKph: '60' } as unknown as SEIDataPoint,
    ]),
  ).toBe(false);
});

test('rejects unknown enum members', () => {
  const badGear = { ...point(), gear: 'X' } as unknown as SEIDataPoint;
  const badStatus = {
    ...point(),
    apStatus: 'AUTOPILOT',
  } as unknown as SEIDataPoint;
  expect(isValidSeiSeries([badGear])).toBe(false);
  expect(isValidSeiSeries([badStatus])).toBe(false);
});

test('accepts every gear and autopilot value the parser can emit', () => {
  for (const gear of ['P', 'R', 'N', 'D', 'UNKNOWN'] as const) {
    expect(isValidSeiSeries([point({ gear })])).toBe(true);
  }
  for (const apStatus of ['OFF', 'STANDBY', 'AP', 'FSD', 'UNKNOWN'] as const) {
    expect(isValidSeiSeries([point({ apStatus })])).toBe(true);
  }
});
