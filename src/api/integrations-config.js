'use strict';

/**
 * Integrations config API routes.
 *
 * GET    /api/sites/:id/integrations        — get integrations config for a site
 * PUT    /api/sites/:id/integrations        — update (merge) integrations config
 * DELETE /api/sites/:id/integrations/:key   — remove a specific integration
 */

const express = require('express');
const storage = require('../storage');
const cache   = require('../cache');
const { authOrApiKey } = require('./auth');
const { INTEGRATIONS_MAP } = require('../integrations/tracker-scripts');

const router = express.Router({ mergeParams: true });

router.use(authOrApiKey);

// ── GET /api/sites/:id/integrations ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const site = await cache.getSite(storage, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ integrations: site.integrations || {} });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── PUT /api/sites/:id/integrations ────────────────────────────────────────
router.put('/', async (req, res) => {
  try {
    const site = await cache.getSite(storage, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const updates = req.body || {};
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Body must be an integrations config object' });
    }

    // Validate: only allow known integration keys and strip unknown fields
    const sanitized = {};
    for (const [key, cfg] of Object.entries(updates)) {
      if (!INTEGRATIONS_MAP[key]) continue;           // unknown key — skip
      if (typeof cfg !== 'object' || !cfg) continue;
      const integration = INTEGRATIONS_MAP[key];
      const clean = { enabled: !!cfg.enabled };
      for (const field of integration.fields) {
        if (field.name in cfg) {
          clean[field.name] = String(cfg[field.name] || '').slice(0, 2000);
        }
      }
      sanitized[key] = clean;
    }

    const existing = site.integrations || {};
    const merged   = { ...existing, ...sanitized };

    await storage.saveSite(req.params.id, {
      ...site,
      integrations: merged,
      updatedAt: new Date().toISOString(),
    });
    await cache.onSave(req.params.id);

    res.json({ integrations: merged });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── DELETE /api/sites/:id/integrations/:key ────────────────────────────────
router.delete('/:key', async (req, res) => {
  try {
    const site = await cache.getSite(storage, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const integrations = { ...(site.integrations || {}) };
    delete integrations[req.params.key];

    await storage.saveSite(req.params.id, {
      ...site,
      integrations,
      updatedAt: new Date().toISOString(),
    });
    await cache.onSave(req.params.id);

    res.json({ integrations });
  } catch (err) {
    _error(res, 500, err);
  }
});

function _error(res, status, err) {
  console.error('[integrations-config]', err.message || err);
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = router;
