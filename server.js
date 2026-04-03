'use strict';

const express      = require('express');
const cors         = require('cors');
const morgan       = require('morgan');
const path         = require('path');
const config       = require('./src/config');
const serveSites   = require('./src/serving/sites');
const sitesApi     = require('./src/api/sites');
const revisionsApi = require('./src/api/revisions');
const authRoutes   = require('./src/api/authRoutes');
const templates    = require('./src/api/templates');
const billingApi   = require('./src/api/billing');
const domainsApi   = require('./src/api/domains');
const uploadsApi   = require('./src/api/uploads');
const analyticsApi = require('./src/api/analytics-routes');

// Initialize integrations (logs mock-mode notices)
require('./src/integrations');

const app = express();

// ── Request logging ─────────────────────────────────────────────────────────
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// ── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin:  config.nodeEnv === 'production' ? false : '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
}));

// ── Raw body (Stripe webhook) — must come before express.json ────────────────
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// ── Static public files ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tests',   express.static(path.join(__dirname, 'tests')));
// Serve locally-stored uploads
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, '..')
  : path.join(__dirname, 'data');
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

// ── Auth routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);

// ── Template routes ───────────────────────────────────────────────────────────
app.use('/api/templates', templates);

// ── Sites API ─────────────────────────────────────────────────────────────────
app.use('/api/sites', sitesApi);

// ── Revisions (nested under sites) ───────────────────────────────────────────
app.use('/api/sites/:id/revisions', (req, res, next) => {
  req.params = { ...req.params, id: req.params.id };
  next();
}, revisionsApi);

// ── Billing ───────────────────────────────────────────────────────────────────
app.use('/api/billing', billingApi);

// ── Domains ───────────────────────────────────────────────────────────────────
app.use('/api/domains', domainsApi);

// ── File uploads (mounted at /api/uploads, routes include /:siteId prefix) ──
app.use('/api/uploads', uploadsApi);

// ── Analytics ─────────────────────────────────────────────────────────────────
app.use('/api/analytics', analyticsApi);

// ── Cache stats (internal) ───────────────────────────────────────────────────
app.get('/api/cache/stats', (req, res) => {
  const key = req.headers['x-api-key'] || '';
  if (key !== config.masterApiKey) return res.status(403).json({ error: 'Forbidden' });
  const { memory } = require('./src/cache');
  res.json(memory.stats());
});

// ── Site serving (with analytics tracking) ───────────────────────────────────
const analyticsIntegration = require('./src/integrations/analytics');
app.use('/sites', (req, res, next) => {
  // Fire-and-forget page view tracking
  const siteId = req.path.replace(/^\//, '').split('/')[0];
  if (siteId) {
    analyticsIntegration.trackPageView(
      siteId,
      req.path,
      req.headers['user-agent'] || '',
      (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
    ).catch(() => {});
  }
  next();
}, serveSites());

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/demo',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/tests',     (req, res) => res.sendFile(path.join(__dirname, 'tests', 'n3ware.test.html')));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`n3ware server  →  http://localhost:${config.port}`);
  console.log(`  Storage: ${config.storageBackend}`);
  console.log(`  CDN:     ${config.cdnProvider}`);
  console.log(`  Env:     ${config.nodeEnv}`);
});

module.exports = app;
