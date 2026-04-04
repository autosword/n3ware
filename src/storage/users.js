'use strict';

/**
 * User storage — local JSON file or Firestore backend.
 *
 * All methods are async so callers work identically against both backends.
 *
 * Local schema (users.json): { users: [ { id, email, passwordHash, createdAt } ] }
 * Firestore schema: collection 'users', doc id = user.id
 */

const fs   = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('../config');

// ── Local file backend ────────────────────────────────────────────────────────

class LocalUserStore {
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

  async createUser(email, passwordHash) {
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

  async getUserByEmail(email) {
    const data = this._read();
    return data.users.find(u => u.email === email.toLowerCase()) || null;
  }

  async getUserById(id) {
    const data = this._read();
    const user = data.users.find(u => u.id === id);
    if (!user) return null;
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  async updateUser(id, fields) {
    const data = this._read();
    const idx  = data.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    data.users[idx] = { ...data.users[idx], ...fields };
    this._write(data);
    const u = data.users[idx];
    return { id: u.id, email: u.email, createdAt: u.createdAt };
  }
}

// ── Firestore backend ─────────────────────────────────────────────────────────

class FirestoreUserStore {
  constructor() {
    const { Firestore } = require('@google-cloud/firestore');
    this._db  = new Firestore({ projectId: config.gcpProject, ignoreUndefinedProperties: true });
    this._col = this._db.collection('users');
  }

  async createUser(email, passwordHash) {
    const lower    = email.toLowerCase();
    const existing = await this.getUserByEmail(lower);
    if (existing) throw new Error('Email already registered');
    const user = {
      id:           uuid(),
      email:        lower,
      passwordHash,
      createdAt:    new Date().toISOString(),
    };
    await this._col.doc(user.id).set(user);
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  async getUserByEmail(email) {
    const snap = await this._col
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data();
  }

  async getUserById(id) {
    const doc = await this._col.doc(id).get();
    if (!doc.exists) return null;
    const u = doc.data();
    return { id: u.id, email: u.email, createdAt: u.createdAt };
  }

  async updateUser(id, fields) {
    const doc = await this._col.doc(id).get();
    if (!doc.exists) return null;
    await this._col.doc(id).update(fields);
    const updated = (await this._col.doc(id).get()).data();
    return { id: updated.id, email: updated.email, createdAt: updated.createdAt };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _instance = null;

function getUserStore() {
  if (!_instance) {
    _instance = config.storageBackend === 'firestore'
      ? new FirestoreUserStore()
      : new LocalUserStore();
  }
  return _instance;
}

function resetUserStore() { _instance = null; }

module.exports = getUserStore();
module.exports.getUserStore   = getUserStore;
module.exports.resetUserStore = resetUserStore;
