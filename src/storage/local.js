'use strict';

/**
 * Local JSON file storage — development backend.
 *
 * Directory layout:
 *   data/sites/<siteId>/site.json          — current site data
 *   data/sites/<siteId>/revisions/<ts>.json — revision snapshots
 */

const fs   = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');

const MAX_REVISIONS = 50;

class LocalStorage {
  constructor(dataDir = config.dataDir) {
    this._root = path.resolve(dataDir);
    fs.mkdirSync(this._root, { recursive: true });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _siteDir(id)   { return path.join(this._root, id); }
  _sitePath(id)  { return path.join(this._siteDir(id), 'site.json'); }
  _revDir(id)    { return path.join(this._siteDir(id), 'revisions'); }
  _revPath(id, revId) { return path.join(this._revDir(id), `${revId}.json`); }

  _readJSON(p) {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  _writeJSON(p, data) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  }

  // ── Sites ─────────────────────────────────────────────────────────────────

  /**
   * Fetch a site by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getSite(id) {
    return this._readJSON(this._sitePath(id));
  }

  /**
   * Save (create or update) a site. Automatically creates a revision.
   * @param {string} id
   * @param {{html:string, css?:string, message?:string}} data
   * @returns {object} saved site record
   */
  saveSite(id, { html, css = '', message = '', name, ownerId, apiKey, subdomain, subscription } = {}) {
    const now = new Date().toISOString();
    const existing = this.getSite(id);
    const site = {
      id,
      html,
      css,
      message,
      name:         name         !== undefined ? name         : (existing ? existing.name         : 'Untitled Site'),
      ownerId:      ownerId      !== undefined ? ownerId      : (existing ? existing.ownerId      : null),
      apiKey:       apiKey       !== undefined ? apiKey       : (existing ? existing.apiKey       : null),
      subdomain:    subdomain    !== undefined ? subdomain    : (existing ? existing.subdomain    : null),
      subscription: subscription !== undefined ? subscription : (existing ? existing.subscription : null),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    this._writeJSON(this._sitePath(id), site);
    this._createRevision(id, { html, css, message });
    return site;
  }

  /**
   * Delete a site and all its revisions.
   * @param {string} id
   */
  deleteSite(id) {
    const dir = this._siteDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  /**
   * List all site records (metadata only, no HTML body).
   * @returns {object[]}
   */
  /**
   * Partially update fields on a site record without creating a revision.
   * @param {string} id
   * @param {object} fields
   */
  updateSiteFields(id, fields) {
    const existing = this.getSite(id);
    if (!existing) throw new Error(`Site ${id} not found`);
    const updated = { ...existing, ...fields, updatedAt: new Date().toISOString() };
    this._writeJSON(this._sitePath(id), updated);
  }

  findSiteByApiKey(apiKey) {
    if (!fs.existsSync(this._root)) return null;
    for (const d of fs.readdirSync(this._root)) {
      const site = this._readJSON(this._sitePath(d));
      if (site && site.apiKey === apiKey) return site;
    }
    return null;
  }

  listSites({ ownerId } = {}) {
    if (!fs.existsSync(this._root)) return [];
    return fs.readdirSync(this._root)
      .filter(d => fs.existsSync(this._sitePath(d)))
      .map(d => {
        const site = this._readJSON(this._sitePath(d));
        if (!site) return null;
        if (ownerId && site.ownerId !== ownerId) return null;
        const { html: _html, ...meta } = site; // eslint-disable-line no-unused-vars
        // Count revisions
        const revDir = this._revDir(d);
        meta.revisionCount = fs.existsSync(revDir)
          ? fs.readdirSync(revDir).filter(f => f.endsWith('.json')).length
          : 0;
        return meta;
      })
      .filter(Boolean);
  }

  // ── Revisions ─────────────────────────────────────────────────────────────

  /**
   * Retrieve a specific revision.
   * @param {string} siteId
   * @param {string} revId
   * @returns {object|null}
   */
  getRevision(siteId, revId) {
    return this._readJSON(this._revPath(siteId, revId));
  }

  /**
   * List all revisions for a site, newest first.
   * @param {string} siteId
   * @returns {object[]}
   */
  listRevisions(siteId) {
    const dir = this._revDir(siteId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const rev = this._readJSON(path.join(dir, f));
        if (!rev) return null;
        const { html: _html, ...meta } = rev; // eslint-disable-line no-unused-vars
        return meta;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Roll back a site to a given revision.
   * Creates a new revision (the rollback itself is recorded).
   * @param {string} siteId
   * @param {string} revId
   * @returns {object} new site record
   */
  rollback(siteId, revId) {
    const rev = this.getRevision(siteId, revId);
    if (!rev) throw new Error(`Revision ${revId} not found for site ${siteId}`);
    return this.saveSite(siteId, {
      html:    rev.html,
      css:     rev.css || '',
      message: `Rolled back to ${revId}`,
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _createRevision(siteId, { html, css, message }) {
    const revId = `${Date.now()}-${uuid().split('-')[0]}`;
    const rev = {
      id:        revId,
      siteId,
      html,
      css:       css || '',
      message:   message || '',
      createdAt: new Date().toISOString(),
    };
    this._writeJSON(this._revPath(siteId, revId), rev);
    this._pruneRevisions(siteId);
    return rev;
  }

  _pruneRevisions(siteId) {
    const dir = this._revDir(siteId);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort(); // ascending by timestamp prefix
    if (files.length > MAX_REVISIONS) {
      files.slice(0, files.length - MAX_REVISIONS).forEach(f =>
        fs.unlinkSync(path.join(dir, f))
      );
    }
  }
}

module.exports = LocalStorage;
