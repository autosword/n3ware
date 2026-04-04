'use strict';

/**
 * Domain search + registration tests.
 *
 * Run: MASTER_API_KEY=test JWT_SECRET=test node tests/domains.test.js
 */

const assert  = require('assert');
const http    = require('http');

const BASE_URL  = process.env.BASE_URL  || 'http://localhost:8080';
const API_KEY   = process.env.MASTER_API_KEY || 'test';

let passed = 0;
let failed = 0;

async function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    API_KEY,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

// ── Unit-level tests (import cloudflare.js directly) ─────────────────────────

const cf = require('../src/integrations/cloudflare');

async function runUnitTests() {
  console.log('\n[Unit] cloudflare.js');

  await test('getPriceForTld: .com returns 10.44', () => {
    assert.strictEqual(cf.getPriceForTld('.com'), 10.44);
  });

  await test('getPriceForTld: .io returns 32.00', () => {
    assert.strictEqual(cf.getPriceForTld('.io'), 32.00);
  });

  await test('getPriceForTld: .app returns 14.00', () => {
    assert.strictEqual(cf.getPriceForTld('.app'), 14.00);
  });

  await test('getPriceForTld: unknown TLD falls back to 15.00', () => {
    assert.strictEqual(cf.getPriceForTld('.unknown'), 15.00);
  });

  await test('TLD_PRICES contains at least 8 entries', () => {
    assert.ok(Object.keys(cf.TLD_PRICES).length >= 8, `Only ${Object.keys(cf.TLD_PRICES).length} entries`);
  });

  await test('checkAvailable: consistent hash result per domain (mock mode)', async () => {
    // In mock mode, result is deterministic based on char sum
    const r1 = await cf.checkAvailable('example.com');
    const r2 = await cf.checkAvailable('example.com');
    assert.strictEqual(r1, r2, 'Should be consistent across calls');
  });

  await test('checkAvailable: returns boolean', async () => {
    const r = await cf.checkAvailable('test-domain-xyz.com');
    assert.strictEqual(typeof r, 'boolean');
  });

  await test('searchDomains: returns 7 results for valid query', async () => {
    const results = await cf.searchDomains('joespizza');
    assert.strictEqual(results.length, 7);
  });

  await test('searchDomains: each result has required fields', async () => {
    const results = await cf.searchDomains('testquery');
    results.forEach(r => {
      assert.ok(typeof r.domain    === 'string',  `domain missing: ${JSON.stringify(r)}`);
      assert.ok(typeof r.available === 'boolean', `available missing: ${JSON.stringify(r)}`);
      assert.ok(typeof r.price     === 'number',  `price missing: ${JSON.stringify(r)}`);
      assert.strictEqual(r.currency, 'USD');
    });
  });

  await test('searchDomains: domains use the query as base', async () => {
    const results = await cf.searchDomains('mybiz');
    results.forEach(r => {
      assert.ok(r.domain.startsWith('mybiz'), `Domain ${r.domain} doesn't start with mybiz`);
    });
  });

  await test('registerDomain: mock mode returns success with expiry', async () => {
    const result = await cf.registerDomain('mockdomain.com', 1, {});
    assert.strictEqual(result.success, true);
    assert.ok(result.expiresAt, 'expiresAt missing');
    assert.ok(result.mockMode, 'mockMode flag missing');
  });

  await test('registerDomain: expiry is ~1 year from now', async () => {
    const result = await cf.registerDomain('anotherdomain.io', 1, {});
    const exp = new Date(result.expiresAt).getTime();
    const now = Date.now();
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    assert.ok(diffDays > 360 && diffDays < 370, `Expected ~365 days, got ${diffDays.toFixed(1)}`);
  });

  await test('listMyDomains: returns array in mock mode', async () => {
    const domains = await cf.listMyDomains();
    assert.ok(Array.isArray(domains));
  });
}

// ── API endpoint tests ────────────────────────────────────────────────────────

async function runApiTests() {
  console.log('\n[API] /api/domains');

  await test('GET /api/domains/search: returns results for valid query', async () => {
    const { status, body } = await req('GET', '/api/domains/search?q=joespizza');
    assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(Array.isArray(body.results), 'results should be array');
    assert.ok(body.results.length > 0, 'results should not be empty');
  });

  await test('GET /api/domains/search: strips non-alphanumeric from query', async () => {
    const { status, body } = await req('GET', '/api/domains/search?q=joe%20pizza!');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    body.results.forEach(r => {
      assert.ok(!r.domain.includes(' '), 'Domain should not contain spaces');
      assert.ok(!r.domain.includes('!'), 'Domain should not contain !');
    });
  });

  await test('GET /api/domains/search: rejects empty query', async () => {
    const { status } = await req('GET', '/api/domains/search?q=');
    assert.strictEqual(status, 400);
  });

  await test('GET /api/domains/search: missing q returns 400', async () => {
    const { status } = await req('GET', '/api/domains/search');
    assert.strictEqual(status, 400);
  });

  await test('GET /api/domains/search: results have available + price', async () => {
    const { body } = await req('GET', '/api/domains/search?q=testbiz');
    body.results.forEach(r => {
      assert.ok('available' in r, 'missing available');
      assert.ok('price'     in r, 'missing price');
    });
  });

  await test('POST /api/domains/register: registers in mock mode', async () => {
    const { status, body } = await req('POST', '/api/domains/register', { domain: 'mocktest.com', years: 1 });
    assert.strictEqual(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.strictEqual(body.success, true);
    assert.ok(body.domain, 'domain missing from response');
  });

  await test('POST /api/domains/register: missing domain returns 400', async () => {
    const { status } = await req('POST', '/api/domains/register', {});
    assert.strictEqual(status, 400);
  });

  await test('GET /api/domains: returns domains array', async () => {
    const { status, body } = await req('GET', '/api/domains');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.ok(Array.isArray(body.domains), 'domains should be array');
  });

  await test('GET /api/domains/search: rejects special characters only', async () => {
    const { status } = await req('GET', '/api/domains/search?q=!!!');
    assert.strictEqual(status, 400);
  });

  await test('POST /api/domains/register: includes mockMode note in response', async () => {
    const { body } = await req('POST', '/api/domains/register', { domain: 'notareal.io', years: 1 });
    // In mock mode (no CF token), mockMode should be true and note should be present
    if (body.mockMode) {
      assert.ok(body.note && body.note.includes('MOCK'), 'Mock note should mention MOCK');
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('=== Domain Tests ===');
  await runUnitTests();
  await runApiTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
