'use strict';

/**
 * Domain management API routes.
 *
 * GET    /api/domains/search              — search domain availability across TLDs
 * POST   /api/domains/register            — register a domain via Cloudflare Registrar
 * GET    /api/domains                     — list registered domains in this CF account
 * POST   /api/domains/sites/:siteId/connect   — connect custom domain to a site
 * DELETE /api/domains/sites/:siteId/connect   — disconnect custom domain from a site
 * GET    /api/domains/sites/:siteId/verify    — verify DNS configuration
 */

const express    = require('express');
const cloudflare = require('../integrations/cloudflare');
const storage    = require('../storage');
const { authOrApiKey } = require('./auth');

const router = express.Router();

router.use(authOrApiKey);

// ── GET /search ──────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
    if (!q) return res.status(400).json({ error: 'Missing or invalid query — use alphanumeric characters only' });
    const results = await cloudflare.searchDomains(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { domain, years = 1, siteId } = req.body || {};

    // Subscription gate — domain registration requires an active subscription
    if (siteId) {
      const site = await storage.getSite(siteId);
      const subStatus = site?.subscription?.status;
      if (subStatus !== 'active' && subStatus !== 'trialing') {
        return res.status(402).json({
          error:      'Active subscription required to connect a custom domain',
          upgradeUrl: '/api/billing/checkout',
          siteId,
        });
      }
    }
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: '"domain" is required' });
    }

    const result = await cloudflare.registerDomain(domain, years, {
      first_name:         'n3ware',
      last_name:          'Customer',
      email:              req.user?.email || 'hello@n3ware.com',
      phone:              '+1.4015555555',
      address:            '123 Main St',
      city:               'South Kingstown',
      state_or_province:  'RI',
      postal_code:        '02879',
      country:            'US',
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Registration failed' });
    }

    // Link to site and configure DNS if siteId provided
    if (siteId && result.zoneId) {
      try {
        const site = await storage.getSite(siteId);
        if (site) {
          await storage.saveSite(siteId, { ...site, customDomain: domain, zoneId: result.zoneId });
        }
        // Create CNAME records pointing to assembler
        const dnsTarget = 'assembler.n3ware.com';
        await Promise.all([
          cloudflare.addDnsRecord(result.zoneId, { type: 'CNAME', name: '@',   content: dnsTarget, proxied: true }),
          cloudflare.addDnsRecord(result.zoneId, { type: 'CNAME', name: 'www', content: dnsTarget, proxied: true }),
        ]);
      } catch (linkErr) {
        console.warn('[domains/register] site link failed:', linkErr.message);
      }
    }

    if (result.mockMode) {
      result.note = 'MOCK MODE — no real domain registered. Set CLOUDFLARE_API_TOKEN to enable real registrations.';
    }

    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const domains = await cloudflare.listMyDomains();
    res.json({ domains });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sites/:siteId/connect ───────────────────────────────────────────────
router.post('/sites/:siteId/connect', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { domain }  = req.body || {};
    if (!domain) return res.status(400).json({ error: '"domain" is required' });

    const site = await storage.getSite(siteId);
    if (!site) return res.status(404).json({ error: `Site "${siteId}" not found` });

    // Subscription gate — custom domain connection requires an active subscription
    const subStatus = site.subscription?.status;
    if (subStatus !== 'active' && subStatus !== 'trialing') {
      return res.status(402).json({
        error:      'Active subscription required to connect a custom domain',
        upgradeUrl: '/api/billing/checkout',
        siteId,
      });
    }

    let zone = await cloudflare.getZone(domain);
    if (!zone) zone = await cloudflare.createZone(domain);

    const updatedSite = { ...site, customDomain: domain, zoneId: zone.id };
    await storage.saveSite(siteId, updatedSite);

    res.json({ site: updatedSite, zone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /sites/:siteId/connect ─────────────────────────────────────────────
router.delete('/sites/:siteId/connect', async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await storage.getSite(siteId);
    if (!site) return res.status(404).json({ error: `Site "${siteId}" not found` });

    const updatedSite = { ...site };
    delete updatedSite.customDomain;
    delete updatedSite.zoneId;
    await storage.saveSite(siteId, updatedSite);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /sites/:siteId/verify ─────────────────────────────────────────────────
router.get('/sites/:siteId/verify', async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await storage.getSite(siteId);
    if (!site) return res.status(404).json({ error: `Site "${siteId}" not found` });
    if (!site.customDomain) return res.status(400).json({ error: 'No custom domain configured for this site' });

    const expected = 'assembler.n3ware.com';
    let resolvedCname = null;
    let verified = false;

    try {
      const dns    = require('dns').promises;
      const cnames = await dns.resolveCname(site.customDomain);
      resolvedCname = cnames[0] || null;
      verified = resolvedCname === expected || (resolvedCname && resolvedCname.endsWith('.n3ware.com'));
    } catch {
      verified = false;
    }

    res.json({ verified, domain: site.customDomain, cname: resolvedCname, expected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
