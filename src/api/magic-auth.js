'use strict';

/**
 * Magic link authentication routes.
 *
 * POST /api/auth/magic          — request a magic link
 * GET  /api/auth/verify         — verify token, issue JWT, redirect
 * GET  /api/auth/magic/status   — poll link status for a given email
 */

const express  = require('express');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const users    = require('../storage/users');
const tokens   = require('../storage/magic-tokens');
const { sendMagicLink } = require('../integrations/email');
const config   = require('../config');

const router   = express.Router();
const TOKEN_TTL_MS  = 15 * 60 * 1000; // 15 minutes
const JWT_TTL       = '7d';
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE_URL      = config.nodeEnv === 'production'
  ? 'https://n3ware.com'
  : (process.env.BASE_URL || 'http://localhost:8080');
const IS_PROD       = config.nodeEnv === 'production';

// ── POST /api/auth/magic ─────────────────────────────────────────────────────
router.post('/magic', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // Rate limit
    if (!tokens.checkRateLimit(email)) {
      return res.status(429).json({ error: 'Too many requests — please wait 10 minutes before trying again' });
    }

    // Generate raw token (32 bytes = 64 hex chars)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + TOKEN_TTL_MS;

    // Store hashed token
    tokens.saveToken(rawToken, email, expiresAt);

    // Build magic URL
    const magicUrl = `${BASE_URL}/api/auth/verify?token=${rawToken}`;

    // Send email (or mock)
    const result = await sendMagicLink(email, magicUrl);

    const response = { success: true, message: 'Check your email for your sign-in link' };

    // In non-production (or when SendGrid isn't configured), surface the link for testing
    if (!IS_PROD || result.mock) {
      response.magicUrl = magicUrl;
      response.note = 'Mock mode: use magicUrl to complete sign-in';
    }

    res.json(response);
  } catch (err) {
    console.error('[magic-auth] POST /magic error:', err);
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// ── GET /api/auth/verify ─────────────────────────────────────────────────────
router.get('/verify', async (req, res) => {
  const { token: rawToken } = req.query;
  const fail = (msg) => res.redirect(`/dashboard?auth_error=${encodeURIComponent(msg)}`);

  if (!rawToken) return fail('Missing token');

  try {
    const record = tokens.getToken(rawToken);

    if (!record)              return fail('Invalid or expired link');
    if (record.used)          return fail('This link has already been used');
    if (Date.now() > record.expiresAt) return fail('This link has expired');

    // Mark used immediately (single-use)
    tokens.markTokenUsed(rawToken);

    // Find or create user (auto-register on first login)
    let user = await users.getUserByEmail(record.email);
    if (!user) {
      // Create account with no password
      user = await users.createUser(record.email, '');
    }

    // Issue JWT (same format as password auth)
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: JWT_TTL }
    );

    // Set cookie on .n3ware.com so it's readable by the assembler subdomain too
    res.cookie('n3_token', jwtToken, {
      domain:   '.n3ware.com',
      path:     '/',
      httpOnly: false,   // JS on assembler subdomain needs to read it
      secure:   true,
      sameSite: 'Lax',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });
    // Keep #token= hash so the dashboard's existing localStorage handler still works
    res.redirect(`/dashboard#token=${jwtToken}`);
  } catch (err) {
    console.error('[magic-auth] GET /verify error:', err);
    return fail('Authentication failed — please request a new link');
  }
});

// ── GET /api/auth/magic/status ───────────────────────────────────────────────
router.get('/magic/status', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });

  const record = tokens.getLatestForEmail(email);
  if (!record) return res.json({ sent: false });

  const expiresIn = Math.max(0, Math.floor((record.expiresAt - Date.now()) / 1000));
  res.json({ sent: true, expiresIn });
});

module.exports = router;
