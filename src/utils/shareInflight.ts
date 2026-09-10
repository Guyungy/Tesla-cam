/**
 * Share one in-flight async task per key.
 *
 * Exists because of a real failure: SEI extraction was guarded by a boolean
 * "loading" ref that the effect cleanup never reset. React StrictMode runs
 * effects twice in development, so the first pass started the parse and threw
 * its result away, while the second pass saw the latched flag and returned
 * immediately — the driving dashboard stayed blank forever.
 *
 * A key-scoped promise has neither failure mode: the second caller adopts the
 * first caller's work instead of duplicating or blocking on it, and the key is
 * always released when the task settles (including on rejection).
 */
export function shareInflight<T>(
  registry: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const existing = registry.get(key);
  if (existing) return existing;

  const task = start().finally(() => {
    // Only clear our own entry — a later task for the same key may have
    // replaced it after this one settled.
    if (registry.get(key) === task) registry.delete(key);
  });
  registry.set(key, task);
  return task;
}
