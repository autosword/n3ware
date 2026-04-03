'use strict';

/**
 * Domain management API routes.
 *
 * GET    /api/domains/search              — search domain availability
 * POST   /api/domains/register            — register a domain
 * POST   /api/domains/sites/:siteId/connect   — connect custom domain to a site
 * DELETE /api/domains/sites/:siteId/connect   — disconnect custom domain from a site
 * GET    /api/domains/sites/:siteId/verify    — verify DNS configuration
 */

const express    = require('express');
const cloudflare = require('../integrations/cloudflare');
const storage    = require('../storage');
const { authOrApiKey } = require('./auth');

const router = express.Router();

// Apply auth to all routes in this router.
router.use(authOrApiKey);

// ---------------------------------------------------------------------------
// GET /search — search for domain availability
// ---------------------------------------------------------------------------
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const results = await cloudflare.searchDomains(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /register — register a domain
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { domain, contactInfo } = req.body || {};
    if (!domain) {
      return res.status(400).json({ error: '"domain" is required' });
    }

    const result = await cloudflare.registerDomain(domain, contactInfo || {});
    res.status(201).json({ domain: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /sites/:siteId/connect — attach a custom domain to a site
// ---------------------------------------------------------------------------
router.post('/sites/:siteId/connect', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { domain }  = req.body || {};

    if (!domain) {
      return res.status(400).json({ error: '"domain" is required' });
    }

    const site = await storage.getSite(siteId);
    if (!site) {
      return res.status(404).json({ error: `Site "${siteId}" not found` });
    }

    // Create a Cloudflare zone for the domain (or retrieve existing).
    let zone = await cloudflare.getZone(domain);
    if (!zone) {
      zone = await cloudflare.createZone(domain);
    }

    // Persist the custom domain on the site record.
    const updatedSite = { ...site, customDomain: domain, zoneId: zone.id };
    await storage.saveSite(siteId, updatedSite);

    res.json({ site: updatedSite, zone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /sites/:siteId/connect — remove the custom domain from a site
// ---------------------------------------------------------------------------
router.delete('/sites/:siteId/connect', async (req, res) => {
  try {
    const { siteId } = req.params;

    const site = await storage.getSite(siteId);
    if (!site) {
      return res.status(404).json({ error: `Site "${siteId}" not found` });
    }

    const updatedSite = { ...site };
    delete updatedSite.customDomain;
    delete updatedSite.zoneId;
    await storage.saveSite(siteId, updatedSite);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /sites/:siteId/verify — verify DNS configuration
// ---------------------------------------------------------------------------
router.get('/sites/:siteId/verify', async (req, res) => {
  try {
    const { siteId } = req.params;

    const site = await storage.getSite(siteId);
    if (!site) {
      return res.status(404).json({ error: `Site "${siteId}" not found` });
    }

    if (!site.customDomain) {
      return res.status(400).json({ error: 'No custom domain is configured for this site' });
    }

    // The expected CNAME target for n3ware-hosted sites.
    const expected = `${siteId}.n3ware.com`;

    let resolvedCname = null;
    let verified      = false;

    try {
      const dns    = require('dns').promises;
      const cnames = await dns.resolveCname(site.customDomain);
      resolvedCname = cnames[0] || null;
      verified = resolvedCname === expected || (resolvedCname && resolvedCname.endsWith('.n3ware.com'));
    } catch {
      // DNS resolution failed — domain not yet propagated or misconfigured.
      verified      = false;
      resolvedCname = null;
    }

    res.json({
      verified,
      domain:   site.customDomain,
      cname:    resolvedCname,
      expected,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
