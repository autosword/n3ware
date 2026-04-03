'use strict';

const config = require('../config');

let _instance;

function createStorage() {
  if (config.storage === 'firestore') {
    const FirestoreStorage = require('./firestore');
    return new FirestoreStorage();
  }
  const LocalStorage = require('./local');
  return new LocalStorage();
}

module.exports = _instance || (_instance = createStorage());
