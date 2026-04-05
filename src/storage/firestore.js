'use strict';

/**
 * Google Cloud Firestore storage backend.
 *
 * Collection layout:
 *   sites/{siteId}                     — site document
 *   sites/{siteId}/revisions/{revId}   — revision sub-documents
 */

const { Firestore } = require('@google-cloud/firestore');
const { v4: uuid } = require('uuid');
const config = require('../config');

const MAX_REVISIONS = 50;

class FirestoreStorage {
  constructor(projectId = config.gcpProject) {
    this._db = new Firestore({ projectId, ignoreUndefinedProperties: true });
    this._sites = this._db.collection('sites');
  }

  // ── Sites ─────────────────────────────────────────────────────────────────

  /**
   * Fetch a site by ID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getSite(id) {
    const doc = await this._sites.doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  /**
   * Save (create or update) a site. Automatically creates a revision.
   * @param {string} id
   * @param {{html:string, css?:string, message?:string}} data
   * @returns {Promise<object>} saved site record
   */
  async saveSite(id, { html, css = '', message = '', name, ownerId, apiKey } = {}) {
    const now = new Date().toISOString();
    const existing = await this.getSite(id);
    const site = {
      id,
      html,
      css,
      message,
      name:      name      !== undefined ? name      : (existing ? existing.name      : 'Untitled Site'),
      ownerId:   ownerId   !== undefined ? ownerId   : (existing ? existing.ownerId   : null),
      apiKey:    apiKey    !== undefined ? apiKey    : (existing ? existing.apiKey    : null),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    await this._sites.doc(id).set(site);
    await this._createRevision(id, { html, css, message });
    return site;
  }

  /**
   * Delete a site and all its revisions.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteSite(id) {
    const revSnap = await this._sites.doc(id).collection('revisions').listDocuments();
    const batch = this._db.batch();
    revSnap.forEach(ref => batch.delete(ref));
    batch.delete(this._sites.doc(id));
    await batch.commit();
  }

  /**
   * List all sites (metadata only).
   * @returns {Promise<object[]>}
   */
  async findSiteByApiKey(apiKey) {
    const snap = await this._sites.where('apiKey', '==', apiKey).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async listSites(filter = {}) {
    // Do NOT use .select() with 'id' — it is not a valid Firestore field path
    // for field masks and causes INVALID_ARGUMENT. Use d.id from the snapshot.
    let query = filter.ownerId
      ? this._sites.where('ownerId', '==', filter.ownerId)
      : this._sites;
    const snap = await query.get();
    return snap.docs.map(d => {
      const { html: _html, ...meta } = d.data(); // exclude html from list
      return { id: d.id, ...meta };
    });
  }

  // ── Revisions ─────────────────────────────────────────────────────────────

  /**
   * Get a specific revision.
   * @param {string} siteId
   * @param {string} revId
   * @returns {Promise<object|null>}
   */
  async getRevision(siteId, revId) {
    const doc = await this._sites.doc(siteId).collection('revisions').doc(revId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  /**
   * List all revisions for a site, newest first.
   * @param {string} siteId
   * @returns {Promise<object[]>}
   */
  async listRevisions(siteId) {
    // Do NOT use .select('id', ...) — 'id' is not a valid Firestore field path
    // for field masks and causes INVALID_ARGUMENT. Exclude html manually instead.
    const snap = await this._sites.doc(siteId)
      .collection('revisions')
      .orderBy('createdAt', 'desc')
      .limit(MAX_REVISIONS)
      .get();
    return snap.docs.map(d => {
      const { html: _html, ...meta } = d.data(); // exclude html — can be large
      return { id: d.id, ...meta };
    });
  }

  /**
   * Roll back a site to a given revision.
   * @param {string} siteId
   * @param {string} revId
   * @returns {Promise<object>}
   */
  async rollback(siteId, revId) {
    const rev = await this.getRevision(siteId, revId);
    if (!rev) throw new Error(`Revision ${revId} not found for site ${siteId}`);
    return this.saveSite(siteId, {
      html:    rev.html,
      css:     rev.css || '',
      message: `Rolled back to ${revId}`,
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async _createRevision(siteId, { html, css, message }) {
    const revId = `${Date.now()}-${uuid().split('-')[0]}`;
    const rev = {
      id:        revId,
      siteId,
      html,
      css:       css || '',
      message:   message || '',
      createdAt: new Date().toISOString(),
    };
    await this._sites.doc(siteId).collection('revisions').doc(revId).set(rev);
    await this._pruneRevisions(siteId);
    return rev;
  }

  async _pruneRevisions(siteId) {
    const snap = await this._sites.doc(siteId)
      .collection('revisions')
      .orderBy('createdAt', 'asc')
      .get();
    if (snap.size <= MAX_REVISIONS) return;
    const toDelete = snap.docs.slice(0, snap.size - MAX_REVISIONS);
    const batch = this._db.batch();
    toDelete.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

module.exports = FirestoreStorage;
