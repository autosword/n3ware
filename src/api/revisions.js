'use strict';

const { Router } = require('express');
const cache      = require('../cache');
const { createSiteAuth } = require('./auth');

const router  = Router();
const storage = cache.storage;
const requireSiteAuth = createSiteAuth(storage);

// GET /api/sites/:id/revisions — list revisions (metadata, no html)
router.get('/:id/revisions', requireSiteAuth, async (req, res) => {
  try {
    const revisions = await storage.listRevisions(req.params.id);
    res.set('Cache-Control', 'private, no-cache').json(revisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/revisions/:revId — get specific revision (with html)
router.get('/:id/revisions/:revId', requireSiteAuth, async (req, res) => {
  try {
    const rev = await storage.getRevision(req.params.id, req.params.revId);
    if (!rev) return res.status(404).json({ error: 'Revision not found' });
    res.set('Cache-Control', 'private, no-cache').json(rev);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:id/revisions/:revId/rollback — restore + cache invalidation
router.post('/:id/revisions/:revId/rollback', requireSiteAuth, async (req, res) => {
  try {
    const newRevisionId = await storage.rollback(req.params.id, req.params.revId);
    await cache.invalidate(req.params.id);
    res.set('Cache-Control', 'private, no-cache').json({
      revisionId: newRevisionId,
      rolledBackTo: req.params.revId,
      restoredAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
