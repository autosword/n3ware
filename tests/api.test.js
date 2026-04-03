#!/usr/bin/env node
/**
 * tests/api.test.js
 * Integration tests for the n3ware Cloud API.
 * Uses local storage backend against a live server started on a random port.
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── Configure test environment before requiring server ────────────────────────
const TEST_DATA_DIR = path.join('/tmp', `n3ware-test-${Date.now()}`);
process.env.STORAGE_BACKEND = 'local';
process.env.NODE_ENV        = 'test';
process.env.API_KEY         = 'test-master-key-abc123';
process.env.DATA_DIR        = TEST_DATA_DIR;
process.env.CDN_PROVIDER    = '';

// ── Tiny test runner ──────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
      passed++;
    })
    .catch(err => {
      process.stdout.write(`  \x1b[31m✕\x1b[0m ${name}\n`);
      process.stdout.write(`    \x1b[31m${err.message}\x1b[0m\n`);
      failed++;
      failures.push({ name, message: err.message });
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function section(title) {
  process.stdout.write(`\n\x1b[1m\x1b[34m${title}\x1b[0m\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Clear module cache so env vars are picked up fresh
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/src/')) delete require.cache[k];
  });

  const app    = require('../server');
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}`;

  const MASTER = 'test-master-key-abc123';
  let siteId, siteKey, revisionId1, revisionId2;

  // ── Site creation ───────────────────────────────────────────────────────────
  section('Site creation');

  await test('POST /api/sites returns siteId + apiKey', async () => {
    const res  = await fetch(`${BASE}/api/sites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': MASTER },
      body: JSON.stringify({ name: 'Test Site' }),
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const body = await res.json();
    assert(body.siteId, 'Missing siteId');
    assert(body.apiKey, 'Missing apiKey');
    siteId  = body.siteId;
    siteKey = body.apiKey;
  });

  await test('POST /api/sites rejects missing API key', async () => {
    const res = await fetch(`${BASE}/api/sites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized Site' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('POST /api/sites rejects wrong API key', async () => {
    const res = await fetch(`${BASE}/api/sites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'wrong-key' },
      body: JSON.stringify({ name: 'Bad Auth Site' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ── Site retrieval ──────────────────────────────────────────────────────────
  section('Site retrieval');

  await test('GET /api/sites/:id with master key returns metadata', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}`, {
      headers: { 'X-API-Key': MASTER },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.id === siteId, 'id mismatch');
    assert(!body.apiKey, 'apiKey should not be in response');
    assert(!body.html,   'html should not be in GET metadata response');
    assert(body.name === 'Test Site', `name mismatch: ${body.name}`);
  });

  await test('GET /api/sites/:id with site key returns metadata', async () => {
    const res = await fetch(`${BASE}/api/sites/${siteId}`, {
      headers: { 'X-API-Key': siteKey },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('GET /api/sites/nonexistent returns 404', async () => {
    const res = await fetch(`${BASE}/api/sites/does-not-exist`, {
      headers: { 'X-API-Key': MASTER },
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ── HTML save & cache invalidation ─────────────────────────────────────────
  section('Save HTML + cache invalidation');

  const HTML1 = '<html><body><h1>Hello World v1</h1></body></html>';
  const HTML2 = '<html><body><h1>Hello World v2</h1></body></html>';

  await test('POST /api/sites/:id/save creates revision', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': siteKey },
      body: JSON.stringify({ html: HTML1 }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.revisionId, 'Missing revisionId');
    assert(body.savedAt,    'Missing savedAt');
    revisionId1 = body.revisionId;
  });

  await test('GET /api/sites/:id/html returns saved HTML', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/html`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('Hello World v1'), 'Saved HTML not found in response');
  });

  await test('GET /api/sites/:id/html has correct Cache-Control', async () => {
    const res = await fetch(`${BASE}/api/sites/${siteId}/html`);
    const cc  = res.headers.get('cache-control') || '';
    assert(cc.includes('public'), `Expected public cache-control, got: ${cc}`);
    assert(cc.includes('max-age'), `Expected max-age, got: ${cc}`);
  });

  await test('POST /api/sites/:id/save a second time creates another revision', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': siteKey },
      body: JSON.stringify({ html: HTML2 }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.revisionId !== revisionId1, 'Second save should produce new revisionId');
    revisionId2 = body.revisionId;
  });

  await test('GET /api/sites/:id/html now returns v2 (cache invalidated)', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/html`);
    const text = await res.text();
    assert(text.includes('Hello World v2'), `Expected v2 HTML, got: ${text.slice(0, 100)}`);
  });

  await test('POST /api/sites/:id/save rejects missing html', async () => {
    const res = await fetch(`${BASE}/api/sites/${siteId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': siteKey },
      body: JSON.stringify({}),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // ── Revisions ──────────────────────────────────────────────────────────────
  section('Revision listing');

  await test('GET /api/sites/:id/revisions returns list', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/revisions`, {
      headers: { 'X-API-Key': siteKey },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Expected array');
    assert(body.length >= 2, `Expected >= 2 revisions, got ${body.length}`);
  });

  await test('GET /api/sites/:id/revisions/:revId returns specific revision', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/revisions/${revisionId1}`, {
      headers: { 'X-API-Key': siteKey },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.id === revisionId1, 'Revision id mismatch');
    assert(body.html,              'Revision should include html');
    assert(body.html.includes('Hello World v1'), 'Revision html should be v1');
  });

  await test('GET revision for unknown id returns 404', async () => {
    const res = await fetch(`${BASE}/api/sites/${siteId}/revisions/does-not-exist`, {
      headers: { 'X-API-Key': siteKey },
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ── Rollback ───────────────────────────────────────────────────────────────
  section('Rollback');

  await test('POST /api/sites/:id/revisions/:revId/rollback restores HTML', async () => {
    const res = await fetch(`${BASE}/api/sites/${siteId}/revisions/${revisionId1}/rollback`, {
      method: 'POST',
      headers: { 'X-API-Key': siteKey },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.revisionId,              'Missing new revisionId after rollback');
    assert(body.rolledBackTo === revisionId1, 'rolledBackTo mismatch');
  });

  await test('GET /api/sites/:id/html returns v1 after rollback', async () => {
    const res  = await fetch(`${BASE}/api/sites/${siteId}/html`);
    const text = await res.text();
    assert(text.includes('Hello World v1'), `Expected v1 HTML after rollback, got: ${text.slice(0, 100)}`);
  });

  // ── Site serving ───────────────────────────────────────────────────────────
  section('Site serving middleware');

  await test('GET /sites/:siteId serves HTML with injected n3ware.js', async () => {
    const res  = await fetch(`${BASE}/sites/${siteId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('n3ware.js'),        'Expected n3ware.js injection');
    assert(text.includes(`data-n3-site="${siteId}"`), 'Expected data-n3-site attribute');
  });

  await test('GET /sites/nonexistent returns 404', async () => {
    const res = await fetch(`${BASE}/sites/does-not-exist`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ── Cleanup + summary ──────────────────────────────────────────────────────
  server.close();
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  const total = passed + failed;
  process.stdout.write(`\n${'─'.repeat(50)}\n`);
  if (failed === 0) {
    process.stdout.write(`\x1b[32m✓ All ${total} API tests passed\x1b[0m\n\n`);
    process.exit(0);
  } else {
    process.stdout.write(`\x1b[31m✕ ${failed}/${total} API tests failed\x1b[0m\n`);
    failures.forEach(f => process.stdout.write(`  - ${f.name}: ${f.message}\n`));
    process.stdout.write('\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
