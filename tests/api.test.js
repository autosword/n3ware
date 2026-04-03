'use strict';

/**
 * API integration tests — runs against a live server with local storage.
 *
 * Usage:
 *   MASTER_API_KEY=test node tests/api.test.js
 */

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── Env setup ────────────────────────────────────────────────────────────────
const API_KEY = process.env.MASTER_API_KEY || 'test-key-123';
process.env.MASTER_API_KEY   = API_KEY;
process.env.NODE_ENV         = 'test';
process.env.STORAGE_BACKEND  = 'local';
process.env.CDN_PROVIDER     = 'none';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n3ware-test-'));
process.env.DATA_DIR = tmpDir;

// ── Load app after env is configured ─────────────────────────────────────────
const app = require('../server');

// ── Test framework ───────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error(`  FAIL  ${msg}`);
  }
}

function assertEqual(a, b, msg) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    failed++;
    const m = `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;
    failures.push(m);
    console.error(`  FAIL  ${m}`);
  } else {
    passed++;
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request({ host: '127.0.0.1', port, ...options }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

function get(server, path, key = API_KEY) {
  return request(server, {
    method: 'GET',
    path,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
  });
}

function post(server, path, body, key = API_KEY) {
  const payload = JSON.stringify(body);
  return request(server, {
    method: 'POST',
    path,
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);
}

function del(server, path, key = API_KEY) {
  return request(server, {
    method: 'DELETE',
    path,
    headers: { 'X-API-Key': key },
  });
}

// ── Test suites ───────────────────────────────────────────────────────────────
async function runTests(server) {
  let siteId;
  let revId;

  // ── Health check ─────────────────────────────────────────────────────────
  console.log('\n[health]');
  {
    const r = await get(server, '/health', '');
    assert(r.status === 200, 'GET /health → 200');
    assert(r.body.status === 'ok', 'health body.status = ok');
    assert(typeof r.body.ts === 'string', 'health body.ts is string');
    console.log('  ✓  GET /health');
  }

  // ── Auth middleware ───────────────────────────────────────────────────────
  console.log('\n[auth]');
  {
    const r1 = await get(server, '/api/sites', '');
    assert(r1.status === 401, 'no key → 401');

    const r2 = await get(server, '/api/sites', 'wrong-key');
    assert(r2.status === 403, 'wrong key → 403');

    const r3 = await get(server, '/api/sites');
    assert(r3.status === 200, 'valid key → 200');
    console.log('  ✓  auth middleware');
  }

  // ── List sites (empty) ────────────────────────────────────────────────────
  console.log('\n[sites list]');
  {
    const r = await get(server, '/api/sites');
    assert(r.status === 200, 'GET /api/sites → 200');
    // Response: { sites: [...] }
    assert(Array.isArray(r.body.sites), 'body.sites is array');
    assertEqual(r.body.sites.length, 0, 'initially empty');
    console.log('  ✓  list empty');
  }

  // ── Create site ───────────────────────────────────────────────────────────
  console.log('\n[create site]');
  {
    const r = await post(server, '/api/sites', {
      html: '<html><body><h1>Hello World</h1></body></html>',
      message: 'Initial save',
    });
    // Response: { site: { id, message, createdAt, ... } }
    assert(r.status === 201, 'POST /api/sites → 201');
    assert(r.body.site, 'body.site present');
    assert(typeof r.body.site.id === 'string', 'body.site.id is string');
    assert(r.body.site.id.length > 0, 'body.site.id is non-empty');
    assert(r.body.site.message === 'Initial save', 'body.site.message matches');
    assert(typeof r.body.site.createdAt === 'string', 'body.site.createdAt is string');
    siteId = r.body.site.id;
    console.log(`  ✓  created site ${siteId}`);
  }

  // ── Get site metadata (no html in list view) ──────────────────────────────
  console.log('\n[get site metadata]');
  {
    const r = await get(server, `/api/sites/${siteId}`);
    // GET /:id returns { site: meta } without html field
    assert(r.status === 200, 'GET /api/sites/:id → 200');
    assert(r.body.site, 'body.site present');
    assertEqual(r.body.site.id, siteId, 'body.site.id matches');
    console.log('  ✓  get site metadata');
  }

  // ── Get site HTML ─────────────────────────────────────────────────────────
  console.log('\n[get site html]');
  {
    const r = await get(server, `/api/sites/${siteId}/html`);
    assert(r.status === 200, 'GET /api/sites/:id/html → 200');
    assert(r.raw.includes('Hello World'), 'html contains content');
    console.log('  ✓  get site html');
  }

  // ── List sites (one) ──────────────────────────────────────────────────────
  console.log('\n[sites list after create]');
  {
    const r = await get(server, '/api/sites');
    assert(r.status === 200, 'GET /api/sites → 200');
    assert(Array.isArray(r.body.sites), 'body.sites is array');
    assertEqual(r.body.sites.length, 1, 'one site');
    assertEqual(r.body.sites[0].id, siteId, 'correct site id');
    console.log('  ✓  list has one site');
  }

  // ── Save site (update) ────────────────────────────────────────────────────
  console.log('\n[save site]');
  {
    const r = await post(server, `/api/sites/${siteId}/save`, {
      html: '<html><body><h1>Updated Content</h1><p>New paragraph</p></body></html>',
      message: 'Second revision',
    });
    // Response: { site: meta } (no html)
    assert(r.status === 200, 'POST /api/sites/:id/save → 200');
    assert(r.body.site, 'body.site present');
    assertEqual(r.body.site.id, siteId, 'body.site.id matches');
    assert(typeof r.body.site.updatedAt === 'string', 'updatedAt set');
    // Verify html via /html endpoint
    const r2 = await get(server, `/api/sites/${siteId}/html`);
    assert(r2.raw.includes('Updated Content'), 'html actually updated');
    console.log('  ✓  save site');
  }

  // ── HTML sanitization ─────────────────────────────────────────────────────
  console.log('\n[html sanitization]');
  {
    const r = await post(server, '/api/sites', {
      html: '<html><body><h1>Safe</h1><script>alert(1)</script><img onerror="xss()" src="x"></body></html>',
      message: 'XSS test',
    });
    assert(r.status === 201, 'create with XSS → 201');
    // Need to check the actual html stored — fetch it
    const r2 = await get(server, `/api/sites/${r.body.site.id}/html`);
    assert(!r2.raw.includes('<script>'), 'script tags removed');
    assert(!r2.raw.includes('onerror'), 'onerror removed');
    assert(r2.raw.includes('Safe'), 'safe content preserved');
    await del(server, `/api/sites/${r.body.site.id}`);
    console.log('  ✓  html sanitization');
  }

  // ── Get revisions ─────────────────────────────────────────────────────────
  console.log('\n[revisions]');
  {
    const r = await get(server, `/api/sites/${siteId}/revisions`);
    // Response: { revisions: [...] }
    assert(r.status === 200, 'GET /api/sites/:id/revisions → 200');
    assert(Array.isArray(r.body.revisions), 'body.revisions is array');
    assert(r.body.revisions.length >= 2, 'at least 2 revisions (create + save)');
    // Most recent first
    assert(r.body.revisions[0].createdAt >= r.body.revisions[1].createdAt, 'sorted newest first');
    revId = r.body.revisions[r.body.revisions.length - 1].id; // oldest revision
    console.log(`  ✓  ${r.body.revisions.length} revisions, oldest revId=${revId}`);
  }

  // ── Get single revision ───────────────────────────────────────────────────
  console.log('\n[get revision]');
  {
    const r = await get(server, `/api/sites/${siteId}/revisions/${revId}`);
    // Response: { revision: { id, html, ... } }
    assert(r.status === 200, 'GET /api/sites/:id/revisions/:revId → 200');
    assert(r.body.revision, 'body.revision present');
    assertEqual(r.body.revision.id, revId, 'body.revision.id matches');
    assert(typeof r.body.revision.html === 'string', 'body.revision.html present');
    assert(r.body.revision.html.includes('Hello World'), 'oldest rev has original html');
    console.log('  ✓  get single revision');
  }

  // ── Rollback ──────────────────────────────────────────────────────────────
  console.log('\n[rollback]');
  {
    const r = await post(server, `/api/sites/${siteId}/revisions/${revId}/rollback`, {});
    assert(r.status === 200, 'POST rollback → 200');

    // Verify current state via /html
    const r2 = await get(server, `/api/sites/${siteId}/html`);
    assert(r2.raw.includes('Hello World'), 'current site shows rolled back html');
    console.log('  ✓  rollback');
  }

  // ── 404 on missing site ───────────────────────────────────────────────────
  console.log('\n[not found]');
  {
    const r = await get(server, '/api/sites/nonexistent-id-xyz');
    assert(r.status === 404, 'missing site → 404');
    assert(r.body.error, 'error message present');

    const r2 = await get(server, '/api/sites/nonexistent-id-xyz/revisions');
    assert(r2.status === 404, 'revisions of missing site → 404');
    console.log('  ✓  404 handling');
  }

  // ── Site serving ──────────────────────────────────────────────────────────
  console.log('\n[site serving]');
  {
    // Save a proper HTML page first
    await post(server, `/api/sites/${siteId}/save`, {
      html: '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Live Site</h1></body></html>',
      message: 'Serving test',
    });

    const r = await request(server, {
      method: 'GET',
      path: `/sites/${siteId}`,
      headers: {},
    });
    assert(r.status === 200, `GET /sites/${siteId} → 200`);
    assert(r.raw.includes('Live Site'), 'site content served');
    assert(r.raw.includes('n3ware'), 'n3ware script injected');
    assert(r.raw.includes(`data-n3-site="${siteId}"`), 'data-n3-site injected');
    assert(r.headers['cache-control'] && r.headers['cache-control'].includes('s-maxage'), 'cache-control set');
    assert(r.headers['x-site-id'] === siteId, 'X-Site-Id header present');
    console.log('  ✓  site serving with editor injection');
  }

  // ── Site serving 404 ─────────────────────────────────────────────────────
  {
    const r = await request(server, {
      method: 'GET',
      path: '/sites/no-such-site-abc',
      headers: {},
    });
    assert(r.status === 404, 'missing site → 404 page');
    assert(r.raw.includes('404'), '404 page content');
    console.log('  ✓  site serving 404');
  }

  // ── Delete site ───────────────────────────────────────────────────────────
  console.log('\n[delete site]');
  {
    const r = await del(server, `/api/sites/${siteId}`);
    assert(r.status === 200, 'DELETE /api/sites/:id → 200');
    assert(r.body.deleted === true, 'deleted flag set');

    const r2 = await get(server, `/api/sites/${siteId}`);
    assert(r2.status === 404, 'deleted site → 404');

    const r3 = await get(server, '/api/sites');
    assert(Array.isArray(r3.body.sites) && r3.body.sites.length === 0, 'list is empty after delete');
    console.log('  ✓  delete site');
  }

  // ── Cache stats (internal) ────────────────────────────────────────────────
  console.log('\n[cache stats]');
  {
    const r1 = await get(server, '/api/cache/stats', '');
    assert(r1.status === 403, 'cache stats without key → 403');

    const r2 = await request(server, {
      method: 'GET',
      path: '/api/cache/stats',
      headers: { 'X-API-Key': API_KEY },
    });
    assert(r2.status === 200, 'cache stats with key → 200');
    assert(typeof r2.body.size === 'number', 'stats.size is number');
    assert(r2.body.hitRate !== undefined, 'stats.hitRate is present');
    console.log('  ✓  cache stats');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const server = app.listen(0); // random port
  await new Promise(r => server.on('listening', r));
  const { port } = server.address();
  console.log(`\nn3ware API tests — port ${port}`);
  console.log('='.repeat(50));

  try {
    await runTests(server);
  } catch (err) {
    console.error('\nUnhandled test error:', err);
    failed++;
    failures.push(err.message);
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
