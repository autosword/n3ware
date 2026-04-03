'use strict';

const fs   = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'sites');

class LocalStorage {
  constructor(dataDir) {
    this._dir = dataDir || DATA_DIR;
  }

  _sitePath(id)      { return path.join(this._dir, `${id}.json`); }
  _revDir(id)        { return path.join(this._dir, id, 'revisions'); }
  _revPath(id, revId){ return path.join(this._revDir(id), `${revId}.json`); }

  async _ensureRevDir(id) {
    await fs.mkdir(this._revDir(id), { recursive: true });
  }

  async _ensureDataDir() {
    await fs.mkdir(this._dir, { recursive: true });
  }

  /**
   * Get a site by id. Returns null if not found.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getSite(id) {
    try {
      const raw = await fs.readFile(this._sitePath(id), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Save (create or update) a site. Creates a revision when updating HTML.
   * @param {string} id
   * @param {object} data
   * @returns {Promise<string|null>} revisionId if a revision was created, else null
   */
  async saveSite(id, data) {
    await this._ensureDataDir();
    await this._ensureRevDir(id);

    const existing = await this.getSite(id);
    let revisionId = null;

    if (existing && data.html !== undefined) {
      revisionId = uuidv4();
      const rev = {
        id: revisionId,
        siteId: id,
        html: data.html,
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(this._revPath(id, revisionId), JSON.stringify(rev, null, 2));
    }

    const site = { ...data, id, updatedAt: new Date().toISOString() };
    await fs.writeFile(this._sitePath(id), JSON.stringify(site, null, 2));

    return revisionId;
  }

  /**
   * Delete a site and all its revisions.
   * @param {string} id
   */
  async deleteSite(id) {
    try { await fs.unlink(this._sitePath(id)); } catch { /* ignore */ }
    try {
      await fs.rm(path.join(this._dir, id), { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  /**
   * List all sites (metadata only, no html).
   * @returns {Promise<object[]>}
   */
  async listSites() {
    await this._ensureDataDir();
    const entries = await fs.readdir(this._dir, { withFileTypes: true });
    const sites = [];
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.json')) {
        try {
          const raw = await fs.readFile(path.join(this._dir, e.name), 'utf8');
          const { html: _html, apiKey: _key, ...meta } = JSON.parse(raw);
          sites.push(meta);
        } catch { /* skip corrupt files */ }
      }
    }
    return sites;
  }

  /**
   * Get a specific revision.
   * @param {string} siteId
   * @param {string} revId
   * @returns {Promise<object|null>}
   */
  async getRevision(siteId, revId) {
    try {
      const raw = await fs.readFile(this._revPath(siteId, revId), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * List all revisions for a site, newest first.
   * @param {string} siteId
   * @returns {Promise<object[]>}
   */
  async listRevisions(siteId) {
    try {
      const files = await fs.readdir(this._revDir(siteId));
      const revs = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(this._revDir(siteId), f), 'utf8');
          const { html: _html, ...meta } = JSON.parse(raw);
          revs.push(meta);
        } catch { /* skip */ }
      }
      return revs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch {
      return [];
    }
  }

  /**
   * Roll back a site to a specific revision (creates a new revision).
   * @param {string} siteId
   * @param {string} revId
   * @returns {Promise<string>} new revisionId
   */
  async rollback(siteId, revId) {
    const rev  = await this.getRevision(siteId, revId);
    if (!rev) throw new Error('Revision not found');
    const site = await this.getSite(siteId);
    if (!site) throw new Error('Site not found');
    return this.saveSite(siteId, { ...site, html: rev.html });
  }
}

module.exports = LocalStorage;
