'use strict';

const { v4: uuidv4 } = require('uuid');
const express  = require('express');
const storage  = require('../storage');
const gcsFiles = require('../storage/gcs-files');
const { authOrApiKey } = require('./auth');

const router = express.Router({ mergeParams: true });
router.use(authOrApiKey);

const GCS_ENABLED = Boolean(process.env.GCS_BUCKET);

// ── Guards ────────────────────────────────────────────────────────────────────
async function _requireSite(req, res) {
  const site = await storage.getSite(req.params.siteId);
  if (!site) { res.status(404).json({ error: 'Site not found' }); return null; }
  return site;
}

function _error(res, err) {
  console.error('[collections api]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
}

// Valid field types
const VALID_TYPES = new Set(['text', 'richtext', 'image', 'url', 'number', 'date', 'boolean', 'select']);

function _validateFields(fields) {
  if (!Array.isArray(fields)) return 'fields must be an array';
  const keys = new Set();
  for (const f of fields) {
    if (!f.key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.key)) return `invalid field key: "${f.key}"`;
    if (keys.has(f.key)) return `duplicate field key: "${f.key}"`;
    if (!f.label) return `field "${f.key}" is missing label`;
    if (!VALID_TYPES.has(f.type)) return `field "${f.key}" has invalid type "${f.type}"`;
    keys.add(f.key);
  }
  return null;
}

// ── Collections CRUD ──────────────────────────────────────────────────────────

// GET /api/sites/:siteId/collections
router.get('/', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const collections = await gcsFiles.listCollections(req.params.siteId);
    res.json({ collections });
  } catch (err) { _error(res, err); }
});

// POST /api/sites/:siteId/collections
router.post('/', async (req, res) => {
  try {
    const site = await _requireSite(req, res);
    if (!site) return;

    const { name, slug, fields = [] } = req.body || {};
    if (!name) return res.status(400).json({ error: '`name` is required' });
    if (!slug)  return res.status(400).json({ error: '`slug` is required' });

    const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!safeSlug) return res.status(400).json({ error: 'Invalid slug' });

    const fieldErr = _validateFields(fields);
    if (fieldErr) return res.status(400).json({ error: fieldErr });

    // Collection limit gate
    if (GCS_ENABLED) {
      const existing = await gcsFiles.listCollections(req.params.siteId);
      const limit = site.subscription?.limits?.collections ?? 2;
      if (existing.length >= limit) {
        return res.status(402).json({
          error: 'Collection limit reached', limit, current: existing.length,
          upgradeUrl: '/api/billing/checkout',
        });
      }
    }

    const now = new Date().toISOString();
    const definition = { id: safeSlug, name: String(name).trim(), slug: safeSlug, fields, createdAt: now, updatedAt: now };
    await gcsFiles.saveCollection(req.params.siteId, safeSlug, definition);

    // Update manifest
    await _updateManifestCollections(req.params.siteId);

    res.status(201).json({ collection: definition });
  } catch (err) { _error(res, err); }
});

// GET /api/sites/:siteId/collections/:slug
router.get('/:slug', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const col = await gcsFiles.getCollection(req.params.siteId, req.params.slug);
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    res.json({ collection: col });
  } catch (err) { _error(res, err); }
});

// PUT /api/sites/:siteId/collections/:slug
router.put('/:slug', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const existing = await gcsFiles.getCollection(req.params.siteId, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });

    const { name, fields } = req.body || {};
    if (fields !== undefined) {
      const fieldErr = _validateFields(fields);
      if (fieldErr) return res.status(400).json({ error: fieldErr });
    }

    const updated = {
      ...existing,
      ...(name   !== undefined && { name: String(name).trim() }),
      ...(fields !== undefined && { fields }),
      updatedAt: new Date().toISOString(),
    };
    await gcsFiles.saveCollection(req.params.siteId, req.params.slug, updated);
    res.json({ collection: updated });
  } catch (err) { _error(res, err); }
});

// DELETE /api/sites/:siteId/collections/:slug
router.delete('/:slug', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    await gcsFiles.deleteCollection(req.params.siteId, req.params.slug);
    await _updateManifestCollections(req.params.siteId);
    res.json({ deleted: true, slug: req.params.slug });
  } catch (err) { _error(res, err); }
});

// ── Entries CRUD ──────────────────────────────────────────────────────────────

// GET /api/sites/:siteId/collections/:slug/entries
router.get('/:slug/entries', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const { sort, limit } = req.query;
    const entries = await gcsFiles.listEntries(req.params.siteId, req.params.slug, {
      sort, limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ entries });
  } catch (err) { _error(res, err); }
});

// POST /api/sites/:siteId/collections/:slug/entries
router.post('/:slug/entries', async (req, res) => {
  try {
    const site = await _requireSite(req, res);
    if (!site) return;

    const col = await gcsFiles.getCollection(req.params.siteId, req.params.slug);
    if (!col) return res.status(404).json({ error: 'Collection not found' });

    const { data = {} } = req.body || {};

    // Validate required fields
    for (const field of (col.fields || [])) {
      if (field.required && (data[field.key] === undefined || data[field.key] === '')) {
        return res.status(400).json({ error: `Required field "${field.key}" is missing` });
      }
    }

    // Entry limit gate
    if (GCS_ENABLED) {
      const existing = await gcsFiles.listEntries(req.params.siteId, req.params.slug);
      const limit = site.subscription?.limits?.entriesPerCollection ?? 10;
      if (existing.length >= limit) {
        return res.status(402).json({
          error: 'Entry limit reached', limit, current: existing.length,
          upgradeUrl: '/api/billing/checkout',
        });
      }
    }

    const now = new Date().toISOString();
    const entryId = uuidv4();
    const entry = { id: entryId, collectionId: req.params.slug, data, createdAt: now, updatedAt: now };
    await gcsFiles.saveEntry(req.params.siteId, req.params.slug, entryId, entry);

    // Update manifest entryCount
    await _updateManifestCollections(req.params.siteId);

    res.status(201).json({ entry });
  } catch (err) { _error(res, err); }
});

// GET /api/sites/:siteId/collections/:slug/entries/:entryId
router.get('/:slug/entries/:entryId', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const entry = await gcsFiles.getEntry(req.params.siteId, req.params.slug, req.params.entryId);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry });
  } catch (err) { _error(res, err); }
});

// PUT /api/sites/:siteId/collections/:slug/entries/:entryId
router.put('/:slug/entries/:entryId', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    const existing = await gcsFiles.getEntry(req.params.siteId, req.params.slug, req.params.entryId);
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const { data = {} } = req.body || {};
    const updated = {
      ...existing,
      data: { ...existing.data, ...data },
      updatedAt: new Date().toISOString(),
    };
    await gcsFiles.saveEntry(req.params.siteId, req.params.slug, req.params.entryId, updated);
    res.json({ entry: updated });
  } catch (err) { _error(res, err); }
});

// DELETE /api/sites/:siteId/collections/:slug/entries/:entryId
router.delete('/:slug/entries/:entryId', async (req, res) => {
  try {
    if (!await _requireSite(req, res)) return;
    await gcsFiles.deleteEntry(req.params.siteId, req.params.slug, req.params.entryId);
    await _updateManifestCollections(req.params.siteId);
    res.json({ deleted: true, entryId: req.params.entryId });
  } catch (err) { _error(res, err); }
});

// ── Manifest helper ───────────────────────────────────────────────────────────
async function _updateManifestCollections(siteId) {
  try {
    const collections = await gcsFiles.listCollections(siteId);
    const collectionsMeta = await Promise.all(
      collections.map(async col => {
        const entries = await gcsFiles.listEntries(siteId, col.slug);
        return { slug: col.slug, name: col.name, entryCount: entries.length };
      })
    );
    await gcsFiles.updateManifest(siteId, { collections: collectionsMeta });
  } catch (err) {
    console.warn('[collections] manifest update failed:', err.message);
  }
}

module.exports = router;
