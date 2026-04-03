'use strict';

/**
 * Analytics API routes.
 *
 * GET  /api/analytics/:siteId         — get aggregate stats (auth required)
 * GET  /api/analytics/:siteId/daily   — get daily breakdown (auth required)
 * POST /api/analytics/:siteId/track   — record a page view (public, no auth)
 */

const express   = require('express');
const analytics = require('../integrations/analytics');
const { authOrApiKey } = require('./auth');

const router = express.Router();

const VALID_PERIODS = new Set(['24h', '7d', '30d']);

// ---------------------------------------------------------------------------
// POST /:siteId/track — PUBLIC — record a page view
// (Mounted before authOrApiKey so it requires no credentials)
// ---------------------------------------------------------------------------
router.post('/:siteId/track', async (req, res) => {
  try {
    const { siteId } = req.params;
    const body       = req.body || {};

    const pagePath = (body.path || req.query.path || '/').trim();
    const referrer = body.referrer || req.query.referrer || '';  // stored for future use
    const ua       = req.headers['user-agent'] || '';
    const ip       = (
      req.headers['x-forwarded-for'] ||
      req.headers['cf-connecting-ip'] ||
      req.socket.remoteAddress ||
      ''
    ).split(',')[0].trim();

    await analytics.trackPageView(siteId, pagePath, ua, ip);

    // referrer is accepted but not yet persisted — TODO: include in view record
    void referrer;

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply auth middleware to all remaining routes.
router.use(authOrApiKey);

// ---------------------------------------------------------------------------
// GET /:siteId — aggregate stats
// ---------------------------------------------------------------------------
router.get('/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const period     = req.query.period || '7d';

    if (!VALID_PERIODS.has(period)) {
      return res.status(400).json({
        error: `Invalid period "${period}". Must be one of: ${[...VALID_PERIODS].join(', ')}`,
      });
    }

    const stats = await analytics.getStats(siteId, period);
    res.json({ siteId, period, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:siteId/daily — daily breakdown
// ---------------------------------------------------------------------------
router.get('/:siteId/daily', async (req, res) => {
  try {
    const { siteId } = req.params;
    const days       = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 365);

    const daily = await analytics.getDailyStats(siteId, days);
    res.json({ siteId, days, daily });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
