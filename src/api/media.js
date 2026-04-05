'use strict';

/**
 * Media manager API routes.
 *
 * Mounted at /api/sites/:id/media (mergeParams: true)
 *
 * GET  /              — list all assets with usage info
 * DELETE /:assetId    — delete an asset (409 if in use, unless ?force=true)
 */

const crypto       = require('crypto');
const express      = require('express');
const storageCloud = require('../integrations/storage-cloud');
const gcsFiles     = require('../storage/gcs-files');
const storage      = require('../storage');
const { authOrApiKey } = require('./auth');

const router = express.Router({ mergeParams: true });

// GCS_ENABLED: usage scanning only works when GCS_SITES_BUCKET or GCS_BUCKET is set
const GCS_ENABLED = Boolean(process.env.GCS_SITES_BUCKET || process.env.GCS_BUCKET);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _safeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) {
      crypto.timingSafeEqual(ba, ba);
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Auth guard: verify the request has access to the site.
 * Returns the site doc or sends an error response and returns null.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<object|null>}
 */
async function _requireSite(req, res) {
  const site = await storage.getSite(req.params.id);
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return null;
  }
  if (req.authType === 'jwt' && req.user && site.ownerId && site.ownerId !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  if (req.authType === 'sitekey') {
    if (!_safeEqual(req.providedApiKey, site.apiKey)) {
      res.status(403).json({ error: 'Invalid site API key' });
      return null;
    }
  }
  return site;
}

/**
 * Derive a deterministic 16-char hex ID from a filename.
 * @param {string} filename
 * @returns {string}
 */
function _assetId(filename) {
  return crypto.createHash('sha256').update(filename).digest('hex').slice(0, 16);
}

/**
 * Guess content type from a filename extension.
 * @param {string} filename
 * @returns {string}
 */
function _guessContentType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    jpg:   'image/jpeg',
    jpeg:  'image/jpeg',
    png:   'image/png',
    gif:   'image/gif',
    webp:  'image/webp',
    svg:   'image/svg+xml',
    avif:  'image/avif',
    bmp:   'image/bmp',
    ico:   'image/x-icon',
    pdf:   'application/pdf',
    woff:  'font/woff',
    woff2: 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Normalize a URL for comparison: strip query/fragment, lowercase.
 * @param {string} u
 * @returns {string}
 */
function _norm(u) {
  return (u || '').split('?')[0].split('#')[0].toLowerCase();
}

/**
 * Extract all candidate URLs / filenames from an HTML string.
 * Covers: src=, href=, content=, url(...) in inline styles, JSON string values
 * with image extensions.
 * @param {string} html
 * @returns {string[]}
 */
function _extractUrls(html) {
  if (!html) return [];
  const results = [];

  // src=, href=, content= attributes (single or double quoted)
  const attrRe = /(?:src|href|content)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(html)) !== null) results.push(m[1]);

  // url(...) in inline styles
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = urlRe.exec(html)) !== null) results.push(m[1]);

  // JSON string values that look like image/font/pdf paths
  const jsonRe = /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp|svg|avif|bmp|ico|pdf|woff2?))"/gi;
  while ((m = jsonRe.exec(html)) !== null) results.push(m[1]);

  return results;
}

/**
 * Check whether a candidate URL/filename refers to the given asset.
 * @param {string} candidate   — value pulled from HTML
 * @param {string} assetUrl    — full URL of the asset
 * @param {string} filename    — bare filename of the asset
 * @returns {boolean}
 */
function _matches(candidate, assetUrl, filename) {
  const nc = _norm(candidate);
  const na = _norm(assetUrl);
  if (nc === na) return true;
  if (nc.endsWith('/' + filename.toLowerCase())) return true;
  // Also check bare filename substring for inline text / JSON blobs
  if (nc === filename.toLowerCase()) return true;
  return false;
}

/**
 * Scan all GCS content for references to the given asset.
 * Returns [] immediately if GCS is not enabled.
 *
 * @param {string} siteId
 * @param {string} assetUrl
 * @param {string} filename
 * @returns {Promise<Array<{type:string, slug?:string, title?:string, field?:string, name?:string}>>}
 */
async function _scanUsages(siteId, assetUrl, filename) {
  if (!GCS_ENABLED) return [];

  const usages = [];

  try {
    // ── Manifest (theme.logoUrl / theme.faviconUrl) ───────────────────────
    let manifest = null;
    try {
      manifest = await gcsFiles.getManifest(siteId);
    } catch {
      manifest = null;
    }

    if (manifest && manifest.theme) {
      if (_matches(manifest.theme.logoUrl, assetUrl, filename)) {
        usages.push({ type: 'theme', field: 'logoUrl' });
      }
      if (_matches(manifest.theme.faviconUrl, assetUrl, filename)) {
        usages.push({ type: 'theme', field: 'faviconUrl' });
      }
    }

    // ── Pages ─────────────────────────────────────────────────────────────
    const pages = (manifest && Array.isArray(manifest.pages)) ? manifest.pages : [];
    for (const page of pages) {
      try {
        const html = await gcsFiles.getPage(siteId, page.slug);
        if (!html) continue;
        const candidates = _extractUrls(html);
        const found = candidates.some(c => _matches(c, assetUrl, filename));
        if (!found) {
          // Also scan raw text for bare filename
          if (html.toLowerCase().includes(filename.toLowerCase())) {
            usages.push({ type: 'page', slug: page.slug, title: page.title || page.slug });
            continue;
          }
        }
        if (found) {
          usages.push({ type: 'page', slug: page.slug, title: page.title || page.slug });
        }
      } catch {
        // Skip unreadable pages
      }
    }

    // ── Components (header, nav, footer) ─────────────────────────────────
    let components = null;
    try {
      components = await gcsFiles.getComponents(siteId);
    } catch {
      components = null;
    }

    if (components) {
      for (const name of ['header', 'nav', 'footer']) {
        const html = components[name];
        if (!html) continue;
        try {
          const candidates = _extractUrls(html);
          const found = candidates.some(c => _matches(c, assetUrl, filename));
          if (found || html.toLowerCase().includes(filename.toLowerCase())) {
            usages.push({ type: 'component', name });
          }
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Resilient — return what we have so far
  }

  return usages;
}

// ---------------------------------------------------------------------------
// Apply auth to all routes
// ---------------------------------------------------------------------------
router.use(authOrApiKey);

// ---------------------------------------------------------------------------
// GET / — list all assets
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const site = await _requireSite(req, res);
    if (!site) return;

    const siteId = req.params.id;
    const files  = await storageCloud.listFiles(siteId);

    const items = await Promise.all(files.map(async (file) => {
      const usages = await _scanUsages(siteId, file.url, file.name);
      return {
        id:          _assetId(file.name),
        url:         file.url,
        filename:    file.name,
        sizeBytes:   file.size,
        uploadedAt:  file.lastModified,
        contentType: _guessContentType(file.name),
        usages,
      };
    }));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:assetId — delete an asset
// ---------------------------------------------------------------------------
router.delete('/:assetId', async (req, res) => {
  try {
    const site = await _requireSite(req, res);
    if (!site) return;

    const siteId  = req.params.id;
    const assetId = req.params.assetId;
    const force   = req.query.force === 'true';

    // Re-lookup the file by matching the deterministic hash of its name
    const files = await storageCloud.listFiles(siteId);
    const file  = files.find(f => _assetId(f.name) === assetId);

    if (!file) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Check usages unless force=true
    if (!force) {
      const usages = await _scanUsages(siteId, file.url, file.name);
      if (usages.length > 0) {
        return res.status(409).json({
          error:    'asset in use',
          filename: file.name,
          usages,
        });
      }
    }

    await storageCloud.deleteFile(siteId, file.name);
    res.json({ deleted: true, filename: file.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
