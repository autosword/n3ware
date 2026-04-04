'use strict';

/**
 * User storage — local JSON file backend.
 *
 * Schema (users.json): { users: [ { id, email, passwordHash, createdAt } ] }
 */

const fs   = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');

class UserStore {
  constructor(filePath = config.usersFile) {
    this._file = path.resolve(filePath);
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this._file)) {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      fs.writeFileSync(this._file, JSON.stringify({ users: [] }, null, 2), 'utf8');
    }
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this._file, 'utf8'));
    } catch {
      return { users: [] };
    }
  }

  _write(data) {
    fs.writeFileSync(this._file, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Create a new user. Throws if email already registered.
   * @param {string} email
   * @param {string} passwordHash  bcrypt hash
   * @returns {{ id, email, createdAt }}
   */
  createUser(email, passwordHash) {
    const data = this._read();
    if (data.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('Email already registered');
    }
    const user = {
      id:           uuid(),
      email:        email.toLowerCase(),
      passwordHash,
      createdAt:    new Date().toISOString(),
    };
    data.users.push(user);
    this._write(data);
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  /**
   * Find a user by email (case-insensitive). Returns full record including hash.
   * @param {string} email
   * @returns {object|null}
   */
  getUserByEmail(email) {
    const data = this._read();
    return data.users.find(u => u.email === email.toLowerCase()) || null;
  }

  /**
   * Find a user by ID. Returns public record (no hash).
   * @param {string} id
   * @returns {{ id, email, createdAt }|null}
   */
  getUserById(id) {
    const data = this._read();
    const user = data.users.find(u => u.id === id);
    if (!user) return null;
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  /**
   * Update arbitrary fields on a user record.
   * @param {string} id
   * @param {object} fields  Fields to merge (passwordHash excluded from return value)
   * @returns {{ id, email, createdAt }|null}
   */
  updateUser(id, fields) {
    const data = this._read();
    const idx  = data.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    data.users[idx] = { ...data.users[idx], ...fields };
    this._write(data);
    const u = data.users[idx];
    return { id: u.id, email: u.email, createdAt: u.createdAt };
  }
}

// ── Firestore-backed user store (production) ──────────────────────────────────

class FirestoreUserStore {
  constructor() {
    const { Firestore } = require('@google-cloud/firestore');
    this._db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'n3ware' });
    this._col = this._db.collection('users');
  }

  async _findByEmail(email) {
    const snap = await this._col.where('email', '==', email.toLowerCase()).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async getUserByEmail(email) {
    return this._findByEmail(email);
  }

  async createUser(email, _passwordHash) {
    // Check for existing first to stay idempotent
    const existing = await this._findByEmail(email);
    if (existing) return existing;
    const { v4: uuid } = require('uuid');
    const id  = uuid();
    const now = new Date().toISOString();
    const data = { email: email.toLowerCase(), createdAt: now };
    await this._col.doc(id).set(data);
    return { id, ...data };
  }

  async getUserById(id) {
    const doc = await this._col.doc(id).get();
    if (!doc.exists) return null;
    const d = doc.data();
    return { id: doc.id, email: d.email, createdAt: d.createdAt };
  }

  async updateUser(id, fields) {
    const ref = this._col.doc(id);
    await ref.update(fields);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const d = doc.data();
    return { id: doc.id, email: d.email, createdAt: d.createdAt };
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

let _instance = null;
function getUserStore() {
  if (!_instance) {
    _instance = process.env.STORAGE_BACKEND === 'firestore'
      ? new FirestoreUserStore()
      : new UserStore();
  }
  return _instance;
}
function resetUserStore() { _instance = null; }

module.exports = getUserStore();
module.exports.getUserStore = getUserStore;
module.exports.resetUserStore = resetUserStore;
