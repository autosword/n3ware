'use strict';

/**
 * User authentication routes.
 *
 * POST /api/auth/register  — create account, return JWT
 * POST /api/auth/login     — validate credentials, return JWT
 * GET  /api/auth/me        — return current user from token
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const users    = require('../storage/users');
const config   = require('../config');
const { verifyToken } = require('./auth');

const router = express.Router();
const SALT_ROUNDS = 10;
const TOKEN_TTL   = '7d';

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return res.status(400).json({ error: 'invalid email address' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = users.createUser(email, hash);
    const token = _sign(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.message === 'Email already registered') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[auth] register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = users.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const pub   = { id: user.id, email: user.email, createdAt: user.createdAt };
    const token = _sign(pub);
    res.json({ token, user: pub });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Me ────────────────────────────────────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
  const user = users.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function _sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: TOKEN_TTL }
  );
}

module.exports = router;
