'use strict';

/**
 * Sites API routes.
 *
 * POST   /api/sites              — create a new site
 * GET    /api/sites              — list sites (filtered by owner if JWT auth)
 * GET    /api/sites/:id          — get site metadata
 * DELETE /api/sites/:id          — delete a site
 * POST   /api/sites/:id/save     — save HTML (+ optional name/message)
 * GET    /api/sites/:id/html     — get raw site HTML
 */

const crypto       = require('crypto');
const express      = require('express');
const { v4: uuid } = require('uuid');
const sanitizeHtml = require('sanitize-html');
const storage      = require('../storage');
const cache        = require('../cache');
const { authOrApiKey } = require('./auth');
const config       = require('../config');
const gcsFiles     = require('../storage/gcs-files');

// Firestore for domain → siteId mapping (only used when GCS is enabled)
let _firestoreDb = null;
function _getFirestore() {
  if (!_firestoreDb) {
    const { Firestore } = require('@google-cloud/firestore');
    _firestoreDb = new Firestore({ projectId: config.gcpProject, ignoreUndefinedProperties: true });
  }
  return _firestoreDb;
}

const GCS_ENABLED = Boolean(process.env.GCS_BUCKET);

/** Derive a URL-safe subdomain slug from a site name. */
function _subdomain(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'site';
}

const router = express.Router();

router.use(authOrApiKey);

// ── List sites ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // JWT users only see their own sites; API key sees all
    const filter = req.authType === 'jwt' && req.user
      ? { ownerId: req.user.id }
      : {};
    const sites = await cache.listSites(storage, filter);
    res.json({ sites });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Create site ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { html = '', css = '', message = '', name } = req.body || {};
    const id        = uuid();
    const ownerId   = req.authType === 'jwt' && req.user ? req.user.id : null;
    const finalName = name ? String(name).slice(0, 200) : 'Untitled Site';
    const sanitized = _sanitize(html);
    const subdomain = _subdomain(finalName);
    const apiKey    = crypto.randomBytes(32).toString('hex');

    const site = await storage.saveSite(id, {
      html:    sanitized,
      css,
      message: String(message).slice(0, 500),
      name:    finalName,
      ownerId,
      subdomain,
      apiKey,
    });

    // v2: write decomposed files to GCS + register domain in Firestore
    if (GCS_ENABLED) {
      try {
        await gcsFiles.createSite(id, finalName, ownerId, sanitized, apiKey);
        await _getFirestore()
          .collection('domains')
          .doc(`${subdomain}.n3ware.com`)
          .set({ siteId: id, subdomain, type: 'subdomain', createdAt: new Date().toISOString() });
      } catch (gcsErr) {
        // Non-fatal: log but don't fail the request — Firestore record is already saved
        console.error(`[sites] GCS/domain write failed for ${id}:`, gcsErr.message);
      }
    }

    await cache.onSave(id);
    res.status(201).json({ site: { ...site, subdomain } });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Get site ───────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const site = await cache.getSite(storage, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!_canRead(req, site)) return res.status(403).json({ error: 'Forbidden' });
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
    if (!_canRead(req, site)) return res.status(403).json({ error: 'Forbidden' });
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
    const { html, css = '', message = '', name } = req.body || {};
    if (html === undefined) {
      return res.status(400).json({ error: '`html` field is required' });
    }
    const existing = await storage.getSite(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Site not found' });
    if (!_canWrite(req, existing)) return res.status(403).json({ error: 'Forbidden' });

    const updates = {
      html:    _sanitize(html),
      css,
      message: String(message).slice(0, 500),
    };
    if (name !== undefined) updates.name = String(name).slice(0, 200);

    const site = await storage.saveSite(req.params.id, updates);

    // v2: keep GCS page body in sync
    if (GCS_ENABLED) {
      gcsFiles.savePage(req.params.id, 'index', updates.html)
        .catch(e => console.error(`[sites] GCS savePage failed for ${req.params.id}:`, e.message));
    }

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
    if (!_canWrite(req, existing)) return res.status(403).json({ error: 'Forbidden' });
    await storage.deleteSite(req.params.id);
    cache.onDelete(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    _error(res, 500, err);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** API key auth can read/write all. JWT users can only access their own sites. Site-scoped key only for matching site. */
function _canRead(req, site) {
  if (req.authType === 'apikey') return true;
  if (req.authType === 'sitekey') return site.apiKey && _timingSafeEqual(req.providedApiKey, site.apiKey);
  if (!site.ownerId) return true; // legacy site (no owner)
  return req.user && req.user.id === site.ownerId;
}

function _timingSafeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
    return crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

function _canWrite(req, site) {
  return _canRead(req, site);
}

function _sanitize(html) {
  return sanitizeHtml(html, {
    allowVulnerableTags: true,
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'html','head','body','title','meta','link','style','script',
      'header','footer','nav','main','section','article','aside',
      'figure','figcaption','picture','source','video','audio',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*':      ['class','id','style','data-*','aria-*','role','tabindex'],
      'a':      ['href','target','rel','name'],
      'img':    ['src','srcset','alt','width','height','loading','decoding'],
      'meta':   ['name','content','charset','http-equiv','property'],
      'link':   ['rel','href','type','media'],
      'script': ['src','type','async','defer','charset','crossorigin','integrity'],
    },
    allowedSchemes: ['http','https','mailto','tel','data'],
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
