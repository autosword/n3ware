'use strict';

/**
 * Cloudflare integration — domain management, registrar, CDN.
 *
 * Mock mode: CLOUDFLARE_API_TOKEN not set.
 *   - searchDomains: uses consistent hash to simulate availability
 *   - registerDomain: returns fake success
 *   - DNS helpers: return fake records
 * Real mode: Uses Cloudflare API v4 with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const isMock     = !process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN      = process.env.CLOUDFLARE_API_TOKEN;

const DATA_DIR     = process.env.DATA_DIR || './data';
const DOMAINS_FILE = path.resolve(path.join(DATA_DIR, 'domains.json'));

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/** Cloudflare Registrar at-cost prices (USD/year, approximate 2026) */
const TLD_PRICES = {
  '.com':  10.44,
  '.net':  11.60,
  '.org':  11.00,
  '.io':   32.00,
  '.app':  14.00,
  '.co':   29.00,
  '.dev':  14.00,
  '.xyz':  10.00,
  '.me':   20.00,
  '.ai':   80.00,
};

/**
 * Return the annual registration price for a TLD.
 * @param {string} tld  e.g. '.com'
 * @returns {number}    USD price per year
 */
function getPriceForTld(tld) {
  return TLD_PRICES[tld] || 15.00;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Make an authenticated request to the Cloudflare API v4.
 * @param {string} method  HTTP method
 * @param {string} cfPath  Path after api.cloudflare.com (include leading /)
 * @param {object} [body]  JSON body for POST/PUT/PATCH
 * @returns {Promise<object>} Parsed JSON result object
 */
function _cfRequest(method, cfPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.cloudflare.com',
      path:     cfPath,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.success) {
            const msg = (parsed.errors && parsed.errors[0] && parsed.errors[0].message) || 'Cloudflare API error';
            return reject(new Error(msg));
          }
          resolve(parsed.result);
        } catch (err) {
          reject(new Error(`Failed to parse Cloudflare response: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function _readDomains() {
  try {
    if (fs.existsSync(DOMAINS_FILE)) {
      return JSON.parse(fs.readFileSync(DOMAINS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { domains: [], zones: [] };
}

function _writeDomains(data) {
  fs.mkdirSync(path.dirname(DOMAINS_FILE), { recursive: true });
  fs.writeFileSync(DOMAINS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Domain availability
// ---------------------------------------------------------------------------

/**
 * Check whether a fully-qualified domain name is available using Cloudflare
 * DNS-over-HTTPS (DoH). NXDOMAIN (status 3) or no Answer section → likely available.
 *
 * Mock mode: uses a stable hash of the domain string for consistent results.
 *
 * @param {string} domain  e.g. 'mysite.com'
 * @returns {Promise<boolean>}
 */
async function checkAvailable(domain) {
  if (isMock) {
    // Stable hash: ~1/3 available, consistent per domain name
    const hash = [...domain].reduce((a, c) => a + c.charCodeAt(0), 0);
    return hash % 3 === 0;
  }
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`,
      { headers: { Accept: 'application/dns-json' } }
    );
    const data = await resp.json();
    // Status 3 = NXDOMAIN, or missing Answer array = not registered
    return data.Status === 3 || !data.Answer || data.Answer.length === 0;
  } catch (err) {
    console.warn(`[cloudflare] DoH check failed for ${domain}:`, err.message);
    return false;
  }
}

/**
 * Search for domain availability across common TLDs.
 * @param {string} query  Base name (e.g. 'joespizza') — alphanumeric + hyphens only
 * @returns {Promise<Array<{ domain, available, price, currency }>>}
 */
async function searchDomains(query) {
  const tlds = ['.com', '.io', '.app', '.co', '.net', '.dev', '.xyz'];
  const results = await Promise.all(
    tlds.map(async (tld) => {
      const domain    = `${query}${tld}`;
      const available = await checkAvailable(domain);
      return { domain, available, price: getPriceForTld(tld), currency: 'USD' };
    })
  );
  return results;
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

/**
 * Register a domain via Cloudflare Registrar.
 * Real mode: creates a zone then submits a registrar registration.
 * Mock mode: returns a fake success record.
 *
 * @param {string} domain
 * @param {number} [years=1]
 * @param {object} [contactInfo]
 * @returns {Promise<{ success, domain, expiresAt, zoneId, mockMode?, error? }>}
 */
async function registerDomain(domain, years, contactInfo) {
  const registrationYears = Number(years) || 1;

  if (isMock) {
    return {
      success:   true,
      domain,
      expiresAt: new Date(Date.now() + registrationYears * 365 * 24 * 60 * 60 * 1000).toISOString(),
      zoneId:    `zone_mock_${Math.random().toString(36).slice(2, 10)}`,
      mockMode:  true,
    };
  }

  try {
    // 1. Create (or get existing) zone
    let zoneId;
    try {
      const zoneResult = await _cfRequest('POST', '/client/v4/zones', {
        name:       domain,
        account:    { id: ACCOUNT_ID },
        jump_start: true,
      });
      zoneId = zoneResult.id;
    } catch (zoneErr) {
      // Zone may already exist — try to fetch it
      const existing = await _cfRequest('GET', `/client/v4/zones?name=${encodeURIComponent(domain)}&account.id=${ACCOUNT_ID}`);
      if (existing && existing.length > 0) {
        zoneId = existing[0].id;
      } else {
        return { success: false, domain, error: `Zone creation failed: ${zoneErr.message}` };
      }
    }

    // 2. Register via Registrar API
    const regResult = await _cfRequest(
      'POST',
      `/client/v4/accounts/${ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}`,
      {
        name:               domain,
        duration:           registrationYears,
        auto_renew:         true,
        privacy:            true,
        locked:             true,
        registrant_contact: contactInfo || {},
      }
    );

    return {
      success:   true,
      domain,
      expiresAt: regResult.expires_at,
      zoneId,
    };
  } catch (err) {
    return { success: false, domain, error: err.message };
  }
}

/**
 * List all domains in this Cloudflare account's Registrar.
 * @returns {Promise<Array>}
 */
async function listMyDomains() {
  if (isMock) {
    const data = _readDomains();
    return data.domains || [];
  }
  try {
    const result = await _cfRequest(
      'GET',
      `/client/v4/accounts/${ACCOUNT_ID}/registrar/domains`
    );
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.warn('[cloudflare] listMyDomains error:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Zone management
// ---------------------------------------------------------------------------

/**
 * Create a DNS zone for a domain.
 * @param {string} domain
 * @returns {Promise<{ id, name, status, nameservers }>}
 */
async function createZone(domain) {
  if (isMock) {
    const zone = {
      id:          `zone_mock_${Math.random().toString(36).slice(2, 10)}`,
      name:        domain,
      status:      'active',
      nameservers: ['ns1.mock-cf.com', 'ns2.mock-cf.com'],
    };
    const data = _readDomains();
    data.zones = data.zones || [];
    data.zones.push(zone);
    _writeDomains(data);
    return zone;
  }
  const result = await _cfRequest('POST', '/client/v4/zones', {
    name:       domain,
    account:    { id: ACCOUNT_ID },
    jump_start: true,
  });
  return {
    id:          result.id,
    name:        result.name,
    status:      result.status,
    nameservers: result.name_servers,
  };
}

/**
 * Get a zone by domain name.
 * @param {string} domain
 * @returns {Promise<{ id, name, status, nameservers }|null>}
 */
async function getZone(domain) {
  if (isMock) {
    const data = _readDomains();
    const zone = (data.zones || []).find(z => z.name === domain);
    return zone || null;
  }
  const results = await _cfRequest('GET', `/client/v4/zones?name=${encodeURIComponent(domain)}`);
  if (!results || results.length === 0) return null;
  const z = results[0];
  return {
    id:          z.id,
    name:        z.name,
    status:      z.status,
    nameservers: z.name_servers,
  };
}

// ---------------------------------------------------------------------------
// DNS records
// ---------------------------------------------------------------------------

/**
 * Add a DNS record to a zone.
 * Accepts either positional args (zoneId, type, name, content, ttl) or
 * an object (zoneId, { type, name, content, proxied, ttl }).
 */
async function addDnsRecord(zoneId, typeOrObj, name, content, ttl = 1) {
  let record;
  if (typeOrObj && typeof typeOrObj === 'object') {
    record = { ttl: 1, ...typeOrObj };
  } else {
    record = { type: typeOrObj, name, content, ttl };
  }

  if (isMock) {
    return {
      id:      `rec_mock_${Math.random().toString(36).slice(2, 10)}`,
      ...record,
    };
  }
  const result = await _cfRequest('POST', `/client/v4/zones/${zoneId}/dns_records`, record);
  return { id: result.id, type: result.type, name: result.name, content: result.content };
}

/**
 * Delete a DNS record from a zone.
 */
async function deleteDnsRecord(zoneId, recordId) {
  if (isMock) return;
  await _cfRequest('DELETE', `/client/v4/zones/${zoneId}/dns_records/${recordId}`);
}

// ---------------------------------------------------------------------------
// CDN
// ---------------------------------------------------------------------------

/**
 * Purge specific URLs from Cloudflare's CDN cache.
 */
async function purgeCache(zoneId, urls) {
  if (isMock) {
    console.log(`[cloudflare][mock] Purge cache for zone ${zoneId}:`, urls);
    return;
  }
  await _cfRequest('POST', `/client/v4/zones/${zoneId}/purge_cache`, { files: urls });
}

module.exports = {
  searchDomains,
  checkAvailable,
  getPriceForTld,
  registerDomain,
  listMyDomains,
  createZone,
  getZone,
  addDnsRecord,
  deleteDnsRecord,
  purgeCache,
  TLD_PRICES,
};
