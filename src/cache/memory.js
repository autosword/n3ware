'use strict';

const MAX_SIZE = 100;
const TTL_MS   = 5 * 60 * 1000; // 5 minutes

class MemoryCache {
  constructor() {
    /** @type {Map<string, {value: *, expiresAt: number}>} */
    this._store = new Map();
  }

  /**
   * Get a cached value. Returns null on miss or expiry.
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    // LRU: refresh position by re-inserting
    this._store.delete(key);
    this._store.set(key, entry);
    return entry.value;
  }

  /**
   * Set a cached value.
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs = TTL_MS) {
    if (this._store.size >= MAX_SIZE && !this._store.has(key)) {
      // Evict the oldest (first) entry
      this._store.delete(this._store.keys().next().value);
    }
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Remove a single key.
   * @param {string} key
   */
  invalidate(key) {
    this._store.delete(key);
  }

  /**
   * Remove all keys matching a regex pattern.
   * @param {string} pattern
   */
  invalidatePattern(pattern) {
    const re = new RegExp(pattern);
    for (const key of this._store.keys()) {
      if (re.test(key)) this._store.delete(key);
    }
  }

  /** Clear all entries. */
  clear() {
    this._store.clear();
  }

  /**
   * Cache statistics.
   * @returns {{size: number, expired: number}}
   */
  stats() {
    const now = Date.now();
    let expired = 0;
    for (const entry of this._store.values()) {
      if (now > entry.expiresAt) expired++;
    }
    return { size: this._store.size, expired };
  }
}

module.exports = new MemoryCache();
