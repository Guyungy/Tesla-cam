/**
 * Regression guard for the blank-dashboard bug: a latched "loading" flag meant
 * SEI extraction ran once, had its result discarded by StrictMode's effect
 * cleanup, and could never start again.
 */
import { expect, test } from '@playwright/test';

import { shareInflight } from '../src/utils/shareInflight';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a second caller adopts the in-flight task instead of starting another', async () => {
  const registry = new Map<string, Promise<number>>();
  const d = deferred<number>();
  let starts = 0;
  const start = () => {
    starts++;
    return d.promise;
  };

  const a = shareInflight(registry, 'clip-1', start);
  const b = shareInflight(registry, 'clip-1', start);
  expect(starts, 'work must not be duplicated').toBe(1);

  d.resolve(42);
  expect(await a).toBe(42);
  // This is the case that used to fail: the pass whose cleanup ran still
  // needs the value, and it must arrive.
  expect(await b).toBe(42);
});

test('the key is released once the task settles, so a later run can restart', async () => {
  const registry = new Map<string, Promise<string>>();
  const first = deferred<string>();
  const a = shareInflight(registry, 'clip-1', () => first.promise);
  expect(registry.has('clip-1')).toBe(true);

  first.resolve('one');
  await a;
  expect(registry.has('clip-1'), 'guard must not stay latched').toBe(false);

  const b = await shareInflight(registry, 'clip-1', () =>
    Promise.resolve('two'),
  );
  expect(b).toBe('two');
});

test('a rejected task also releases the key', async () => {
  const registry = new Map<string, Promise<string>>();
  const boom = deferred<string>();
  const a = shareInflight(registry, 'clip-1', () => boom.promise);

  boom.reject(new Error('read failed'));
  await expect(a).rejects.toThrow('read failed');
  expect(registry.has('clip-1'), 'a failure must not block retries').toBe(
    false,
  );

  expect(
    await shareInflight(registry, 'clip-1', () => Promise.resolve('recovered')),
  ).toBe('recovered');
});

test('different keys run independently', async () => {
  const registry = new Map<string, Promise<string>>();
  const started: string[] = [];
  const a = shareInflight(registry, 'clip-1', () => {
    started.push('clip-1');
    return Promise.resolve('a');
  });
  const b = shareInflight(registry, 'clip-2', () => {
    started.push('clip-2');
    return Promise.resolve('b');
  });
  expect(await a).toBe('a');
  expect(await b).toBe('b');
  expect(started).toEqual(['clip-1', 'clip-2']);
});
