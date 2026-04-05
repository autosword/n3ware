'use strict';

/**
 * Authentication middleware.
 *
 * requireApiKey  — validates X-API-Key / ?apiKey against MASTER_API_KEY
 * verifyToken    — validates Authorization: Bearer <jwt>, attaches req.user
 * authOrApiKey   — accepts either JWT or API key; rejects if neither valid
 */

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
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

/**
 * JWT verification middleware.
 * Reads Authorization: Bearer <token>, verifies signature, attaches req.user.
 * Returns 401 if missing/invalid.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware that accepts either a valid JWT or a valid API key.
 * - JWT: attaches req.user, sets req.authType = 'jwt'
 * - API key: sets req.authType = 'apikey', req.user = null
 * - Neither: 401
 */
async function authOrApiKey(req, res, next) {
  try {
    // 1. Authorization: Bearer <JWT>
    const header = req.headers['authorization'] || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (bearer) {
      try {
        req.user     = jwt.verify(bearer, config.jwtSecret);
        req.authType = 'jwt';
        return next();
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    // 2. n3_token cookie (set by magic-auth on .n3ware.com)
    const cookieToken = req.cookies && req.cookies.n3_token;
    if (cookieToken) {
      try {
        req.user     = jwt.verify(cookieToken, config.jwtSecret);
        req.authType = 'jwt';
        return next();
      } catch {
        // Invalid cookie — fall through to API key check
      }
    }

    // 3. X-API-Key header
    const provided = req.headers['x-api-key'] || req.query.apiKey || '';
    if (!provided) {
      return res.status(401).json({ error: 'Authentication required (Bearer token, cookie, or X-API-Key)' });
    }

    // 3a. Master key
    if (_timingSafeEqual(provided, config.masterApiKey)) {
      req.user     = null;
      req.authType = 'apikey';
      return next();
    }

    // 3b. Per-site key — look up in storage. Any key that belongs to a real site
    //     in the DB is valid for site-scoped operations. Bogus keys that don't
    //     match any site are rejected with 401 here (Cat A fix maintained).
    const storage = require('../storage');
    const site = await storage.findSiteByApiKey(provided);
    if (site) {
      req.user           = null;
      req.authType       = 'sitekey';
      req.providedApiKey = provided;
      req.site           = site;
      return next();
    }

    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    next(err);
  }
}

module.exports = { requireApiKey, verifyToken, authOrApiKey };
