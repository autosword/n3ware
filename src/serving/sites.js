'use strict';

/**
 * Site serving middleware.
 *
 * Serves published sites at  GET /sites/:siteId
 * with n3ware.js injected before </body> and correct Cache-Control headers.
 *
 * Cache-Control strategy:
 *   - public, s-maxage=300  (CDN caches 5 min)
 *   - stale-while-revalidate=60
 */

const storage        = require('../storage');
const cache          = require('../cache');
const config         = require('../config');
const { generateScripts, wrapScript } = require('../integrations/tracker-scripts');

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=60';

/**
 * Express middleware factory.
 * Mount as: app.use('/sites', serveSites());
 * @returns {import('express').RequestHandler}
 */
function serveSites() {
  return async function siteHandler(req, res, next) {
    // Expect /:siteId or /:siteId/
    const siteId = req.path.replace(/^\//, '').replace(/\/$/, '').split('/')[0];
    if (!siteId) return next();

    try {
      const site = await cache.getSite(storage, siteId);
      if (!site) return res.status(404).send(_notFoundPage(siteId));

      const trackerScripts = generateScripts(site.integrations || {});
      const html = _injectEditor(_injectTrackers(site.html, trackerScripts), siteId, site.apiKey);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', CACHE_CONTROL);
      res.set('X-Site-Id', siteId);
      res.set('X-Site-Updated', site.updatedAt || '');
      res.send(html);
    } catch (err) {
      console.error(`[serving] Error serving site ${siteId}:`, err.message);
      next(err);
    }
  };
}

/**
 * Inject tracker scripts into <head> (before </head>).
 * Scripts are pre-wrapped with <!-- n3:script:KEY:start/end --> markers
 * by generateScripts() so the editor can show visual placeholders.
 * wrapScript is also exported from tracker-scripts for use elsewhere.
 * @param {string} html
 * @param {string} scripts  raw HTML from generateScripts() (already wrapped)
 * @returns {string}
 */
function _injectTrackers(html, scripts) {
  if (!scripts) return html;
  const comment = `\n<!-- n3ware integrations -->\n${scripts}\n`;
  if (html.includes('</head>')) {
    return html.replace(/<\/head>/i, `${comment}</head>`);
  }
  return html;
}

/**
 * Inject the n3ware script tag before </body>.
 * Adds data-n3-site attribute so the library knows which site to save to.
 * @param {string} html    raw site HTML
 * @param {string} siteId
 * @returns {string} modified HTML
 */
function _injectEditor(html, siteId, siteApiKey) {
  const tag =
    `\n<!-- n3ware editor -->\n` +
    `<script src="${config.n3wareScriptUrl}" ` +
    `data-n3-site="${_esc(siteId)}" ` +
    `data-n3-api="/api" ` +
    (siteApiKey ? `data-n3-key="${_esc(siteApiKey)}" ` : '') +
    `></script>`;

  if (html.includes('</body>')) {
    return html.replace(/<\/body>/i, `${tag}\n</body>`);
  }
  // Fallback: append to end
  return html + tag;
}

function _esc(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function _notFoundPage(siteId) {
  return `<!DOCTYPE html><html><head><title>Site Not Found</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:48px}.code{color:#3B82F6;font-size:64px;font-weight:900;margin-bottom:8px}h1{margin-bottom:8px}p{color:#94A3B8}a{color:#3B82F6}</style>
</head><body><div class="box"><div class="code">404</div>
<h1>Site Not Found</h1><p>No site with id <code>${_esc(siteId)}</code> exists.</p>
<p><a href="/">← Back to n3ware</a></p></div></body></html>`;
}

module.exports = serveSites;
