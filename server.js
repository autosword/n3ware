'use strict';

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Static assets (landing, demo, n3ware.js) ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'public, max-age=86400');
    }
  },
}));
app.use('/tests', express.static(path.join(__dirname, 'tests')));

// ── API routes ────────────────────────────────────────────────────────────────
const sitesRouter     = require('./src/api/sites');
const revisionsRouter = require('./src/api/revisions');
app.use('/api/sites', sitesRouter);
app.use('/api/sites', revisionsRouter);

// ── Hosted site serving ───────────────────────────────────────────────────────
const siteServingRouter = require('./src/serving/sites');
app.use('/sites', siteServingRouter);

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

app.get('/tests', (req, res) => {
  res.sendFile(path.join(__dirname, 'tests', 'n3ware.test.html'));
});

// ── Start (only when run directly) ───────────────────────────────────────────
if (require.main === module) {
  const config = require('./src/config');
  const PORT   = config.port;
  app.listen(PORT, () => {
    console.log(`n3ware server running at http://localhost:${PORT}`);
    console.log(`  Landing:  http://localhost:${PORT}/`);
    console.log(`  Demo:     http://localhost:${PORT}/demo`);
    console.log(`  Tests:    http://localhost:${PORT}/tests`);
    console.log(`  API:      http://localhost:${PORT}/api/sites`);
    console.log(`  Storage:  ${process.env.STORAGE_BACKEND || 'local'}`);
  });
}

module.exports = app;
