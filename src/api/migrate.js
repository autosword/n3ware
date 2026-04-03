'use strict';

/**
 * Website migration API routes.
 *
 * POST /api/migrate/scrape         — scrape a URL, return preview (no auth)
 * POST /api/migrate/import         — run full migration, create site (auth required)
 * GET  /api/migrate/status/:jobId  — poll job status
 */

const express  = require('express');
const { v4: uuid } = require('uuid');
const { authOrApiKey } = require('./auth');
const scraper  = require('../integrations/scraper');
const migrator = require('../integrations/migrator');
const storage  = require('../storage');

const router = express.Router();

// In-memory job store — keyed by jobId, TTL-cleaned every 15 min
const jobs = new Map();

// ── POST /scrape — no auth required ──────────────────────────────────────────

router.post('/scrape', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  const jobId = uuid();
  _setJob(jobId, { status: 'scraping', progress: 10, scraped: null });

  try {
    const scraped = await scraper.scrapeUrl(url.trim());
    _setJob(jobId, { status: 'ready', progress: 100, scraped });

    return res.json({
      jobId,
      scraped: {
        title:       scraped.title,
        description: scraped.description,
        favicon:     scraped.favicon,
        imageCount:  scraped.images.length,
        images:      scraped.images.slice(0, 3),   // preview thumbnails only
        styleCount:  scraped.styles.length,
        baseUrl:     scraped.baseUrl,
        finalUrl:    scraped.finalUrl,
      },
    });
  } catch (err) {
    _setJob(jobId, { status: 'failed', progress: 0, error: err.message });
    return res.status(422).json({ error: err.message, jobId });
  }
});

// ── POST /import — auth required ──────────────────────────────────────────────

router.post('/import', authOrApiKey, (req, res) => {
  const { url, jobId, siteName } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  // Reuse existing scrape job or create a new one
  const activeJobId  = jobId && jobs.has(jobId) ? jobId : uuid();
  const existingJob  = jobs.get(activeJobId) || {};
  const existingData = existingJob.scraped || null;
  const ownerId      = req.user && req.user.id ? req.user.id : null;

  _setJob(activeJobId, { ...existingJob, status: 'analyzing', progress: 10 });

  // Respond immediately; migration runs async
  res.json({ jobId: activeJobId, status: 'analyzing' });

  _runImport(activeJobId, url.trim(), existingData, siteName, ownerId)
    .catch(err => {
      _setJob(activeJobId, { ...jobs.get(activeJobId), status: 'failed', error: err.message });
    });
});

async function _runImport(jobId, url, existingScraped, siteName, ownerId) {
  function update(status, progress) {
    _setJob(jobId, { ...jobs.get(jobId), status, progress });
  }

  // 1. Scrape (skip if we already have data from /scrape)
  update('scraping', 15);
  let scraped = existingScraped;
  if (!scraped) {
    scraped = await scraper.scrapeUrl(url);
    _setJob(jobId, { ...jobs.get(jobId), scraped });
  }

  // 2. Download + re-host images
  update('importing', 35);
  const siteId   = uuid();
  const imageMap = await scraper.downloadImages(scraped.images || [], siteId);

  // 3. AI / mock migration
  update('analyzing', 55);
  const { cleanHtml, sections, report } = await migrator.migrateHtml(scraped, imageMap);

  // 4. Persist new site
  update('importing', 80);
  const name = siteName || scraped.title || 'Imported Site';
  storage.saveSite(siteId, {
    html:    cleanHtml,
    name,
    ownerId,
    message: `Imported from ${scraped.finalUrl || url}`,
  });

  // 5. Complete
  _setJob(jobId, {
    ...jobs.get(jobId),
    status:   'complete',
    progress: 100,
    siteId,
    report: { ...report, siteName: name, sourceUrl: url },
  });
}

// ── GET /status/:jobId ────────────────────────────────────────────────────────

router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { status, progress, report, error, siteId } = job;
  res.json({
    status,
    progress: progress || 0,
    report:   report   || null,
    error:    error    || null,
    siteId:   siteId   || null,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _setJob(jobId, fields) {
  const existing = jobs.get(jobId) || { createdAt: new Date().toISOString() };
  jobs.set(jobId, { ...existing, ...fields });
}

// Purge jobs older than 1 hour every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000).unref();

module.exports = router;
