'use strict';

const config = require('../config');

class CdnCache {
  /**
   * Purge specific URLs from the CDN.
   * @param {string[]} urls
   */
  async purge(urls) {
    if (!config.cdnProvider || !urls.length) return;
    if (config.cdnProvider === 'cloudflare') return this._purgeCloudflare(urls);
    if (config.cdnProvider === 'gcp')        return this._purgeGcp(urls);
    console.warn(`[cdn] Unknown CDN_PROVIDER: ${config.cdnProvider}`);
  }

  /**
   * Purge all cached content for a site.
   * @param {string} siteId
   */
  async purgeAll(siteId) {
    if (!config.cdnProvider) return;
    const base = config.publicUrl || '';
    await this.purge([
      `${base}/sites/${siteId}`,
      `${base}/api/sites/${siteId}/html`,
    ]);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  async _purgeCloudflare(urls) {
    const { zoneId, apiToken } = config.cloudflare;
    if (!zoneId || !apiToken) {
      console.warn('[cdn] Cloudflare CDN_PROVIDER set but CF_ZONE_ID/CF_API_TOKEN missing');
      return;
    }
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ files: urls }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[cdn] Cloudflare purge failed (${res.status}): ${body}`);
    }
  }

  async _purgeGcp(urls) {
    const { project, backendService } = config.gcp;
    if (!project || !backendService) {
      console.warn('[cdn] GCP CDN_PROVIDER set but GCP_PROJECT/GCP_BACKEND_SERVICE missing');
      return;
    }
    const token = await this._gcpToken();
    if (!token) return;

    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const res = await fetch(
          `https://compute.googleapis.com/compute/v1/projects/${project}/global/backendServices/${backendService}/invalidateCache`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({ host: parsed.hostname, path: parsed.pathname }),
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error(`[cdn] GCP purge failed for ${url} (${res.status}): ${body}`);
        }
      } catch (err) {
        console.error(`[cdn] GCP purge error for ${url}: ${err.message}`);
      }
    }
  }

  async _gcpToken() {
    try {
      const res = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } }
      );
      if (!res.ok) return null;
      const { access_token } = await res.json();
      return access_token;
    } catch {
      console.warn('[cdn] Could not fetch GCP metadata token (not running on GCP?)');
      return null;
    }
  }
}

module.exports = new CdnCache();
