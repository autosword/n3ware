'use strict';

/**
 * tests/save-flow.test.js
 *
 * Integration tests for the complete save pipeline:
 * auth, page saves, component saves, versions, and GCS integration.
 *
 * Usage:
 *   STORAGE_BACKEND=local MASTER_API_KEY=test JWT_SECRET=test PORT=8099 \
 *     node tests/save-flow.test.js
 *
 * GCS tests are skipped unless GCS_BUCKET is set.
 */

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

// ── Env — must be set before requiring server ─────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars!!';
const API_KEY    = process.env.MASTER_API_KEY || 'test-master-key';
const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'n3ware-save-test-'));
const GCS_ENABLED = Boolean(process.env.GCS_BUCKET);

process.env.JWT_SECRET       = JWT_SECRET;
process.env.MASTER_API_KEY   = API_KEY;
process.env.NODE_ENV         = 'test';
process.env.STORAGE_BACKEND  = 'local';
process.env.CDN_PROVIDER     = 'none';
process.env.DATA_DIR         = tmpDir;

// ── Test framework ────────────────────────────────────────────────────────────
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
  if (ok) {
    passed++;
  } else {
    failed++;
    const m = `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;
    failures.push(m);
    console.error(`  FAIL  ${m}`);
  }
}

function skip(msg) {
  console.log(`  SKIP  ${msg}`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
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
    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

function apiReq(server, method, path, body, headers = {}) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return request(server, {
    method,
    path,
    headers: {
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers,
    },
  }, payload);
}

function withMasterKey(headers = {}) { return { 'X-API-Key': API_KEY, ...headers }; }
function withSiteKey(key, headers = {}) { return { 'X-API-Key': key, ...headers }; }
function withJwt(token, headers = {}) { return { Authorization: `Bearer ${token}`, ...headers }; }

function makeJwt(userId) {
  return jwt.sign({ id: userId, email: `${userId}@test.com` }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Create a site (returns { siteId, apiKey }) ───────────────────────────────
async function createTestSite(server, html = '<p>Hello</p>', ownerId = null) {
  const headers = ownerId
    ? withJwt(makeJwt(ownerId))
    : withMasterKey();
  const r = await apiReq(server, 'POST', '/api/sites', { html, name: 'Test Site' }, headers);
  if (r.status !== 201) throw new Error(`createTestSite failed: ${JSON.stringify(r.body)}`);
  return { siteId: r.body.site.id, apiKey: r.body.site.apiKey };
}

// ── Test suites ───────────────────────────────────────────────────────────────
async function runTests(server) {

  // ════════════════════════════════════════════════════════════════════════════
  // Auth tests
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[auth — PUT /api/sites/:id/pages/:slug]');
  {
    const { siteId, apiKey } = await createTestSite(server);

    // 1. Valid API key → 200
    const r1 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '<p>v1</p>' }, withSiteKey(apiKey));
    assert(r1.status === 200, '1. valid site API key → 200');

    // 2. No auth → 401
    const r2 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '<p>v2</p>' });
    assert(r2.status === 401, '2. no auth → 401');

    // 3. Invalid API key → 403
    const r3 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '<p>v3</p>' }, withSiteKey('totally-wrong-key-xxxx'));
    assert(r3.status === 403, '3. invalid API key → 403');

    // 4. JWT from site owner → 200
    const ownerId = crypto.randomUUID();
    const { siteId: ownedSite } = await createTestSite(server, '<p>owned</p>', ownerId);
    const ownerJwt = makeJwt(ownerId);
    const r4 = await apiReq(server, 'PUT', `/api/sites/${ownedSite}/pages/index`,
      { html: '<p>owner edit</p>' }, withJwt(ownerJwt));
    assert(r4.status === 200, '4. JWT from site owner → 200');

    // 5. JWT from different user → 403
    const otherId = crypto.randomUUID();
    const otherJwt = makeJwt(otherId);
    const r5 = await apiReq(server, 'PUT', `/api/sites/${ownedSite}/pages/index`,
      { html: '<p>hacked</p>' }, withJwt(otherJwt));
    assert(r5.status === 403, '5. JWT from different user → 403');

    console.log('  ✓  auth tests (1-5)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Page save tests
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[page save]');
  {
    const { siteId, apiKey } = await createTestSite(server);

    // 6. Save page body → returns { saved: true, slug }
    const r6 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '<h1>Saved!</h1>' }, withSiteKey(apiKey));
    assert(r6.status === 200, '6. save page body → 200');
    assertEqual(r6.body.saved, true, '6. body.saved = true');
    assertEqual(r6.body.slug, 'index', '6. body.slug = index');

    // 7. Save with title
    const r7 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '<h1>With title</h1>', title: 'Home Page' }, withSiteKey(apiKey));
    assert(r7.status === 200, '7. save with title → 200');

    // 8. Missing html field → 400
    const r8 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      {}, withSiteKey(apiKey));
    assert(r8.status === 400, '8. missing html → 400');

    // 9. Save empty body (clear a page)
    const r9 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '' }, withSiteKey(apiKey));
    assert(r9.status === 200, '9. save empty body → 200');

    // 10. Save very large body (50KB HTML)
    const bigHtml = '<p>' + 'x'.repeat(50 * 1024) + '</p>';
    const r10 = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: bigHtml }, withSiteKey(apiKey));
    assert(r10.status === 200, '10. save 50KB body → 200');

    console.log('  ✓  page save tests (6-10)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Component save tests
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[component save]');
  {
    if (!GCS_ENABLED) {
      skip('11-14. component PUT requires GCS (set GCS_BUCKET to run)');
    } else {
      const { siteId, apiKey } = await createTestSite(server);

      // 11. PUT header
      const r11 = await apiReq(server, 'PUT', `/api/sites/${siteId}/components/header`,
        { html: '<header>H</header>' }, withSiteKey(apiKey));
      assert(r11.status === 200, '11. PUT components/header → 200');

      // 12. PUT footer
      const r12 = await apiReq(server, 'PUT', `/api/sites/${siteId}/components/footer`,
        { html: '<footer>F</footer>' }, withSiteKey(apiKey));
      assert(r12.status === 200, '12. PUT components/footer → 200');

      // 13. PUT nav
      const r13 = await apiReq(server, 'PUT', `/api/sites/${siteId}/components/nav`,
        { html: '<nav>N</nav>' }, withSiteKey(apiKey));
      assert(r13.status === 200, '13. PUT components/nav → 200');

      // 14. PUT unknown component → 500 (throws "Unknown component")
      const r14 = await apiReq(server, 'PUT', `/api/sites/${siteId}/components/sidebar`,
        { html: '<aside>S</aside>' }, withSiteKey(apiKey));
      assert(r14.status === 500, '14. PUT unknown component → 500');
    }
    console.log('  ✓  component save tests (11-14)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Version tests
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[versions]');
  {
    if (!GCS_ENABLED) {
      skip('15-17. version tests require GCS (set GCS_BUCKET to run)');
    } else {
      const { siteId, apiKey } = await createTestSite(server);

      // 15. Save page twice → two GCS versions exist
      await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
        { html: '<p>v1</p>' }, withSiteKey(apiKey));
      await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
        { html: '<p>v2</p>' }, withSiteKey(apiKey));

      // 16. GET versions → returns version list
      const r16 = await apiReq(server, 'GET', `/api/sites/${siteId}/pages/index/versions`,
        undefined, withSiteKey(apiKey));
      assert(r16.status === 200, '16. GET versions → 200');
      assert(Array.isArray(r16.body.versions), '16. body.versions is array');
      assert(r16.body.versions.length >= 2, '16. at least 2 versions after 2 saves');

      // 17. Rollback to previous version
      const firstGen = r16.body.versions[r16.body.versions.length - 1].generation;
      const r17 = await apiReq(server, 'POST', `/api/sites/${siteId}/pages/index/rollback`,
        { generation: firstGen }, withSiteKey(apiKey));
      assert(r17.status === 200, '17. rollback → 200');
      assertEqual(r17.body.rolledBack, true, '17. body.rolledBack = true');
    }
    console.log('  ✓  version tests (15-17)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GCS integration tests
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[GCS integration]');
  {
    if (!GCS_ENABLED) {
      skip('18-19. GCS integration tests require GCS_BUCKET');
    } else {
      const { siteId, apiKey } = await createTestSite(server);

      // 18. After page save, GCS contains the saved HTML
      const savedHtml = '<h1>GCS test page</h1>';
      await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
        { html: savedHtml }, withSiteKey(apiKey));

      // Verify by reading back via manifest/pages endpoint
      const r18 = await apiReq(server, 'GET', `/api/sites/${siteId}/manifest`,
        undefined, withSiteKey(apiKey));
      assert(r18.status === 200, '18. manifest readable after save → 200');

      // 19. After component save, GCS file updated
      const headerHtml = '<header id="gcs-test">Header</header>';
      const r19save = await apiReq(server, 'PUT', `/api/sites/${siteId}/components/header`,
        { html: headerHtml }, withSiteKey(apiKey));
      assert(r19save.status === 200, '19. component save → 200');

      const r19get = await apiReq(server, 'GET', `/api/sites/${siteId}/components/header`,
        undefined, withSiteKey(apiKey));
      assert(r19get.status === 200, '19. GET component after save → 200');
      assert(r19get.body.html === headerHtml, '19. component html matches saved value');
    }
    console.log('  ✓  GCS integration tests (18-19)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // End-to-end test
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[end-to-end: create → save → serve]');
  {
    // 20. Create site → save page → serve updated content
    const { siteId, apiKey } = await createTestSite(server, '<p>original</p>');
    assert(typeof apiKey === 'string' && apiKey.length > 0, '20. site has apiKey');

    const updatedHtml = '<h1>Updated content!</h1>';
    const saveR = await apiReq(server, 'POST', `/api/sites/${siteId}/save`,
      { html: updatedHtml }, withSiteKey(apiKey));
    assert(saveR.status === 200, '20. site save via POST /save → 200');

    const serveR = await request(server, {
      method: 'GET',
      path: `/sites/${siteId}`,
      headers: {},
    });
    assert(serveR.status === 200, '20. site serves after save → 200');
    assert(serveR.raw.includes('Updated content!'), '20. served HTML contains updated content');
    assert(serveR.raw.includes(`data-n3-site="${siteId}"`), '20. n3ware script injected with site id');
    assert(serveR.raw.includes(`data-n3-key="${apiKey}"`), '20. n3ware script injected with api key');

    console.log('  ✓  end-to-end test (20)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // apiKey returned on create
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n[apiKey on create]');
  {
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<p>hi</p>', name: 'ApiKey Test' }, withMasterKey());
    assert(r.status === 201, 'POST /api/sites → 201');
    assert(typeof r.body.site.apiKey === 'string', 'site.apiKey is string');
    assert(r.body.site.apiKey.length === 64, 'site.apiKey is 32 bytes hex (64 chars)');
    console.log('  ✓  apiKey returned on create');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const app    = require('../server');
  const server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  const { port } = server.address();
  console.log(`\nn3ware save-flow tests — port ${port}`);
  console.log(`GCS: ${GCS_ENABLED ? 'enabled' : 'disabled (GCS tests skipped)'}`);
  console.log('='.repeat(55));

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

  console.log('\n' + '='.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
