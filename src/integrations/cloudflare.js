'use strict';

/**
 * Cloudflare integration — domain management + CDN.
 *
 * Mock mode: CLOUDFLARE_API_TOKEN not set.
 *   - Returns fake domain data
 *   - Stores domain records in data/domains.json
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for domain availability.
 * @param {string} query  Base domain name to search (e.g. "mysite")
 * @returns {Promise<Array<{ domain, available, price, currency }>>}
 */
async function searchDomains(query) {
  if (isMock) {
    const tlds = ['.com', '.net', '.org', '.io', '.co'];
    const prices = [1000, 1500, 1200, 3000, 2500];
    return tlds.map((tld, i) => ({
      domain:    `${query}${tld}`,
      available: Math.random() > 0.3,
      price:     prices[i],
      currency:  'USD',
    }));
  }
  const results = await _cfRequest(
    'POST',
    `/client/v4/accounts/${ACCOUNT_ID}/registrar/domains/search`,
    { query, limit: 10 }
  );
  return Array.isArray(results) ? results : [];
}

/**
 * Register a domain.
 * @param {string} domain
 * @param {object} contactInfo
 * @returns {Promise<{ id, name, status, expiresAt }>}
 */
async function registerDomain(domain, contactInfo) {
  if (isMock) {
    const data = _readDomains();
    const record = {
      id:        `dom_mock_${Math.random().toString(36).slice(2, 10)}`,
      name:      domain,
      status:    'registered',
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      contact:   contactInfo || {},
    };
    data.domains.push(record);
    _writeDomains(data);
    return { id: record.id, name: record.name, status: record.status, expiresAt: record.expiresAt };
  }
  const result = await _cfRequest(
    'POST',
    `/client/v4/accounts/${ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}/registration`,
    { contacts: contactInfo }
  );
  return {
    id:        result.id,
    name:      result.name,
    status:    result.status,
    expiresAt: result.expires_at,
  };
}

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
      nameservers: [`ns1.mock-cf.com`, `ns2.mock-cf.com`],
    };
    const data = _readDomains();
    data.zones = data.zones || [];
    data.zones.push(zone);
    _writeDomains(data);
    return zone;
  }
  const result = await _cfRequest('POST', '/client/v4/zones', {
    name:    domain,
    account: { id: ACCOUNT_ID },
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

/**
 * Add a DNS record to a zone.
 * @param {string} zoneId
 * @param {string} type     e.g. 'A', 'CNAME', 'TXT'
 * @param {string} name
 * @param {string} content
 * @param {number} [ttl=1]  1 = automatic
 * @returns {Promise<{ id, type, name, content }>}
 */
async function addDnsRecord(zoneId, type, name, content, ttl = 1) {
  if (isMock) {
    return {
      id:      `rec_mock_${Math.random().toString(36).slice(2, 10)}`,
      type,
      name,
      content,
    };
  }
  const result = await _cfRequest('POST', `/client/v4/zones/${zoneId}/dns_records`, {
    type, name, content, ttl,
  });
  return { id: result.id, type: result.type, name: result.name, content: result.content };
}

/**
 * Delete a DNS record from a zone.
 * @param {string} zoneId
 * @param {string} recordId
 * @returns {Promise<void>}
 */
async function deleteDnsRecord(zoneId, recordId) {
  if (isMock) {
    return;
  }
  await _cfRequest('DELETE', `/client/v4/zones/${zoneId}/dns_records/${recordId}`);
}

/**
 * Purge specific URLs from Cloudflare's CDN cache.
 * @param {string}   zoneId
 * @param {string[]} urls
 * @returns {Promise<void>}
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
  registerDomain,
  createZone,
  getZone,
  addDnsRecord,
  deleteDnsRecord,
  purgeCache,
};
