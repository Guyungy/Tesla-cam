/**
 * Unit tests for the bounded LRU used by the poster-frame and telemetry
 * caches. Both were previously unbounded Maps, which is a slow leak in a
 * session that touches thousands of clips.
 */
import { expect, test } from '@playwright/test';

import { createLruMap } from '../src/utils/lruMap';

test('stores and reads values', () => {
  const cache = createLruMap<string, number>(3);
  cache.set('a', 1);
  expect(cache.get('a')).toBe(1);
  expect(cache.get('missing')).toBeUndefined();
  expect(cache.size).toBe(1);
});

test('evicts the oldest entry once the limit is exceeded', () => {
  const cache = createLruMap<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  expect(cache.has('a')).toBe(false);
  expect(cache.keys()).toEqual(['b', 'c']);
});

test('a read refreshes recency', () => {
  const cache = createLruMap<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // 'a' is now the most recently used
  cache.set('c', 3);
  expect(cache.has('a')).toBe(true);
  expect(cache.has('b')).toBe(false);
  expect(cache.keys()).toEqual(['a', 'c']);
});

test('re-setting an existing key refreshes it without growing the map', () => {
  const cache = createLruMap<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);
  expect(cache.size).toBe(2);
  expect(cache.keys()).toEqual(['b', 'a']);
  expect(cache.get('a')).toBe(10);
});

test('holds at most the configured number of entries', () => {
  const cache = createLruMap<number, number>(5);
  for (let i = 0; i < 100; i++) cache.set(i, i);
  expect(cache.size).toBe(5);
  expect(cache.keys()).toEqual([95, 96, 97, 98, 99]);
});

test('supports delete and clear', () => {
  const cache = createLruMap<string, number>(3);
  cache.set('a', 1);
  cache.set('b', 2);
  expect(cache.delete('a')).toBe(true);
  expect(cache.delete('a')).toBe(false);
  expect(cache.has('a')).toBe(false);

  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.keys()).toEqual([]);
});

test('a zero-size cache keeps nothing', () => {
  const cache = createLruMap<string, number>(0);
  cache.set('a', 1);
  expect(cache.size).toBe(0);
  expect(cache.get('a')).toBeUndefined();
});

test('a negative limit is treated as zero rather than looping forever', () => {
  const cache = createLruMap<string, number>(-10);
  cache.set('a', 1);
  expect(cache.size).toBe(0);
});
