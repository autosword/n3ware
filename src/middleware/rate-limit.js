'use strict';

/**
 * src/middleware/rate-limit.js — Simple in-memory rate limiter factory.
 *
 * Usage:
 *   const { createRateLimit } = require('../middleware/rate-limit');
 *
 *   router.post('/scrape', createRateLimit({
 *     keyFn:  req => getIp(req) + '::' + (req.body && req.body.url || ''),
 *     window: 30,   // seconds
 *     max:    1,    // max requests per window per key
 *   }), handler);
 *
 * Note on multi-instance deployments:
 *   This limiter is in-process only. If Cloud Run scales to multiple instances,
 *   each instance enforces its own limit independently — so a determined caller
 *   could hit N instances N times within the window. For the scraper use-case
 *   ("don't let someone hammer the same target site") this is an acceptable
 *   trade-off; the limit still prevents runaway requests from a single instance
 *   and deters casual abuse. If stricter enforcement is needed in future,
 *   swap the Map for a Redis/Memorystore backend.
 */

/**
 * Extract the real client IP, honouring Cloud Run's X-Forwarded-For header.
 * @param {import('express').Request} req
 * @returns {string}
 */
function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

/**
 * Factory: returns Express middleware that enforces a sliding-window rate limit.
 *
 * @param {{ keyFn: (req: import('express').Request) => string, window: number, max: number }} opts
 *   keyFn  — function that returns the composite rate-limit key for a request
 *   window — time window in seconds
 *   max    — max allowed requests per key within the window (default 1)
 * @returns {import('express').RequestHandler}
 */
function createRateLimit({ keyFn, window: windowSecs = 30, max = 1 }) {
  // Map<key, number[]> — stores timestamps of recent requests per key
  const store = new Map();

  // Sweep entries older than the window every 5 minutes to prevent unbounded growth.
  // Each bucket is pruned to only recent timestamps; empty buckets are deleted.
  const sweepMs = 5 * 60 * 1000;
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowSecs * 1000;
    for (const [key, timestamps] of store) {
      const fresh = timestamps.filter(t => t > cutoff);
      if (fresh.length === 0) store.delete(key);
      else store.set(key, fresh);
    }
  }, sweepMs);
  // Don't keep the Node process alive just for cleanup
  if (cleanupTimer.unref) cleanupTimer.unref();

  return function rateLimitMiddleware(req, res, next) {
    const key  = keyFn(req);
    const now  = Date.now();
    const windowMs = windowSecs * 1000;
    const cutoff   = now - windowMs;

    // Get recent timestamps for this key, pruning stale ones
    const timestamps = (store.get(key) || []).filter(t => t > cutoff);

    if (timestamps.length >= max) {
      // Calculate when the oldest request in the window expires
      const oldest    = timestamps[0];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error:      `Rate limited. Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before scraping this site again.`,
        retryAfter,
      });
    }

    timestamps.push(now);
    store.set(key, timestamps);
    next();
  };
}

module.exports = { createRateLimit, getIp };
