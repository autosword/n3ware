'use strict';

/**
 * Site serving middleware.
 *
 * Serves published sites at  GET /sites/:siteId
 * with n3ware.js injected before </body> and correct Cache-Control headers.
 *
 * For v2 sites (GCS-backed), content is fetched from the assembler so that
 * page edits saved to GCS are reflected immediately.  The assembler URL is
 * read from ASSEMBLER_URL (default: https://assembler.n3ware.com).
 *
 * Cache-Control strategy:
 *   - public, s-maxage=300  (CDN caches 5 min)
 *   - stale-while-revalidate=60
 */

const storage        = require('../storage');
const cache          = require('../cache');
const config         = require('../config');
const { generateScripts, wrapScript } = require('../integrations/tracker-scripts');

const CACHE_CONTROL   = 'public, s-maxage=300, stale-while-revalidate=60';
const ASSEMBLER_URL   = process.env.ASSEMBLER_URL || 'https://assembler.n3ware.com';

/**
 * Express middleware factory.
 * Mount as: app.use('/sites', serveSites());
 * @returns {import('express').RequestHandler}
 */
function serveSites() {
  return async function siteHandler(req, res, next) {
    // Expect /:siteId[/:page] or /:siteId/
    const parts  = req.path.replace(/^\//, '').split('/');
    const siteId = parts[0];
    if (!siteId) return next();

    try {
      const site = await cache.getSite(storage, siteId);
      if (!site) return res.status(404).send(_notFoundPage(siteId));

      // v2 sites: assemble from GCS via the assembler service
      const assemblerResp = await fetch(
        `${ASSEMBLER_URL}/sites/${siteId}${req.path.slice(siteId.length + 1) || '/'}`,
        { headers: { 'Accept': 'text/html' } }
      );

      if (!assemblerResp.ok) {
        console.error(`[serving] Assembler returned ${assemblerResp.status} for site ${siteId}`);
        return res.status(502).send(_assemblerErrorPage(siteId, assemblerResp.status));
      }

      const rawHtml = await assemblerResp.text();
      const trackerScripts = generateScripts(site.integrations || {});
      // Assembler already injects the editor script; skip re-injection
      const withTrackers = _injectTrackers(rawHtml, trackerScripts);
      const html = withTrackers;
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

function _notActivePage(site) {
  const name = _esc(site.name || 'This site');
  return `<!DOCTYPE html><html><head><title>${name} — Not Live Yet</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}
.box{text-align:center;padding:48px;max-width:520px}.logo{color:#E31337;font-size:28px;font-weight:900;letter-spacing:-1px;margin-bottom:32px}
.icon{font-size:64px;margin-bottom:16px}.title{font-size:24px;font-weight:700;margin-bottom:12px}
p{color:#94A3B8;margin-bottom:8px}.cta{margin-top:32px;background:#E31337;color:#fff;border:none;padding:14px 28px;border-radius:12px;font:700 15px/1 system-ui;cursor:pointer;text-decoration:none;display:inline-block}
.note{margin-top:16px;font-size:13px;color:#475569}</style>
</head><body><div class="box">
<div class="logo">n3ware</div>
<div class="icon">🚀</div>
<div class="title">${name} isn't live yet</div>
<p>The site owner hasn't activated hosting for this site.</p>
<p>n3ware Pro hosting is $20/month and includes unlimited pages,<br>unlimited uploads, and a live public URL.</p>
<a class="cta" href="https://n3ware.com/dashboard">Activate hosting →</a>
<div class="note">Are you the site owner? <a href="https://n3ware.com/dashboard" style="color:#E31337">Log in to your dashboard</a> to go live.</div>
</div></body></html>`;
}

function _notFoundPage(siteId) {
  return `<!DOCTYPE html><html><head><title>Site Not Found</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:48px}.code{color:#3B82F6;font-size:64px;font-weight:900;margin-bottom:8px}h1{margin-bottom:8px}p{color:#94A3B8}a{color:#3B82F6}</style>
</head><body><div class="box"><div class="code">404</div>
<h1>Site Not Found</h1><p>No site with id <code>${_esc(siteId)}</code> exists.</p>
<p><a href="/">← Back to n3ware</a></p></div></body></html>`;
}

function _assemblerErrorPage(siteId, status) {
  return `<!DOCTYPE html><html><head><title>Service Unavailable</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:48px}.code{color:#EF4444;font-size:64px;font-weight:900;margin-bottom:8px}h1{margin-bottom:8px}p{color:#94A3B8}</style>
</head><body><div class="box"><div class="code">502</div>
<h1>Service Unavailable</h1><p>The assembler returned ${status} for site <code>${_esc(siteId)}</code>.</p></div></body></html>`;
}

module.exports = serveSites;
