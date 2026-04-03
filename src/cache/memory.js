'use strict';

/**
 * In-process LRU cache with TTL expiry.
 *
 * Max 100 entries by default (configurable).
 * 5-minute TTL by default.
 * Least-recently-used eviction when capacity is reached.
 */

const config = require('../config');

class MemoryCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxSize]  max number of entries (default: config.cacheMaxSize)
   * @param {number} [opts.ttlMs]   entry TTL in ms (default: config.cacheTtlMs)
   */
  constructor({ maxSize = config.cacheMaxSize, ttlMs = config.cacheTtlMs } = {}) {
    this._maxSize = maxSize;
    this._ttlMs   = ttlMs;
    /** @type {Map<string, {value:any, expiresAt:number}>} insertion-ordered for LRU */
    this._store   = new Map();
    this._hits    = 0;
    this._misses  = 0;
  }

  /**
   * Retrieve a cached value by key. Returns null on miss or expiry.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) { this._misses++; return null; }
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      return null;
    }
    // Refresh LRU position
    this._store.delete(key);
    this._store.set(key, entry);
    this._hits++;
    return entry.value;
  }

  /**
   * Store a value. Evicts LRU entry if at capacity.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs]  override instance TTL for this entry
   */
  set(key, value, ttlMs) {
    if (this._store.has(key)) this._store.delete(key); // remove for re-insertion at tail
    if (this._store.size >= this._maxSize) {
      // Evict least recently used (first entry in Map)
      this._store.delete(this._store.keys().next().value);
    }
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs !== undefined ? ttlMs : this._ttlMs),
    });
  }

  /**
   * Remove a single key.
   * @param {string} key
   * @returns {boolean} true if key existed
   */
  invalidate(key) {
    return this._store.delete(key);
  }

  /**
   * Remove all entries whose key starts with `prefix`.
   * @param {string} prefix
   * @returns {number} number of entries removed
   */
  invalidatePrefix(prefix) {
    let count = 0;
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) { this._store.delete(key); count++; }
    }
    return count;
  }

  /** Clear all entries. */
  clear() {
    this._store.clear();
    this._hits   = 0;
    this._misses = 0;
  }

  /**
   * Cache statistics.
   * @returns {{size:number, maxSize:number, hits:number, misses:number, hitRate:string}}
   */
  stats() {
    const total = this._hits + this._misses;
    return {
      size:    this._store.size,
      maxSize: this._maxSize,
      hits:    this._hits,
      misses:  this._misses,
      hitRate: total ? `${((this._hits / total) * 100).toFixed(1)}%` : '0%',
    };
  }
}

module.exports = MemoryCache;
