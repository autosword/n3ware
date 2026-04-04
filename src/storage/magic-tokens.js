'use strict';

/**
 * Magic link token storage.
 *
 * Tokens are stored as SHA-256 hashes — the raw token only travels in the
 * email URL and is never persisted.
 *
 * Schema (data/magic-tokens.json):
 *   { tokens: [ { hash, email, expiresAt, used, createdAt } ] }
 *
 * Rate-limit map is in-memory only (resets on restart); fine for a small app.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const config = require('../config');

const TOKENS_FILE    = path.resolve(path.join(config.dataDir || './data', 'magic-tokens.json'));
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT     = 3;              // max per window per email

// In-memory rate-limit map: email → [timestamp, ...]
const _ratemap = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

function _hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function _read() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { tokens: [] };
}

function _write(data) {
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check rate limit for an email. Returns true if allowed, false if blocked.
 * @param {string} email
 */
function checkRateLimit(email) {
  const key  = email.toLowerCase();
  const now  = Date.now();
  const hits = (_ratemap.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  _ratemap.set(key, hits);
  return true;
}

/**
 * Store a new magic token (as its SHA-256 hash).
 * Cleans expired/used tokens before writing.
 * @param {string} rawToken
 * @param {string} email
 * @param {number} expiresAt  Unix ms timestamp
 */
function saveToken(rawToken, email, expiresAt) {
  const data = _read();
  const now  = Date.now();
  // Prune expired
  data.tokens = data.tokens.filter(t => t.expiresAt > now);
  data.tokens.push({
    hash:      _hash(rawToken),
    email:     email.toLowerCase(),
    expiresAt,
    used:      false,
    createdAt: new Date().toISOString(),
  });
  _write(data);
}

/**
 * Retrieve a token record by the raw token value.
 * @param {string} rawToken
 * @returns {{ hash, email, expiresAt, used, createdAt }|null}
 */
function getToken(rawToken) {
  const h    = _hash(rawToken);
  const data = _read();
  return data.tokens.find(t => t.hash === h) || null;
}

/**
 * Mark a token as used. Must be called immediately on successful verification.
 * @param {string} rawToken
 */
function markTokenUsed(rawToken) {
  const h    = _hash(rawToken);
  const data = _read();
  const tok  = data.tokens.find(t => t.hash === h);
  if (tok) tok.used = true;
  _write(data);
}

/**
 * Return the most recent unexpired token record for an email (for status endpoint).
 * @param {string} email
 * @returns {{ expiresAt, createdAt }|null}
 */
function getLatestForEmail(email) {
  const key  = email.toLowerCase();
  const now  = Date.now();
  const data = _read();
  const candidates = data.tokens
    .filter(t => t.email === key && !t.used && t.expiresAt > now)
    .sort((a, b) => b.expiresAt - a.expiresAt);
  return candidates[0] || null;
}

module.exports = { checkRateLimit, saveToken, getToken, markTokenUsed, getLatestForEmail };
