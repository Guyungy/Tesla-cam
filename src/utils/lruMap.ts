/**
 * A Map with a hard entry limit and least-recently-used eviction.
 *
 * Both caches in the viewer are unbounded by nature — poster frames are keyed
 * by clip name and SEI series by clip fingerprint — and a TeslaCam drive holds
 * thousands of clips, so "one entry per clip" is really "one entry per clip
 * ever viewed". Reads refresh recency, so the working set (the clips you are
 * actually scrubbing through) is what survives.
 */
export type LruMap<K, V> = {
  /** Read a value, marking it as most recently used. */
  get(key: K): V | undefined;
  /** Insert/refresh a value, evicting the oldest entries past the limit. */
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  /** Keys in eviction order (oldest first) — mainly for tests. */
  keys(): K[];
};

export function createLruMap<K, V>(maxEntries: number): LruMap<K, V> {
  const limit = Math.max(0, Math.trunc(maxEntries));
  // A Map iterates in insertion order, so re-inserting on read is all the
  // bookkeeping an LRU needs.
  const store = new Map<K, V>();

  return {
    get(key) {
      if (!store.has(key)) return undefined;
      const value = store.get(key) as V;
      store.delete(key);
      store.set(key, value);
      return value;
    },
    set(key, value) {
      store.delete(key);
      store.set(key, value);
      while (store.size > limit) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    },
    has(key) {
      return store.has(key);
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
    keys() {
      return Array.from(store.keys());
    },
  };
}
