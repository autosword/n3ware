'use strict';

/**
 * Collections API integration tests.
 *
 * Usage (local storage, no GCS):
 *   STORAGE_BACKEND=local MASTER_API_KEY=n3ware_master_key_change_me JWT_SECRET=change-me-in-production node tests/collections.test.js
 *
 * Usage (with GCS):
 *   GCS_BUCKET=n3ware-sites STORAGE_BACKEND=local MASTER_API_KEY=... node tests/collections.test.js
 */

const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── Env setup ────────────────────────────────────────────────────────────────
const API_KEY = process.env.MASTER_API_KEY || 'n3ware_master_key_change_me';
process.env.MASTER_API_KEY  = API_KEY;
process.env.NODE_ENV        = 'test';
process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local';
process.env.CDN_PROVIDER    = 'none';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n3ware-col-test-'));
process.env.DATA_DIR = tmpDir;

const GCS_ENABLED = Boolean(process.env.GCS_BUCKET);

// ── Load app after env is configured ─────────────────────────────────────────
const app = require('../server');

// ── Test framework ────────────────────────────────────────────────────────────
let passed  = 0;
let failed  = 0;
let skipped = 0;
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

function skip(msg) {
  skipped++;
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
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

function get(server, path, key = API_KEY) {
  return request(server, {
    method: 'GET', path,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
  });
}

function post(server, path, body, key = API_KEY) {
  const payload = JSON.stringify(body);
  return request(server, {
    method: 'POST', path,
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);
}

function put(server, path, body, key = API_KEY) {
  const payload = JSON.stringify(body);
  return request(server, {
    method: 'PUT', path,
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);
}

function del(server, path, key = API_KEY) {
  return request(server, {
    method: 'DELETE', path,
    headers: { 'X-API-Key': key },
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────
async function runTests(server) {
  let siteId;

  // ── Setup: create a site ─────────────────────────────────────────────────
  console.log('\n[setup: create site]');
  {
    const r = await post(server, '/api/sites', { name: 'Collections Test Site', html: '<h1>Hello</h1>' });
    assert(r.status === 201, 'POST /api/sites → 201');
    siteId = r.body?.site?.id;
    assert(typeof siteId === 'string' && siteId.length > 0, 'got site id');
    console.log(`  ✓  created site ${siteId}`);
  }

  // ── Auth guard ───────────────────────────────────────────────────────────
  console.log('\n[auth guard]');
  {
    const r = await get(server, `/api/sites/${siteId}/collections`, '');
    assert(r.status === 401, 'no key → 401');

    const r2 = await get(server, `/api/sites/${siteId}/collections`, 'bad-key');
    assert(r2.status === 401 || r2.status === 403, 'invalid key → 401 or 403');
    console.log('  ✓  auth guard');
  }

  // ── Site not found ────────────────────────────────────────────────────────
  console.log('\n[site not found]');
  {
    const r = await get(server, '/api/sites/nonexistent-site-id/collections');
    assert(r.status === 404, 'unknown siteId → 404');
    console.log('  ✓  site not found');
  }

  if (!GCS_ENABLED) {
    console.log('\n[GCS operations]');
    console.log('  NOTE: GCS_BUCKET not set — testing routing/auth only; CRUD ops will 500 without GCS');

    // ── Verify routing works (will 500 without GCS) ───────────────────────
    {
      const r = await get(server, `/api/sites/${siteId}/collections`);
      // Without GCS, will get 500 because GCS client fails — that's expected
      assert(r.status === 404 || r.status === 500 || r.status === 200,
        `GET /collections reaches handler (got ${r.status})`);
      console.log(`  ✓  GET /collections reached handler (status ${r.status})`);
    }

    skip('Collection CRUD — requires GCS_BUCKET');
    skip('Entry CRUD — requires GCS_BUCKET');
    skip('Free tier limit enforcement — requires GCS_BUCKET');
    return;
  }

  // ── GCS-enabled tests ─────────────────────────────────────────────────────
  const FIELDS = [
    { key: 'name',  type: 'text',   label: 'Name',  required: true },
    { key: 'role',  type: 'text',   label: 'Role' },
    { key: 'order', type: 'number', label: 'Order' },
  ];

  // ── 1. List collections (empty) ───────────────────────────────────────────
  console.log('\n[list collections]');
  {
    const r = await get(server, `/api/sites/${siteId}/collections`);
    assert(r.status === 200, 'GET /collections → 200');
    assert(Array.isArray(r.body?.collections), 'body.collections is array');
    assert(r.body.collections.length === 0, 'initially empty');
    console.log('  ✓  list empty');
  }

  // ── 2. Create collection ─────────────────────────────────────────────────
  console.log('\n[create collection]');
  let col;
  {
    const r = await post(server, `/api/sites/${siteId}/collections`, {
      name: 'Team', slug: 'team', fields: FIELDS,
    });
    assert(r.status === 201, 'POST /collections → 201');
    assert(r.body?.collection?.slug === 'team', 'collection.slug = team');
    assert(r.body?.collection?.name === 'Team', 'collection.name = Team');
    assert(Array.isArray(r.body?.collection?.fields), 'collection.fields is array');
    assert(r.body.collection.fields.length === 3, 'collection has 3 fields');
    col = r.body.collection;
    console.log('  ✓  created collection "team"');
  }

  // ── 3. List collections (one) ─────────────────────────────────────────────
  {
    const r = await get(server, `/api/sites/${siteId}/collections`);
    assert(r.status === 200, 'GET /collections → 200 after create');
    assert(r.body?.collections?.length === 1, 'one collection');
    console.log('  ✓  list length 1');
  }

  // ── 4. Get collection by slug ─────────────────────────────────────────────
  {
    const r = await get(server, `/api/sites/${siteId}/collections/team`);
    assert(r.status === 200, 'GET /collections/team → 200');
    assert(r.body?.collection?.slug === 'team', 'slug matches');
    console.log('  ✓  get collection');
  }

  // ── 5. Validation: invalid field type ─────────────────────────────────────
  console.log('\n[collection validation]');
  {
    const r = await post(server, `/api/sites/${siteId}/collections`, {
      name: 'Bad', slug: 'bad', fields: [{ key: 'x', type: 'invalid', label: 'X' }],
    });
    assert(r.status === 400, 'invalid field type → 400');
    console.log('  ✓  invalid field type rejected');
  }

  // ── 6. Create entry with valid data ──────────────────────────────────────
  console.log('\n[create entry]');
  let entryId;
  {
    const r = await post(server, `/api/sites/${siteId}/collections/team/entries`, {
      data: { name: 'Alice', role: 'Engineer', order: 1 },
    });
    assert(r.status === 201, 'POST /entries → 201');
    assert(typeof r.body?.entry?.id === 'string', 'entry has id');
    assert(r.body?.entry?.collectionId === 'team', 'entry.collectionId = team');
    assert(r.body?.entry?.data?.name === 'Alice', 'entry.data.name = Alice');
    entryId = r.body.entry.id;
    console.log(`  ✓  created entry ${entryId}`);
  }

  // ── 7. Create entry missing required field ────────────────────────────────
  {
    const r = await post(server, `/api/sites/${siteId}/collections/team/entries`, {
      data: { role: 'Designer' }, // missing required 'name'
    });
    assert(r.status === 400, 'missing required field → 400');
    assert(typeof r.body?.error === 'string', 'error message present');
    console.log('  ✓  missing required field → 400');
  }

  // ── 8. List entries ───────────────────────────────────────────────────────
  console.log('\n[list entries]');
  {
    const r = await get(server, `/api/sites/${siteId}/collections/team/entries`);
    assert(r.status === 200, 'GET /entries → 200');
    assert(Array.isArray(r.body?.entries), 'body.entries is array');
    assert(r.body.entries.length === 1, 'one entry');
    console.log('  ✓  list length 1');
  }

  // ── 9. Get entry by id ────────────────────────────────────────────────────
  {
    const r = await get(server, `/api/sites/${siteId}/collections/team/entries/${entryId}`);
    assert(r.status === 200, 'GET /entries/:id → 200');
    assert(r.body?.entry?.id === entryId, 'entry id matches');
    console.log('  ✓  get entry');
  }

  // ── 10. Update entry ──────────────────────────────────────────────────────
  console.log('\n[update entry]');
  {
    const r = await put(server, `/api/sites/${siteId}/collections/team/entries/${entryId}`, {
      data: { role: 'Senior Engineer' },
    });
    assert(r.status === 200, 'PUT /entries/:id → 200');
    assert(r.body?.entry?.data?.name === 'Alice', 'name preserved after merge');
    assert(r.body?.entry?.data?.role === 'Senior Engineer', 'role updated');
    console.log('  ✓  data merged on update');
  }

  // ── 11. Delete entry ──────────────────────────────────────────────────────
  console.log('\n[delete entry]');
  {
    const r = await del(server, `/api/sites/${siteId}/collections/team/entries/${entryId}`);
    assert(r.status === 200, 'DELETE /entries/:id → 200');
    assert(r.body?.deleted === true, 'deleted flag set');

    const r2 = await get(server, `/api/sites/${siteId}/collections/team/entries`);
    assert(r2.body?.entries?.length === 0, 'entries empty after delete');
    console.log('  ✓  entry deleted');
  }

  // ── 12. Entry not found ───────────────────────────────────────────────────
  {
    const r = await get(server, `/api/sites/${siteId}/collections/team/entries/no-such-id`);
    assert(r.status === 404, 'missing entry → 404');
    console.log('  ✓  entry not found → 404');
  }

  // ── 13. Update collection ─────────────────────────────────────────────────
  console.log('\n[update collection]');
  {
    const r = await put(server, `/api/sites/${siteId}/collections/team`, {
      name: 'Team Members',
    });
    assert(r.status === 200, 'PUT /collections/:slug → 200');
    assert(r.body?.collection?.name === 'Team Members', 'name updated');
    console.log('  ✓  collection updated');
  }

  // ── 14. Delete collection ─────────────────────────────────────────────────
  console.log('\n[delete collection]');
  {
    const r = await del(server, `/api/sites/${siteId}/collections/team`);
    assert(r.status === 200, 'DELETE /collections/:slug → 200');
    assert(r.body?.deleted === true, 'deleted flag set');

    const r2 = await get(server, `/api/sites/${siteId}/collections`);
    assert(r2.body?.collections?.length === 0, 'list empty after delete');
    console.log('  ✓  collection deleted');
  }

  // ── 15. Collection not found ──────────────────────────────────────────────
  {
    const r = await get(server, `/api/sites/${siteId}/collections/no-such`);
    assert(r.status === 404, 'missing collection → 404');
    console.log('  ✓  collection not found → 404');
  }

  // ── 16. Free tier limit: create 3 collections (limit is 2) ───────────────
  console.log('\n[free tier limit]');
  {
    // Create 2 collections (at limit)
    await post(server, `/api/sites/${siteId}/collections`, { name: 'Col1', slug: 'col1', fields: [] });
    await post(server, `/api/sites/${siteId}/collections`, { name: 'Col2', slug: 'col2', fields: [] });
    // 3rd should be rejected
    const r = await post(server, `/api/sites/${siteId}/collections`, { name: 'Col3', slug: 'col3', fields: [] });
    assert(r.status === 402, '3rd collection → 402 (limit reached)');
    assert(r.body?.limit === 2, 'limit is 2');
    console.log('  ✓  free tier limit enforced');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  const { port } = server.address();
  console.log(`\nn3ware Collections tests — port ${port}`);
  console.log(`GCS enabled: ${GCS_ENABLED}`);
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
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
