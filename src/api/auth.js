'use strict';

const config = require('../config');

/**
 * Require master API key via X-API-Key header or ?api_key= query param.
 */
function requireMasterKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

/**
 * Create middleware that accepts the master key OR the site's own API key.
 * On match, caches the site doc in req.site.
 * @param {object} storage — storage instance
 * @returns {Function} Express middleware
 */
function createSiteAuth(storage) {
  return async (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (!key) return res.status(401).json({ error: 'API key required' });
    if (key === config.apiKey) return next();

    try {
      const site = await storage.getSite(req.params.id);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      if (key !== site.apiKey) return res.status(403).json({ error: 'Forbidden' });
      req.site = site;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireMasterKey, createSiteAuth };
