'use strict';

/**
 * Analytics integration — page view tracking and stats.
 *
 * Mock mode: Stores events in data/analytics/{siteId}.json
 * Real mode: Could integrate with Plausible or Simple Analytics API.
 *
 * Storage format: { views: [{ ts, path, ua, ip }], ... }
 */

const fs   = require('fs');
const path = require('path');

const ANALYTICS_DIR = path.resolve(path.join(process.env.DATA_DIR || './data', 'analytics'));

// Analytics is always stored locally in this version; real integrations are TODOs.
const isMock = true; // eslint-disable-line no-unused-vars

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _getSiteFile(siteId) {
  return path.join(ANALYTICS_DIR, `${siteId}.json`);
}

function _readData(siteId) {
  const file = _getSiteFile(siteId);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch { /* ignore */ }
  return { views: [] };
}

function _writeData(siteId, data) {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  const file = _getSiteFile(siteId);
  const tmp  = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a page view event.
 * @param {string} siteId
 * @param {string} pagePath
 * @param {string} userAgent
 * @param {string} ip
 */
async function trackPageView(siteId, pagePath, userAgent, ip) {
  const data = _readData(siteId);
  data.views.push({
    ts:   new Date().toISOString(),
    path: pagePath || '/',
    ua:   userAgent || '',
    ip:   ip || '',
  });
  // Trim to last 100,000 entries
  if (data.views.length > 100000) {
    data.views = data.views.slice(-100000);
  }
  _writeData(siteId, data);
}

/**
 * Get aggregate stats for a site over a given period.
 * @param {string} siteId
 * @param {'24h'|'7d'|'30d'} period
 * @returns {{ views: number, uniqueVisitors: number, topPages: Array<{path,count}>, referrers: [] }}
 */
async function getStats(siteId, period = '7d') {
  const data      = _readData(siteId);
  const now       = Date.now();
  const periodMs  = period === '24h' ? 24 * 3600 * 1000
    : period === '7d'  ? 7  * 24 * 3600 * 1000
    : 30 * 24 * 3600 * 1000;

  const filtered = data.views.filter(v => {
    const ts = new Date(v.ts).getTime();
    return !isNaN(ts) && now - ts <= periodMs;
  });

  const uniqueIPs  = new Set(filtered.map(v => v.ip).filter(Boolean));
  const pageCounts = {};
  for (const v of filtered) {
    pageCounts[v.path] = (pageCounts[v.path] || 0) + 1;
  }
  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, count]) => ({ path: p, count }));

  return {
    views:          filtered.length,
    uniqueVisitors: uniqueIPs.size,
    topPages,
    referrers:      [],
  };
}

/**
 * Get daily view/visitor counts for the last N days.
 * @param {string} siteId
 * @param {number} days
 * @returns {Array<{ date: string, views: number, visitors: number }>}
 */
async function getDailyStats(siteId, days = 30) {
  const data = _readData(siteId);
  const now  = new Date();

  // Build a map of date -> { views, ips }
  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { views: 0, ips: new Set() };
  }

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  for (const v of data.views) {
    const ts = new Date(v.ts);
    if (isNaN(ts.getTime()) || ts < cutoff) continue;
    const key = ts.toISOString().slice(0, 10);
    if (buckets[key]) {
      buckets[key].views++;
      if (v.ip) buckets[key].ips.add(v.ip);
    }
  }

  return Object.entries(buckets)
    .map(([date, b]) => ({ date, views: b.views, visitors: b.ips.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Generate realistic mock analytics data for a site (used by seed script).
 * @param {string} siteId
 * @param {number} days
 */
async function generateMockData(siteId, days = 30) {
  const pages    = ['/', '/about', '/contact', '/services', '/blog', '/pricing'];
  const ips      = Array.from({ length: 50 }, (_, i) => `192.168.1.${i + 1}`);
  const views    = [];
  const now      = Date.now();

  for (let d = 0; d < days; d++) {
    const dayStart  = now - (days - d) * 24 * 3600 * 1000;
    const viewCount = Math.floor(Math.random() * 181) + 20; // 20–200

    for (let v = 0; v < viewCount; v++) {
      const ts = new Date(dayStart + Math.random() * 24 * 3600 * 1000);
      views.push({
        ts:   ts.toISOString(),
        path: pages[Math.floor(Math.random() * pages.length)],
        ua:   'Mozilla/5.0 (mock)',
        ip:   ips[Math.floor(Math.random() * ips.length)],
      });
    }
  }

  _writeData(siteId, { views });
  console.log(`[analytics] Generated ${views.length} mock page views for site "${siteId}" over ${days} days`);
}

module.exports = { trackPageView, getStats, getDailyStats, generateMockData };
