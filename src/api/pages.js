'use strict';

const crypto = require('crypto');
const { generatePageWithAI, addPageToNav, loadPageTemplate, customizeTemplateWithAI } = require('../integrations/page-generator');

/**
 * Multi-page management API — v2 architecture.
 *
 * All routes are nested under /api/sites/:id and require auth.
 *
 * Pages:
 *   GET    /api/sites/:id/pages                       — list pages from manifest
 *   POST   /api/sites/:id/pages                       — add new page
 *   PUT    /api/sites/:id/pages/:slug                 — save page HTML
 *   DELETE /api/sites/:id/pages/:slug                 — remove page
 *   GET    /api/sites/:id/pages/:slug/versions        — list GCS versions
 *   POST   /api/sites/:id/pages/:slug/rollback        — restore a version
 *
 * Generate (AI):
 *   POST   /api/sites/:id/pages/generate              — AI-generate a new page
 *
 * Components (shared header/nav/footer):
 *   GET    /api/sites/:id/components/:name            — get component HTML
 *   PUT    /api/sites/:id/components/:name            — save component HTML
 *
 * Manifest:
 *   GET    /api/sites/:id/manifest                    — get full site.json
 *   PATCH  /api/sites/:id/manifest                    — update theme/scripts
 */

const express  = require('express');
const storage  = require('../storage');
const cache    = require('../cache');
const gcsFiles = require('../storage/gcs-files');
const { authOrApiKey } = require('./auth');

const GCS_ENABLED = Boolean(process.env.GCS_BUCKET);

const router = express.Router({ mergeParams: true });

router.use(authOrApiKey);

// ── Guards ────────────────────────────────────────────────────────────────────

async function _requireSite(req, res) {
  const site = await storage.getSite(req.params.id);
  if (!site) { res.status(404).json({ error: 'Site not found' }); return null; }
  if (req.authType === 'jwt' && req.user && site.ownerId && site.ownerId !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  if (req.authType === 'sitekey') {
    if (!site.apiKey || !_timingSafeEqual(req.providedApiKey, site.apiKey)) {
      res.status(403).json({ error: 'Invalid site API key' }); return null;
    }
  }
  return site;
}

function _timingSafeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
    return crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

function _slugParam(req, res) {
  const raw = req.params.slug || '';
  const slug = raw.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  if (!slug) { res.status(400).json({ error: 'Invalid slug' }); return null; }
  return slug;
}

// ── Pages ─────────────────────────────────────────────────────────────────────

// GET /api/sites/:id/pages
router.get('/pages', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const manifest = await gcsFiles.getManifest(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Site manifest not found (not a v2 site)' });
    res.json({ pages: manifest.pages });
  } catch (err) { _error(res, err); }
});

// POST /api/sites/:id/pages
router.post('/pages', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const { slug, title = '', html = '' } = req.body || {};
    if (!slug) return res.status(400).json({ error: '`slug` is required' });

    const safeSlug = slug.replace(/[^a-z0-9-]/g, '-').toLowerCase();
    if (safeSlug === 'index') return res.status(400).json({ error: 'Use slug "index" only for the home page (already created)' });

    await gcsFiles.savePage(req.params.id, safeSlug, html, title || safeSlug);
    const manifest = await gcsFiles.getManifest(req.params.id);
    const page = manifest.pages.find(p => p.slug === safeSlug);
    res.status(201).json({ page });
  } catch (err) { _error(res, err); }
});

// PUT /api/sites/:id/pages/:slug
router.put('/pages/:slug', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const slug = _slugParam(req, res); if (!slug) return;
    const { html, title } = req.body || {};
    if (html === undefined) return res.status(400).json({ error: '`html` is required' });

    if (GCS_ENABLED) {
      await gcsFiles.savePage(req.params.id, slug, html, title);
    } else if (slug === 'index') {
      await storage.saveSite(req.params.id, { html });
    }
    cache.onSave(req.params.id).catch(() => {});

    // Fire-and-forget cache invalidation
    _bustCaches(req.params.id, slug);

    res.json({ saved: true, slug });
  } catch (err) { _error(res, err); }
});

// POST /api/sites/:id/pages/generate — AI page generation
// NOTE: must be defined before /pages/:slug to avoid Express treating "generate" as a slug
router.post('/pages/generate', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    if (!GCS_ENABLED) return res.status(503).json({ error: 'GCS not configured — page generation requires GCS storage' });

    const { name, description = '', imageUrls = [], templateId } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: '`name` is required' });

    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return res.status(400).json({ error: 'Page name could not be converted to a valid slug' });
    if (slug === 'index') return res.status(400).json({ error: 'Cannot generate a page with slug "index"' });

    let html;

    if (templateId) {
      // Template-based: load template and customize with AI
      const template = loadPageTemplate(templateId);
      if (!template) return res.status(400).json({ error: `Template "${templateId}" not found` });
      html = await customizeTemplateWithAI(template, String(description), imageUrls, String(name).trim());
    } else {
      // Scratch: generate from description
      let components = [];
      try { components = require('../../public/components/components.json'); } catch (_) {}
      html = await generatePageWithAI(String(description), components, imageUrls, String(name).trim());
    }

    // Write page to GCS + update manifest
    await gcsFiles.savePage(req.params.id, slug, html, String(name).trim());

    // Update nav component to include the new page link
    try {
      const navHtml    = await gcsFiles.getComponent(req.params.id, 'nav');
      const updatedNav = addPageToNav(navHtml, slug, String(name).trim());
      await gcsFiles.saveComponent(req.params.id, 'nav', updatedNav);
    } catch (navErr) {
      console.warn('[pages/generate] nav update failed:', navErr.message);
    }

    // Bust assembler + CDN caches
    cache.onSave(req.params.id).catch(() => {});
    _bustCaches(req.params.id, slug);

    res.status(201).json({
      success: true,
      slug,
      title:   String(name).trim(),
      html:    html.substring(0, 300) + (html.length > 300 ? '…' : ''),
    });
  } catch (err) { _error(res, err); }
});

// DELETE /api/sites/:id/pages/:slug
router.delete('/pages/:slug', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const slug = _slugParam(req, res); if (!slug) return;
    await gcsFiles.deletePage(req.params.id, slug);
    res.json({ deleted: true, slug });
  } catch (err) { _error(res, err); }
});

// GET /api/sites/:id/pages/:slug/versions
router.get('/pages/:slug/versions', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const slug = _slugParam(req, res); if (!slug) return;
    const versions = await gcsFiles.getPageVersions(req.params.id, slug);
    res.json({ versions });
  } catch (err) { _error(res, err); }
});

// POST /api/sites/:id/pages/:slug/rollback
router.post('/pages/:slug/rollback', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const slug = _slugParam(req, res); if (!slug) return;
    const { generation } = req.body || {};
    if (!generation) return res.status(400).json({ error: '`generation` is required' });

    await gcsFiles.rollbackPage(req.params.id, slug, String(generation));
    res.json({ rolledBack: true, slug, generation });
  } catch (err) { _error(res, err); }
});

// ── Components ─────────────────────────────────────────────────────────────────

// GET /api/sites/:id/components/:name
router.get('/components/:name', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const { name } = req.params;
    const html = await gcsFiles.getComponent(req.params.id, name);
    if (html === null) return res.status(404).json({ error: `Component "${name}" not found` });
    res.json({ name, html });
  } catch (err) { _error(res, err); }
});

// PUT /api/sites/:id/components/:name
router.put('/components/:name', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const { name } = req.params;
    const { html } = req.body || {};
    if (html === undefined) return res.status(400).json({ error: '`html` is required' });

    await gcsFiles.saveComponent(req.params.id, name, html);
    cache.onSave(req.params.id).catch(() => {});
    _bustCaches(req.params.id, 'index'); // component change affects all pages
    res.json({ saved: true, name });
  } catch (err) { _error(res, err); }
});

// ── Manifest ──────────────────────────────────────────────────────────────────

// GET /api/sites/:id/manifest
router.get('/manifest', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const manifest = await gcsFiles.getManifest(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found (not a v2 site)' });
    res.json({ manifest });
  } catch (err) { _error(res, err); }
});

// PATCH /api/sites/:id/manifest
router.patch('/manifest', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const { theme, headScripts, bodyScripts, name } = req.body || {};
    const updates = {};
    if (theme        !== undefined) updates.theme        = theme;
    if (headScripts  !== undefined) updates.headScripts  = headScripts;
    if (bodyScripts  !== undefined) updates.bodyScripts  = bodyScripts;
    if (name         !== undefined) updates.name         = String(name).slice(0, 200);

    const manifest = await gcsFiles.updateManifest(req.params.id, updates);
    res.json({ manifest });
  } catch (err) { _error(res, err); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _error(res, err) {
  console.error('[pages api]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
}

/**
 * Fire-and-forget cache invalidation after a page/component save.
 * Hits the Go assembler's /purge/:siteId endpoint and purges Cloudflare URLs.
 */
function _bustCaches(siteId, slug) {
  const ASSEMBLER = process.env.ASSEMBLER_URL || 'https://assembler.n3ware.com';
  const CF_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;
  const CF_ZONE   = process.env.CLOUDFLARE_ZONE_ID || '988f3dee002b0592d10ba5d3414b82e1';

  // 1. Bust assembler in-memory cache
  fetch(`${ASSEMBLER}/purge/${siteId}`, { method: 'POST' })
    .catch(e => console.warn('[pages] assembler purge failed:', e.message));

  // 2. Purge Cloudflare CDN for affected URLs
  if (CF_TOKEN) {
    const urls = [
      `${ASSEMBLER}/sites/${siteId}`,
      `${ASSEMBLER}/sites/${siteId}/`,
    ];
    if (slug && slug !== 'index') {
      urls.push(`${ASSEMBLER}/sites/${siteId}/${slug}`);
    }
    fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ files: urls }),
    }).catch(e => console.warn('[pages] CF purge failed:', e.message));
  }
}

module.exports = router;
