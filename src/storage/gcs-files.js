'use strict';

/**
 * GCS file storage adapter — v2 architecture.
 *
 * Stores site content as discrete files in Google Cloud Storage:
 *
 *   gs://n3ware-sites/{siteId}/
 *     site.json          — manifest (pages list, theme, integrations, metadata)
 *     header.html        — shared header component
 *     nav.html           — shared nav component
 *     footer.html        — shared footer component
 *     pages/
 *       index.html       — home page body
 *       {slug}.html      — other page bodies
 *
 * Object versioning is enabled on the bucket so every write creates a new
 * generation, enabling rollbacks without a separate revisions collection.
 */

const { Storage } = require('@google-cloud/storage');
const config = require('../config');

const BUCKET = process.env.GCS_SITES_BUCKET || 'n3ware-sites';

let _storage = null;
function _gcs() {
  if (!_storage) {
    _storage = new Storage({ projectId: config.gcpProject });
  }
  return _storage;
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

async function _read(path) {
  const [contents] = await _gcs().bucket(BUCKET).file(path).download();
  return contents.toString('utf8');
}

async function _readOrNull(path) {
  try {
    return await _read(path);
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

async function _write(path, content, contentType = 'text/html; charset=utf-8') {
  const file = _gcs().bucket(BUCKET).file(path);
  await file.save(content, {
    contentType,
    metadata: { cacheControl: 'no-store' },
  });
}

async function _readManifest(siteId) {
  const raw = await _readOrNull(`${siteId}/site.json`);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function _writeManifest(siteId, manifest) {
  await _write(`${siteId}/site.json`, JSON.stringify(manifest, null, 2), 'application/json');
}

// ── HTML decomposer ───────────────────────────────────────────────────────────

/**
 * Decomposes a full HTML page into structural components.
 * Extracts <header>, <nav>, <footer> elements if present.
 * Returns { header, nav, footer, body }.
 * @param {string} html
 * @returns {{ header: string, nav: string, footer: string, body: string }}
 */
function _decompose(html) {
  const extract = (tag) => {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
    const m = html.match(re);
    return m ? m[0] : '';
  };

  const header = extract('header');
  const nav    = extract('nav');
  const footer = extract('footer');

  // Body = everything inside <body> minus header/nav/footer
  let body = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    body = bodyMatch[1];
  }

  // Remove extracted components from body
  if (header) body = body.replace(header, '');
  if (nav)    body = body.replace(nav, '');
  if (footer) body = body.replace(footer, '');

  return {
    header: header.trim(),
    nav:    nav.trim(),
    footer: footer.trim(),
    body:   body.trim(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new site from template HTML.
 * Decomposes the HTML into components and writes all files to GCS.
 * Creates a site.json manifest with a single "index" page.
 *
 * @param {string} siteId
 * @param {string} name
 * @param {string|null} ownerId
 * @param {string} templateHtml  Full HTML of the starting template
 * @returns {Promise<object>}    The site manifest
 */
async function createSite(siteId, name, ownerId, templateHtml = '', apiKey = '') {
  const now = new Date().toISOString();
  const parts = _decompose(templateHtml);

  const manifest = {
    id: siteId,
    name,
    ownerId: ownerId || null,
    apiKey:  apiKey  || null,
    theme: {
      colors:    { primary: '#3B82F6', secondary: '#8B5CF6', accent: '#F59E0B' },
      logoUrl:   null,
      faviconUrl: null,
      fonts:     { heading: 'system', body: 'system' },
      sizes:     { h1: 60, h2: 48, h3: 36, h4: 28, h5: 22, h6: 18, body: 16 },
    },
    pages: [
      { slug: 'index', title: 'Home', path: '/' },
    ],
    subscription: {
      status:               'none',
      plan:                 'free',
      stripeCustomerId:     null,
      stripeSubscriptionId: null,
      currentPeriodEnd:     null,
      limits:               { pages: 4, uploads: 5 },
    },
    headScripts:  [],
    bodyScripts:  [],
    createdAt:    now,
    updatedAt:    now,
  };

  // Write all files in parallel
  await Promise.all([
    _writeManifest(siteId, manifest),
    _write(`${siteId}/header.html`, parts.header),
    _write(`${siteId}/nav.html`,    parts.nav),
    _write(`${siteId}/footer.html`, parts.footer),
    _write(`${siteId}/pages/index.html`, parts.body),
  ]);

  return manifest;
}

/**
 * Save (create or update) a single page's body HTML.
 * Also updates the manifest if the page is new.
 *
 * @param {string} siteId
 * @param {string} slug    URL slug (e.g. "about", "index")
 * @param {string} html    Page body HTML (not a full document)
 * @param {string} [title] Page title for the manifest
 * @returns {Promise<void>}
 */
async function savePage(siteId, slug, html, title = '') {
  // Sanitize slug
  const safeSlug = slug.replace(/[^a-z0-9-]/g, '-').toLowerCase();

  await _write(`${siteId}/pages/${safeSlug}.html`, html);

  // Update manifest if this page is new
  const manifest = await _readManifest(siteId);
  if (!manifest) return;

  const exists = manifest.pages.some(p => p.slug === safeSlug);
  if (!exists) {
    const path = safeSlug === 'index' ? '/' : `/${safeSlug}`;
    manifest.pages.push({ slug: safeSlug, title: title || safeSlug, path });
    manifest.updatedAt = new Date().toISOString();
    await _writeManifest(siteId, manifest);
  }
}

/**
 * Remove a page from GCS and the manifest.
 * The index page cannot be deleted.
 *
 * @param {string} siteId
 * @param {string} slug
 * @returns {Promise<void>}
 */
async function deletePage(siteId, slug) {
  if (slug === 'index') throw new Error('Cannot delete the index page');

  await Promise.all([
    _gcs().bucket(BUCKET).file(`${siteId}/pages/${slug}.html`).delete({ ignoreNotFound: true }),
  ]);

  const manifest = await _readManifest(siteId);
  if (!manifest) return;

  manifest.pages = manifest.pages.filter(p => p.slug !== slug);
  manifest.updatedAt = new Date().toISOString();
  await _writeManifest(siteId, manifest);
}

/**
 * Save a shared component (header, nav, or footer).
 *
 * @param {string} siteId
 * @param {'header'|'nav'|'footer'} name
 * @param {string} html
 * @returns {Promise<void>}
 */
async function saveComponent(siteId, name, html) {
  const allowed = ['header', 'nav', 'footer'];
  if (!allowed.includes(name)) throw new Error(`Unknown component: ${name}`);
  await _write(`${siteId}/${name}.html`, html);
}

/**
 * Get a shared component's HTML.
 *
 * @param {string} siteId
 * @param {'header'|'nav'|'footer'} name
 * @returns {Promise<string|null>}
 */
async function getComponent(siteId, name) {
  const allowed = ['header', 'nav', 'footer'];
  if (!allowed.includes(name)) throw new Error(`Unknown component: ${name}`);
  return _readOrNull(`${siteId}/${name}.html`);
}

/**
 * Get all components for a site.
 *
 * @param {string} siteId
 * @returns {Promise<{ header: string, nav: string, footer: string }>}
 */
async function getComponents(siteId) {
  const [header, nav, footer] = await Promise.all([
    _readOrNull(`${siteId}/header.html`),
    _readOrNull(`${siteId}/nav.html`),
    _readOrNull(`${siteId}/footer.html`),
  ]);
  return {
    header: header || '',
    nav:    nav    || '',
    footer: footer || '',
  };
}

/**
 * Get a page's body HTML.
 *
 * @param {string} siteId
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
async function getPage(siteId, slug) {
  const safeSlug = slug.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  return _readOrNull(`${siteId}/pages/${safeSlug}.html`);
}

/**
 * Get the site manifest.
 *
 * @param {string} siteId
 * @returns {Promise<object|null>}
 */
async function getManifest(siteId) {
  return _readManifest(siteId);
}

/**
 * Update fields in the site manifest (theme, headScripts, bodyScripts, name).
 *
 * @param {string} siteId
 * @param {object} updates
 * @returns {Promise<object>} updated manifest
 */
async function updateManifest(siteId, updates) {
  const manifest = await _readManifest(siteId);
  if (!manifest) throw new Error(`Site ${siteId} not found in GCS`);

  const allowed = ['name', 'theme', 'headScripts', 'bodyScripts'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      manifest[key] = updates[key];
    }
  }
  manifest.updatedAt = new Date().toISOString();
  await _writeManifest(siteId, manifest);
  return manifest;
}

/**
 * List all GCS object versions (generations) for a page file.
 * Used to implement rollback.
 *
 * @param {string} siteId
 * @param {string} slug
 * @returns {Promise<Array<{ generation: string, timeCreated: string, size: number }>>}
 */
async function getPageVersions(siteId, slug) {
  const safeSlug = slug.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  const [files] = await _gcs().bucket(BUCKET).getFiles({
    prefix:   `${siteId}/pages/${safeSlug}.html`,
    versions: true,
  });

  return files.map(f => ({
    generation:  f.metadata.generation,
    timeCreated: f.metadata.timeCreated,
    size:        parseInt(f.metadata.size || '0', 10),
  })).sort((a, b) => b.generation - a.generation);
}

/**
 * Restore a page to a previous GCS generation (rollback).
 *
 * @param {string} siteId
 * @param {string} slug
 * @param {string} generation  GCS object generation number
 * @returns {Promise<void>}
 */
async function rollbackPage(siteId, slug, generation) {
  const safeSlug = slug.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  const path = `${siteId}/pages/${safeSlug}.html`;

  // Read the old generation
  const [contents] = await _gcs()
    .bucket(BUCKET)
    .file(path, { generation })
    .download();

  // Write it as the new current version (creates a new generation)
  await _write(path, contents.toString('utf8'));
}

module.exports = {
  createSite,
  savePage,
  deletePage,
  saveComponent,
  getComponent,
  getComponents,
  getPage,
  getManifest,
  updateManifest,
  getPageVersions,
  rollbackPage,
};
