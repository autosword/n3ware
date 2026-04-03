'use strict';

/**
 * Google Analytics 4 API routes.
 *
 * GET    /api/ga/auth-url               — OAuth2 start URL
 * GET    /api/ga/callback               — OAuth2 callback (exchanges code, stores tokens)
 * GET    /api/ga/properties             — list user's GA4 properties
 * POST   /api/sites/:id/ga/connect      — connect a GA4 property to a site
 * GET    /api/sites/:id/ga/stats        — full analytics dashboard data
 * GET    /api/sites/:id/ga/page         — stats for a specific page path
 * GET    /api/sites/:id/ga/realtime     — real-time active users
 * DELETE /api/sites/:id/ga             — disconnect GA4
 */

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const ga       = require('../integrations/google-analytics');
const { authOrApiKey, verifyToken } = require('./auth');
const storage  = require('../storage');
const config   = require('../config');

const router = express.Router();

// ── Token + connection storage ────────────────────────────────────────────────

const DATA_ROOT    = path.resolve(path.join(config.dataDir, '..'));
const TOKENS_FILE  = path.join(DATA_ROOT, 'ga-tokens.json');
const CONN_FILE    = path.join(DATA_ROOT, 'ga-connections.json');

function _readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return def; }
}
function _writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function _getTokens(userId)         { return (_readJson(TOKENS_FILE, {}))[userId] || null; }
function _saveTokens(userId, tkns)  { const d = _readJson(TOKENS_FILE, {}); d[userId] = { ...tkns, updatedAt: new Date().toISOString() }; _writeJson(TOKENS_FILE, d); }
function _getConn(siteId)           { return (_readJson(CONN_FILE, {}))[siteId] || null; }
function _saveConn(siteId, conn)    { const d = _readJson(CONN_FILE, {}); d[siteId] = conn; _writeJson(CONN_FILE, d); }
function _deleteConn(siteId)        { const d = _readJson(CONN_FILE, {}); delete d[siteId]; _writeJson(CONN_FILE, d); }

// Helper: derive a human-readable period's start/end dates
function _dates(period) {
  const end   = new Date();
  const days  = period === '90d' ? 90 : period === '30d' ? 30 : 7;
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const fmt   = d => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// Helper: check site ownership (JWT user must own the site, or API key bypasses)
function _canWrite(req, site) {
  if (req.authType === 'apikey') return true;
  return req.user && site && site.ownerId === req.user.id;
}

// ── GET /api/ga/auth-url ──────────────────────────────────────────────────────
router.get('/auth-url', authOrApiKey, (req, res) => {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get('host')}/api/ga/callback`;
  const url = ga.getAuthUrl(redirectUri);
  res.json({ url });
});

// ── GET /api/ga/callback ──────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get('host')}/api/ga/callback`;

  try {
    const result  = await ga.handleCallback(code, redirectUri);
    // state carries the userId from the auth-url request
    const userId  = state || 'anonymous';
    _saveTokens(userId, {
      accessToken:  result.accessToken,
      refreshToken: result.refreshToken,
      email:        result.email,
      rawTokens:    result.tokens || {},
    });
    // Redirect back to dashboard
    res.redirect('/dashboard?ga=connected');
  } catch (err) {
    res.status(500).send(`GA callback failed: ${err.message}`);
  }
});

// ── GET /api/ga/properties ────────────────────────────────────────────────────
router.get('/properties', authOrApiKey, async (req, res) => {
  try {
    const userId = req.user && req.user.id ? req.user.id : 'anonymous';
    const tokens = ga.isMock ? null : (_getTokens(userId) || {}).rawTokens;
    const props  = await ga.getProperties(tokens);
    res.json({ properties: props });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sites/:id/ga/connect ────────────────────────────────────────────
router.post('/sites/:id/ga/connect', authOrApiKey, async (req, res) => {
  const site = storage.getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (!_canWrite(req, site)) return res.status(403).json({ error: 'Forbidden' });

  const { propertyId, propertyName } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });

  const userId = req.user && req.user.id ? req.user.id : 'anonymous';
  _saveConn(req.params.id, {
    propertyId,
    propertyName: propertyName || propertyId,
    userId,
    connectedAt: new Date().toISOString(),
  });
  res.json({ connected: true, propertyId, propertyName: propertyName || propertyId });
});

// ── GET /api/sites/:id/ga/stats ───────────────────────────────────────────────
router.get('/sites/:id/ga/stats', authOrApiKey, async (req, res) => {
  const site = storage.getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const conn = _getConn(req.params.id);
  if (!conn && !ga.isMock) return res.status(404).json({ error: 'GA4 not connected for this site', gaConnected: false });

  const propertyId = conn ? conn.propertyId : 'mock';
  const period     = req.query.period || '7d';
  const { startDate, endDate } = _dates(period);
  const userId     = conn ? conn.userId : 'anonymous';
  const tokens     = ga.isMock ? null : (_getTokens(userId) || {}).rawTokens;

  try {
    const [pvData, sources, devices, topPages, rt] = await Promise.all([
      ga.getPageViews(propertyId, startDate, endDate, null, tokens),
      ga.getTrafficSources(propertyId, startDate, endDate, tokens),
      ga.getDeviceBreakdown(propertyId, startDate, endDate, tokens),
      ga.getTopPages(propertyId, startDate, endDate, 10, tokens),
      ga.getRealtime(propertyId, tokens),
    ]);
    res.json({
      views:         pvData.total,
      uniqueVisitors: Math.round(pvData.total * 0.72),
      avgDuration:   null,
      bounceRate:    null,
      daily:         pvData.daily,
      sources,
      devices,
      topPages,
      realtime:      rt.activeUsers,
      gaConnected:   true,
      period,
      propertyId,
      propertyName:  conn ? conn.propertyName : 'Mock Property',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sites/:id/ga/page ────────────────────────────────────────────────
router.get('/sites/:id/ga/page', authOrApiKey, async (req, res) => {
  const site = storage.getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const conn = _getConn(req.params.id);
  if (!conn && !ga.isMock) return res.status(404).json({ error: 'GA4 not connected', gaConnected: false });

  const pagePath   = req.query.path || '/';
  const period     = req.query.period || '7d';
  const { startDate, endDate } = _dates(period);
  const propertyId = conn ? conn.propertyId : 'mock';
  const userId     = conn ? conn.userId : 'anonymous';
  const tokens     = ga.isMock ? null : (_getTokens(userId) || {}).rawTokens;

  try {
    const data = await ga.getPageSpecificStats(propertyId, pagePath, startDate, endDate, tokens);
    res.json({ ...data, period, pagePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sites/:id/ga/realtime ────────────────────────────────────────────
router.get('/sites/:id/ga/realtime', authOrApiKey, async (req, res) => {
  const conn = _getConn(req.params.id);
  if (!conn && !ga.isMock) return res.json({ activeUsers: 0, gaConnected: false });

  const propertyId = conn ? conn.propertyId : 'mock';
  const userId     = conn ? conn.userId : 'anonymous';
  const tokens     = ga.isMock ? null : (_getTokens(userId) || {}).rawTokens;

  try {
    const rt = await ga.getRealtime(propertyId, tokens);
    res.json({ ...rt, gaConnected: !!conn || ga.isMock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/sites/:id/ga ──────────────────────────────────────────────────
router.delete('/sites/:id/ga', authOrApiKey, (req, res) => {
  const site = storage.getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (!_canWrite(req, site)) return res.status(403).json({ error: 'Forbidden' });

  _deleteConn(req.params.id);
  res.json({ disconnected: true });
});

module.exports = router;
