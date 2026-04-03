'use strict';

const { Router }      = require('express');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml    = require('sanitize-html');
const cache           = require('../cache');
const { requireMasterKey, createSiteAuth } = require('./auth');

const router = Router();
const storage = cache.storage;
const requireSiteAuth = createSiteAuth(storage);

const SANITIZE_OPTS = {
  allowedTags:        false,  // allow all tags
  allowedAttributes:  false,  // allow all attributes
  allowVulnerableTags: true,  // allow <script>, <style>
};

// POST /api/sites — create site
router.post('/', requireMasterKey, async (req, res) => {
  try {
    const id     = uuidv4();
    const apiKey = uuidv4();
    const now    = new Date().toISOString();
    const site = {
      id,
      name:      req.body.name || 'Untitled Site',
      html:      req.body.html ? sanitizeHtml(req.body.html, SANITIZE_OPTS) : '',
      apiKey,
      createdAt: now,
      updatedAt: now,
    };
    await storage.saveSite(id, site);
    res.set('Cache-Control', 'private, no-cache').status(201).json({ siteId: id, apiKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id — get site metadata (no html, no apiKey)
router.get('/:id', requireSiteAuth, async (req, res) => {
  try {
    const site = req.site || await storage.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { apiKey: _k, html: _h, ...meta } = site;
    res.set('Cache-Control', 'private, no-cache').json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sites/:id — update metadata
router.put('/:id', requireSiteAuth, async (req, res) => {
  try {
    const site = req.site || await storage.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    // Only allow updating non-sensitive metadata fields
    const { id: _i, apiKey: _k, createdAt: _c, ...allowed } = req.body;
    const updated = { ...site, ...allowed, id: site.id, apiKey: site.apiKey, updatedAt: new Date().toISOString() };
    await storage.saveSite(site.id, updated);
    const { apiKey: _key, html: _h, ...meta } = updated;
    res.set('Cache-Control', 'private, no-cache').json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:id — delete site
router.delete('/:id', requireMasterKey, async (req, res) => {
  try {
    await storage.deleteSite(req.params.id);
    await cache.invalidate(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:id/save — save HTML, create revision, invalidate cache
router.post('/:id/save', requireSiteAuth, async (req, res) => {
  try {
    const { html } = req.body;
    if (html === undefined || html === null) {
      return res.status(400).json({ error: 'html is required' });
    }
    const clean      = sanitizeHtml(html, SANITIZE_OPTS);
    const revisionId = await cache.save(req.params.id, clean);
    res.set('Cache-Control', 'private, no-cache').json({
      revisionId,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.message === 'Site not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/sites/:id/html — get current HTML (public, cached)
router.get('/:id/html', async (req, res) => {
  try {
    const html = await cache.getHtml(req.params.id);
    if (html === null) return res.status(404).send('Site not found');
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300').send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
