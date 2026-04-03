'use strict';

const storage = require('../storage');
const mem     = require('./memory');
const cdn     = require('./cdn');

class CacheManager {
  /** Expose storage for route middleware that needs direct access. */
  get storage() { return storage; }

  /**
   * Get site HTML. Checks memory cache first, then storage.
   * @param {string} siteId
   * @returns {Promise<string|null>}
   */
  async getHtml(siteId) {
    const key = `html:${siteId}`;
    let html = mem.get(key);
    if (html !== null) return html;

    const site = await storage.getSite(siteId);
    if (!site) return null;
    html = site.html || '';
    mem.set(key, html);
    return html;
  }

  /**
   * Save new HTML for a site: persist → invalidate memory → purge CDN.
   * @param {string} siteId
   * @param {string} html
   * @returns {Promise<string>} revisionId
   */
  async save(siteId, html) {
    const site = await storage.getSite(siteId);
    if (!site) throw new Error('Site not found');

    const revisionId = await storage.saveSite(siteId, {
      ...site,
      html,
      updatedAt: new Date().toISOString(),
    });

    mem.invalidate(`html:${siteId}`);
    await cdn.purgeAll(siteId);

    return revisionId;
  }

  /**
   * Invalidate all cache layers for a site.
   * @param {string} siteId
   */
  async invalidate(siteId) {
    mem.invalidatePattern(`html:${siteId}`);
    await cdn.purgeAll(siteId);
  }

  /**
   * Memory cache stats.
   * @returns {{size: number, expired: number}}
   */
  stats() { return mem.stats(); }
}

module.exports = new CacheManager();
