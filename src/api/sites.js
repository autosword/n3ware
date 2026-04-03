'use strict';

/**
 * Sites API routes.
 *
 * POST   /api/sites              — create a new site
 * GET    /api/sites              — list all sites
 * GET    /api/sites/:id          — get site metadata
 * DELETE /api/sites/:id          — delete a site
 * POST   /api/sites/:id/save     — save HTML (+ optional css/message)
 * GET    /api/sites/:id/html     — get raw site HTML
 */

const express      = require('express');
const { v4: uuid } = require('uuid');
const sanitizeHtml = require('sanitize-html');
const storage      = require('../storage');
const cache        = require('../cache');
const { requireApiKey } = require('./auth');

const router = express.Router();

// ── All sites routes require auth ──────────────────────────────────────────
router.use(requireApiKey);

// ── List sites ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const sites = await cache.listSites(storage);
    res.json({ sites });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Create site ────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { html = '', css = '', message = '' } = req.body || {};
    const id = uuid();
    const site = await storage.saveSite(id, {
      html: _sanitize(html),
      css,
      message: String(message).slice(0, 500),
    });
    await cache.onSave(id);
    res.status(201).json({ site });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Get site ───────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const site = await cache.getSite(storage, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { html: _html, ...meta } = site; // eslint-disable-line no-unused-vars
    res.json({ site: meta });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Get raw HTML ───────────────────────────────────────────────────────────

router.get('/:id/html', async (req, res) => {
  try {
    const site = await cache.getSite(storage, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(site.html);
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Save site HTML ─────────────────────────────────────────────────────────

router.post('/:id/save', async (req, res) => {
  try {
    const { html, css = '', message = '' } = req.body || {};
    if (html === undefined) {
      return res.status(400).json({ error: '`html` field is required' });
    }
    const existing = await storage.getSite(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Site not found' });

    const site = await storage.saveSite(req.params.id, {
      html:    _sanitize(html),
      css,
      message: String(message).slice(0, 500),
    });
    await cache.onSave(req.params.id, _baseUrl(req));
    res.json({ site: _meta(site) });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Delete site ────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const existing = await storage.getSite(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Site not found' });
    await storage.deleteSite(req.params.id);
    cache.onDelete(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function _sanitize(html) {
  return sanitizeHtml(html, {
    allowedTags:       sanitizeHtml.defaults.allowedTags.concat([
      'html','head','body','title','meta','link','style',
      'header','footer','nav','main','section','article','aside',
      'figure','figcaption','picture','source','video','audio',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*':   ['class','id','style','data-*','aria-*','role','tabindex'],
      'a':   ['href','target','rel','name'],
      'img': ['src','srcset','alt','width','height','loading','decoding'],
      'meta':['name','content','charset','http-equiv','property'],
      'link':['rel','href','type','media'],
    },
    allowedSchemes:    ['http','https','mailto','tel','data'],
    allowProtocolRelative: true,
  });
}

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
