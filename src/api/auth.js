'use strict';

/**
 * API key authentication middleware.
 *
 * Reads key from X-API-Key header (or ?apiKey query param as fallback).
 * Compares against MASTER_API_KEY env var via constant-time comparison
 * to resist timing attacks.
 */

const crypto = require('crypto');
const config = require('../config');

/**
 * Express middleware that rejects requests missing a valid API key.
 * Returns 401 on missing key, 403 on invalid key.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function requireApiKey(req, res, next) {
  const provided = req.headers['x-api-key'] || req.query.apiKey || '';
  const master   = config.masterApiKey;

  if (!provided) {
    return res.status(401).json({ error: 'API key required (X-API-Key header)' });
  }

  if (!_timingSafeEqual(provided, master)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _timingSafeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) {
      // Still do the comparison to maintain constant time
      crypto.timingSafeEqual(ba, ba);
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

module.exports = { requireApiKey };
