'use strict';

/**
 * Storage factory.
 * Returns a LocalStorage or FirestoreStorage instance based on STORAGE_BACKEND env var.
 *
 * Usage:
 *   const storage = require('./src/storage');
 *   const site = await storage.getSite('my-site');
 */

const config = require('../config');

let _instance = null;

function createStorage() {
  const backend = config.storageBackend;
  if (backend === 'firestore') {
    const FirestoreStorage = require('./firestore');
    return new FirestoreStorage();
  }
  const LocalStorage = require('./local');
  return new LocalStorage();
}

/**
 * Returns the singleton storage instance.
 * Instantiated lazily on first call.
 * @returns {LocalStorage|FirestoreStorage}
 */
function getStorage() {
  if (!_instance) _instance = createStorage();
  return _instance;
}

/** Reset the singleton (useful in tests). */
function resetStorage() {
  _instance = null;
}

module.exports = getStorage();
module.exports.getStorage   = getStorage;
module.exports.resetStorage = resetStorage;
