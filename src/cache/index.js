'use strict';

/**
 * Cache coordinator.
 *
 * On GET:  memory cache → storage → populate memory cache → return
 * On SAVE: storage → invalidate memory → purge CDN
 *
 * Usage:
 *   const cache = require('./src/cache');
 *   const site  = await cache.getSite(storage, 'my-site');
 *   await cache.onSave('my-site');
 */

const MemoryCache = require('./memory');
const cdn         = require('./cdn');

const mem = new MemoryCache();

const KEY = {
  site:      id => `site:${id}`,
  revisions: id => `revisions:${id}`,
  siteList:  ()  => 'sites:list',
};

// ── Read-through helpers ────────────────────────────────────────────────────

/**
 * Get a site with memory-cache read-through.
 * @param {object} storage
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getSite(storage, id) {
  const k = KEY.site(id);
  const cached = mem.get(k);
  if (cached !== null) return cached;
  const site = await storage.getSite(id);
  if (site) mem.set(k, site);
  return site;
}

/**
 * Get revision list with memory-cache read-through.
 * @param {object} storage
 * @param {string} siteId
 * @returns {Promise<object[]>}
 */
async function listRevisions(storage, siteId) {
  const k = KEY.revisions(siteId);
  const cached = mem.get(k);
  if (cached !== null) return cached;
  const revs = await storage.listRevisions(siteId);
  mem.set(k, revs);
  return revs;
}

/**
 * Get site list with memory-cache read-through.
 * @param {object} storage
 * @returns {Promise<object[]>}
 */
async function listSites(storage) {
  const k = KEY.siteList();
  const cached = mem.get(k);
  if (cached !== null) return cached;
  const sites = await storage.listSites();
  mem.set(k, sites);
  return sites;
}

// ── Write-through helpers ───────────────────────────────────────────────────

/**
 * Invalidate all cache entries related to a site,
 * and trigger a CDN purge for the site's public URL.
 * @param {string} siteId
 * @param {string} [baseUrl]
 * @returns {Promise<void>}
 */
async function onSave(siteId, baseUrl = '') {
  mem.invalidate(KEY.site(siteId));
  mem.invalidate(KEY.revisions(siteId));
  mem.invalidate(KEY.siteList());
  await cdn.purgeSite(siteId, baseUrl).catch(err =>
    console.warn(`[cache] CDN purge failed for ${siteId}: ${err.message}`)
  );
}

/**
 * Invalidate cache entries for a deleted site.
 * @param {string} siteId
 */
function onDelete(siteId) {
  mem.invalidatePrefix(`site:${siteId}`);
  mem.invalidate(KEY.siteList());
}

/** Expose underlying memory cache for stats / direct access. */
const memory = mem;

module.exports = { getSite, listRevisions, listSites, onSave, onDelete, memory };
