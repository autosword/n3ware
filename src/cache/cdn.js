'use strict';

/**
 * CDN cache purge helpers.
 *
 * Supported providers (CDN_PROVIDER env var):
 *   'none'        — no-op (default / dev)
 *   'cloudflare'  — Cloudflare Cache Purge API
 *   'gcp'         — Google Cloud CDN URL Map invalidation
 */

const https  = require('https');
const config = require('../config');

/**
 * Purge one or more URLs from the configured CDN.
 * @param {string[]} urls   full URLs to purge
 * @returns {Promise<void>}
 */
async function purgeUrls(urls) {
  if (!urls || !urls.length) return;
  switch (config.cdnProvider) {
    case 'cloudflare': return _purgeCloudflare(urls);
    case 'gcp':        return _purgeGCP(urls);
    default:           return; // no-op
  }
}

/**
 * Purge all paths under a site from the CDN.
 * @param {string} siteId
 * @param {string} [baseUrl]  public base URL, e.g. https://n3ware.example.com
 * @returns {Promise<void>}
 */
async function purgeSite(siteId, baseUrl = '') {
  return purgeUrls([
    `${baseUrl}/sites/${siteId}`,
    `${baseUrl}/sites/${siteId}/`,
  ]);
}

// ── Cloudflare ─────────────────────────────────────────────────────────────

function _purgeCloudflare(urls) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ files: urls });
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path:     `/client/v4/zones/${config.cloudflareZone}/purge_cache`,
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${config.cloudflareToken}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) resolve();
          else reject(new Error(`Cloudflare purge failed: ${JSON.stringify(json.errors)}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Google Cloud CDN ────────────────────────────────────────────────────────

async function _purgeGCP(urls) {
  // GCP CDN invalidation via the compute REST API.
  // Requires Application Default Credentials.
  const { GoogleAuth } = require('google-auth-library');
  const auth   = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const project = config.gcpProject;
  const backend = config.gcpBackendName;

  const paths = urls.map(u => {
    try { return new URL(u).pathname; } catch { return u; }
  });

  const apiUrl =
    `https://compute.googleapis.com/compute/v1/projects/${project}` +
    `/global/urlMaps/${backend}/invalidateCache`;

  await client.request({
    url:    apiUrl,
    method: 'POST',
    data:   { pathMatcher: { paths } },
  });
}

module.exports = { purgeUrls, purgeSite };
