'use strict';

/**
 * Revisions API routes.
 *
 * GET   /api/sites/:id/revisions                    — list revisions
 * GET   /api/sites/:id/revisions/:revId             — get a revision
 * POST  /api/sites/:id/revisions/:revId/rollback    — rollback to revision
 */

const express = require('express');
const storage = require('../storage');
const cache   = require('../cache');
const { requireApiKey } = require('./auth');

const router = express.Router({ mergeParams: true });

router.use(requireApiKey);

// ── List revisions ─────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const site = await storage.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const revisions = await cache.listRevisions(storage, req.params.id);
    res.json({ revisions });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Get single revision ────────────────────────────────────────────────────

router.get('/:revId', async (req, res) => {
  try {
    const rev = await storage.getRevision(req.params.id, req.params.revId);
    if (!rev) return res.status(404).json({ error: 'Revision not found' });
    res.json({ revision: rev });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Rollback ───────────────────────────────────────────────────────────────

router.post('/:revId/rollback', async (req, res) => {
  try {
    const site = await storage.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const updated = await storage.rollback(req.params.id, req.params.revId);
    await cache.onSave(req.params.id, _baseUrl(req));
    res.json({ site: _meta(updated), rolledBack: true });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    _error(res, 500, err);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function _meta(site) {
  const { html: _html, ...meta } = site; // eslint-disable-line no-unused-vars
  return meta;
}

function _baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

function _error(res, status, err) {
  console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = router;
