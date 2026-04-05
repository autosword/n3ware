'use strict';

/**
 * tests/media.test.js — Integration tests for the media manager API.
 *
 * Usage:
 *   MASTER_API_KEY=test JWT_SECRET=test NODE_ENV=test node tests/media.test.js
 *
 * GCS-dependent tests (usage scanning) are skipped unless GCS_SITES_BUCKET or
 * GCS_BUCKET is set.
 */

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── Env — must be set before requiring server ─────────────────────────────────
const API_KEY = process.env.MASTER_API_KEY || 'test';
const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'n3ware-media-test-'));

process.env.MASTER_API_KEY  = API_KEY;
process.env.NODE_ENV        = 'test';
process.env.STORAGE_BACKEND = 'local';
process.env.CDN_PROVIDER    = 'none';
process.env.DATA_DIR        = tmpDir;

const GCS_ENABLED = Boolean(process.env.GCS_SITES_BUCKET || process.env.GCS_BUCKET);

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function section(title) {
  process.stdout.write(`\n\x1b[1m\x1b[34m${title}\x1b[0m\n`);
}

function recordPass(name) {
  process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  passed++;
}

function recordFail(name, msg) {
  process.stdout.write(`  \x1b[31m✕\x1b[0m ${name}: ${msg}\n`);
  failed++;
  failures.push({ name, message: msg });
}

function recordSkip(name) {
  process.stdout.write(`  \x1b[33m-\x1b[0m ${name} (skipped — GCS not enabled)\n`);
  skipped++;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Low-level HTTP request helper.
 * @param {object} server
 * @param {object} options  — merged into http.request options
 * @param {Buffer|string|undefined} body
 * @returns {Promise<{status, headers, body, raw}>}
 */
function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req  = http.request({ host: '127.0.0.1', port, ...options }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      req.write(buf);
    }
    req.end();
  });
}

function apiReq(server, method, urlPath, bodyObj, extraHeaders = {}) {
  const payload = bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined;
  return request(server, {
    method,
    path: urlPath,
    headers: {
      'Content-Type':  'application/json',
      'X-API-Key':     API_KEY,
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...extraHeaders,
    },
  }, payload);
}

// ── Multipart helper ──────────────────────────────────────────────────────────

function _buildMultipart(boundary, fieldName, filename, contentType, data) {
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ];
  return Buffer.concat([
    Buffer.from(parts[0]),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

// Minimal valid 8-byte PNG signature buffer
const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function uploadFile(server, siteId, filename) {
  const boundary = 'n3testboundary';
  const mpBody   = _buildMultipart(boundary, 'file', filename, 'image/png', TINY_PNG);
  return request(server, {
    method: 'POST',
    path:   `/api/uploads/${siteId}/upload`,
    headers: {
      'Content-Type':   `multipart/form-data; boundary=${boundary}`,
      'Content-Length': mpBody.length,
      'X-API-Key':      API_KEY,
    },
  }, mpBody);
}

// ── Site creation helper ──────────────────────────────────────────────────────

async function createTestSite(server) {
  const r = await apiReq(server, 'POST', '/api/sites', { html: '<p>test</p>', name: 'Media Test' });
  if (r.status !== 201) throw new Error(`createTestSite failed: ${JSON.stringify(r.body)}`);
  return { siteId: r.body.site.id, apiKey: r.body.site.apiKey };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runTests(server) {

  // ── 1. Empty media list ───────────────────────────────────────────────────
  section('1. Empty media list');
  try {
    const { siteId } = await createTestSite(server);
    const r = await apiReq(server, 'GET', `/api/sites/${siteId}/media`);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && Array.isArray(r.body.items), 'body.items should be an array');
    assert(r.body.items.length === 0, `expected 0 items, got ${r.body.items.length}`);
    recordPass('GET /api/sites/:id/media returns { items: [] } for fresh site');
  } catch (err) {
    recordFail('empty media list', err.message);
  }

  // ── 2. Upload then list ───────────────────────────────────────────────────
  section('2. Upload then list');
  let uploadedSiteId, uploadedAssetId, uploadedUrl;
  try {
    const { siteId } = await createTestSite(server);
    uploadedSiteId = siteId;

    const upR = await uploadFile(server, siteId, 'test-image.png');
    assert(upR.status === 201, `upload expected 201, got ${upR.status}: ${JSON.stringify(upR.body)}`);

    const listR = await apiReq(server, 'GET', `/api/sites/${siteId}/media`);
    assert(listR.status === 200, `list expected 200, got ${listR.status}`);
    assert(Array.isArray(listR.body.items), 'body.items should be array');
    assert(listR.body.items.length === 1, `expected 1 item, got ${listR.body.items.length}`);

    const item = listR.body.items[0];
    assert(item.filename && item.filename.includes('test-image'), `filename should include 'test-image', got ${item.filename}`);
    assert(item.sizeBytes > 0, `sizeBytes should be > 0, got ${item.sizeBytes}`);
    assert(typeof item.id === 'string' && item.id.length === 16, `id should be 16-char hex, got ${item.id}`);
    assert(typeof item.contentType === 'string', 'contentType should be a string');
    assert(Array.isArray(item.usages), 'usages should be an array');

    uploadedAssetId = item.id;
    uploadedUrl     = item.url;

    recordPass('upload file then GET /media → 1 item with correct shape');
  } catch (err) {
    recordFail('upload then list', err.message);
  }

  // ── 3. Delete unused asset ────────────────────────────────────────────────
  section('3. Delete unused asset');
  try {
    const { siteId } = await createTestSite(server);

    const upR = await uploadFile(server, siteId, 'to-delete.png');
    assert(upR.status === 201, `upload expected 201, got ${upR.status}`);

    // Get the asset ID
    const listR = await apiReq(server, 'GET', `/api/sites/${siteId}/media`);
    assert(listR.status === 200, `list expected 200`);
    const item = listR.body.items[0];
    assert(item, 'should have one item after upload');

    const delR = await apiReq(server, 'DELETE', `/api/sites/${siteId}/media/${item.id}`);
    assert(delR.status === 200, `delete expected 200, got ${delR.status}: ${JSON.stringify(delR.body)}`);
    assert(delR.body.deleted === true, `expected { deleted: true }, got ${JSON.stringify(delR.body)}`);

    recordPass('DELETE /api/sites/:id/media/:assetId → 200 { deleted: true }');
  } catch (err) {
    recordFail('delete unused asset', err.message);
  }

  // ── 4. Delete in-use asset → 409 ─────────────────────────────────────────
  section('4. Delete in-use asset → 409');
  if (!GCS_ENABLED) {
    recordSkip('DELETE in-use asset → 409 (usage scanning requires GCS)');
  } else {
    try {
      const { siteId, apiKey } = await createTestSite(server);

      const upR = await uploadFile(server, siteId, 'in-use.png');
      assert(upR.status === 201, `upload expected 201, got ${upR.status}`);
      const assetUrl = upR.body.file.url;

      const listR = await apiReq(server, 'GET', `/api/sites/${siteId}/media`);
      const item   = listR.body.items[0];
      assert(item, 'should have one item');

      // Save page body that references the asset URL
      const pageHtml = `<main><img src="${assetUrl}" alt="test"></main>`;
      const saveR = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
        { html: pageHtml }, { 'X-API-Key': apiKey });
      assert(saveR.status === 200, `page save expected 200, got ${saveR.status}`);

      const delR = await apiReq(server, 'DELETE', `/api/sites/${siteId}/media/${item.id}`);
      assert(delR.status === 409, `expected 409, got ${delR.status}: ${JSON.stringify(delR.body)}`);
      assert(delR.body.error === 'asset in use', `expected error 'asset in use', got ${delR.body.error}`);

      recordPass('DELETE in-use asset → 409 { error: "asset in use" }');
    } catch (err) {
      recordFail('delete in-use asset → 409', err.message);
    }
  }

  // ── 5. Delete in-use asset with force=true → 200 ─────────────────────────
  section('5. Delete in-use asset with force=true → 200');
  if (!GCS_ENABLED) {
    recordSkip('DELETE in-use asset with force=true (usage scanning requires GCS)');
  } else {
    try {
      const { siteId, apiKey } = await createTestSite(server);

      const upR = await uploadFile(server, siteId, 'force-delete.png');
      assert(upR.status === 201, `upload expected 201, got ${upR.status}`);
      const assetUrl = upR.body.file.url;

      const listR = await apiReq(server, 'GET', `/api/sites/${siteId}/media`);
      const item   = listR.body.items[0];
      assert(item, 'should have one item');

      // Save page body that references the asset
      const pageHtml = `<main><img src="${assetUrl}" alt="test"></main>`;
      const saveR = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
        { html: pageHtml }, { 'X-API-Key': apiKey });
      assert(saveR.status === 200, `page save expected 200, got ${saveR.status}`);

      const delR = await apiReq(server, 'DELETE', `/api/sites/${siteId}/media/${item.id}?force=true`);
      assert(delR.status === 200, `force delete expected 200, got ${delR.status}: ${JSON.stringify(delR.body)}`);
      assert(delR.body.deleted === true, `expected { deleted: true }, got ${JSON.stringify(delR.body)}`);

      recordPass('DELETE in-use asset with force=true → 200 { deleted: true }');
    } catch (err) {
      recordFail('delete in-use asset with force=true', err.message);
    }
  }

  // ── 6. Wrong API key → 401 ────────────────────────────────────────────────
  section('6. Wrong API key → 401');
  try {
    const { siteId } = await createTestSite(server);

    const r = await request(server, {
      method: 'GET',
      path:   `/api/sites/${siteId}/media`,
      headers: {
        'X-API-Key': 'this-is-garbage-not-a-valid-key',
      },
    });
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
    recordPass('GET /api/sites/:id/media with bogus X-API-Key → 401');
  } catch (err) {
    recordFail('wrong API key → 401', err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const app    = require('../server');
  const server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  const { port } = server.address();

  process.stdout.write(`\n\x1b[1mn3ware media tests — port ${port}\x1b[0m\n`);
  process.stdout.write(`GCS: ${GCS_ENABLED ? 'enabled' : 'disabled (usage tests skipped)'}\n`);
  process.stdout.write(`${'─'.repeat(55)}\n`);

  try {
    await runTests(server);
  } catch (err) {
    process.stdout.write(`\x1b[31mUnhandled error: ${err.message}\x1b[0m\n`);
    failed++;
    failures.push({ name: 'unhandled', message: err.message });
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  process.stdout.write(`\n\x1b[1m${'─'.repeat(55)}\x1b[0m\n`);
  process.stdout.write(`\x1b[1mSummary: ${passed}/${passed + failed} passed`);
  if (skipped > 0) process.stdout.write(` (${skipped} skipped)`);
  process.stdout.write('\x1b[0m\n');

  if (failures.length) {
    process.stdout.write('\x1b[31mFailures:\x1b[0m\n');
    failures.forEach(f => process.stdout.write(`  ${f.name}: ${f.message}\n`));
    process.exit(1);
  } else {
    process.stdout.write('\x1b[32mAll tests passed.\x1b[0m\n');
    process.exit(0);
  }
})();
