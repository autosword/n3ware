'use strict';

const { Firestore } = require('@google-cloud/firestore');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const MAX_REVISIONS = 50;

class FirestoreStorage {
  constructor() {
    this._db = new Firestore({ projectId: config.firestoreProject });
  }

  _siteRef(id)       { return this._db.collection('sites').doc(id); }
  _revRef(id, revId) { return this._siteRef(id).collection('revisions').doc(revId); }

  /**
   * Get a site by id. Returns null if not found.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getSite(id) {
    const snap = await this._siteRef(id).get();
    return snap.exists ? snap.data() : null;
  }

  /**
   * Save (create or update) a site. Creates a revision when updating HTML.
   * @param {string} id
   * @param {object} data
   * @returns {Promise<string|null>} revisionId if created, else null
   */
  async saveSite(id, data) {
    const ref = this._siteRef(id);
    const existing = await ref.get();
    let revisionId = null;

    if (existing.exists && data.html !== undefined) {
      revisionId = uuidv4();
      await this._revRef(id, revisionId).set({
        id: revisionId,
        siteId: id,
        html: data.html,
        createdAt: new Date().toISOString(),
      });
      await this._pruneRevisions(id);
    }

    await ref.set({ ...data, id, updatedAt: new Date().toISOString() });
    return revisionId;
  }

  /**
   * Delete a site and all its revisions.
   * @param {string} id
   */
  async deleteSite(id) {
    const revSnap = await this._siteRef(id).collection('revisions').get();
    const batch = this._db.batch();
    revSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(this._siteRef(id));
    await batch.commit();
  }

  /**
   * List all sites (metadata only).
   * @returns {Promise<object[]>}
   */
  async listSites() {
    const snap = await this._db.collection('sites').get();
    return snap.docs.map(d => {
      const { html: _html, apiKey: _key, ...meta } = d.data();
      return meta;
    });
  }

  /**
   * Get a specific revision.
   * @param {string} siteId
   * @param {string} revId
   * @returns {Promise<object|null>}
   */
  async getRevision(siteId, revId) {
    const snap = await this._revRef(siteId, revId).get();
    return snap.exists ? snap.data() : null;
  }

  /**
   * List all revisions for a site, newest first.
   * @param {string} siteId
   * @returns {Promise<object[]>}
   */
  async listRevisions(siteId) {
    const snap = await this._siteRef(siteId)
      .collection('revisions')
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map(d => {
      const { html: _html, ...meta } = d.data();
      return meta;
    });
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

  // ── Private ──────────────────────────────────────────────────────────────

  async _pruneRevisions(siteId) {
    const snap = await this._siteRef(siteId)
      .collection('revisions')
      .orderBy('createdAt', 'desc')
      .offset(MAX_REVISIONS)
      .get();
    if (snap.empty) return;
    const batch = this._db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

module.exports = FirestoreStorage;
