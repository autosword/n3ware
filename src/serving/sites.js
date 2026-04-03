'use strict';

const { Router } = require('express');
const cache      = require('../cache');
const config     = require('../config');

const router = Router();

// Serve hosted site at /sites/:siteId
router.get('/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await cache.storage.getSite(siteId);
    if (!site) return res.status(404).send('<h1>Site not found</h1>');

    const html = site.html || '';
    const base  = config.publicUrl || `${req.protocol}://${req.get('host')}`;

    // Inject n3ware.js with cloud config so the owner can edit and publish.
    // NOTE: the site apiKey is embedded — treat /sites/:id as owner-only or add auth.
    const script = `<script src="${base}/n3ware.js"` +
      ` data-n3-api="${base}"` +
      ` data-n3-site="${siteId}"` +
      ` data-n3-key="${site.apiKey}"></script>`;

    const injected = html.includes('</body>')
      ? html.replace('</body>', `${script}\n</body>`)
      : html + script;

    res.set('Cache-Control', 'public, max-age=60, s-maxage=300').send(injected);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
