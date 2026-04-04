'use strict';

/**
 * tests/auth-flow.test.js
 *
 * Integration tests for magic-link auth + site CRUD.
 * Runs against a real in-process server with local storage.
 *
 * Usage:
 *   STORAGE_BACKEND=local JWT_SECRET=test MASTER_API_KEY=test PORT=8099 \
 *     node tests/auth-flow.test.js
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Env — must be set before requiring server ─────────────────────────────────
const PORT      = parseInt(process.env.PORT || '8099', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars!!';
const API_KEY    = process.env.MASTER_API_KEY || 'test-master-key';
const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'n3ware-auth-test-'));

process.env.PORT             = String(PORT);
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
    console.error(`    \x1b[31mFAIL\x1b[0m  ${msg}`);
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
    console.error(`    \x1b[31mFAIL\x1b[0m  ${m}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m\x1b[34m${title}\x1b[0m`);
}

function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m  ${msg}`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, ...opts }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on('error', reject);
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

function post(path, body = {}, headers = {}) {
  const payload = JSON.stringify(body);
  return req({
    method: 'POST', path,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
  }, payload);
}

function get(path, headers = {}) {
  return req({ method: 'GET', path, headers });
}

function del(path, headers = {}) {
  return req({ method: 'DELETE', path, headers });
}

function bearer(token)  { return { Authorization: `Bearer ${token}` }; }
function apikey(key)    { return { 'X-API-Key': key }; }

// Follow a redirect (302) to its Location header, return the redirect target
function getRedirect(path, headers = {}) {
  return req({ method: 'GET', path, headers });
}

// ── Start server ──────────────────────────────────────────────────────────────
const app = require('../server');

async function startServer() {
  return new Promise((resolve, reject) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function getMagicUrl(email) {
  const r = await post('/api/auth/magic', { email });
  if (!r.body || !r.body.magicUrl) throw new Error(`No magicUrl in response for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.magicUrl;
}

async function getJwt(email) {
  const magicUrl  = await getMagicUrl(email);
  const tokenPath = magicUrl.replace(`http://127.0.0.1:${PORT}`, '');
  const r         = await getRedirect(tokenPath);
  // Expect 302 to /dashboard#token=JWT
  const loc = r.headers.location || '';
  const match = loc.match(/#token=(.+)$/);
  if (!match) throw new Error(`No JWT in redirect location: ${loc}`);
  return match[1];
}

// ── Test suites ───────────────────────────────────────────────────────────────
async function runTests() {
  let jwtA, jwtB;
  let siteId, revId;

  // ────────────────────────────────────────────────────────────────────────────
  section('1. Magic Link — request');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await post('/api/auth/magic', { email: 'alice@test.com' });
    assert(r.status === 200, 'valid email → 200');
    assert(r.body.success === true, 'body.success = true');
    assert(typeof r.body.magicUrl === 'string', 'dev mode returns magicUrl');
    assert(r.body.magicUrl.includes('/api/auth/verify?token='), 'magicUrl points to verify endpoint');
    ok('POST /api/auth/magic valid email');
  }

  {
    const r = await post('/api/auth/magic', { email: 'not-an-email' });
    assert(r.status === 400, 'invalid email → 400');
    assert(typeof r.body.error === 'string', 'error message present');
    ok('POST /api/auth/magic invalid email → 400');
  }

  {
    const r = await post('/api/auth/magic', { email: '' });
    assert(r.status === 400, 'empty email → 400');
    ok('POST /api/auth/magic empty email → 400');
  }

  {
    const r = await post('/api/auth/magic', {});
    assert(r.status === 400, 'missing email → 400');
    ok('POST /api/auth/magic missing email → 400');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('2. Magic Link — rate limiting');
  // ────────────────────────────────────────────────────────────────────────────

  {
    // 3 requests are allowed (RATE_LIMIT = 3), 4th should be rejected
    // Use a fresh email to avoid interference from the request above
    const email = 'ratelimit@test.com';
    const r1 = await post('/api/auth/magic', { email });
    const r2 = await post('/api/auth/magic', { email });
    const r3 = await post('/api/auth/magic', { email });
    assert(r1.status === 200, 'request 1 allowed');
    assert(r2.status === 200, 'request 2 allowed');
    assert(r3.status === 200, 'request 3 allowed (at limit)');

    const r4 = await post('/api/auth/magic', { email });
    assert(r4.status === 429, '4th request → 429 Too Many Requests');
    ok('Rate limit: 3 allowed, 4th → 429');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('3. Magic Link — verify endpoint');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const magicUrl  = await getMagicUrl('alice@test.com');
    const tokenPath = magicUrl.replace(`http://127.0.0.1:${PORT}`, '');
    const r = await getRedirect(tokenPath);

    assert(r.status === 302, 'valid token → 302 redirect');
    const loc = r.headers.location || '';
    assert(loc.startsWith('/dashboard#token='), 'redirect to /dashboard#token=JWT');

    const match = loc.match(/#token=(.+)$/);
    assert(match !== null, 'JWT present in redirect hash');
    jwtA = match[1];

    // Validate JWT structure (three dot-separated base64 parts)
    const parts = jwtA.split('.');
    assert(parts.length === 3, 'JWT has 3 parts');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    assertEqual(payload.email, 'alice@test.com', 'JWT payload contains correct email');
    assert(typeof payload.id === 'string' && payload.id.length > 0, 'JWT payload has user id');
    ok('Valid token → 302 /dashboard#token=JWT with correct email');
  }

  {
    // Invalid token
    const r = await getRedirect('/api/auth/verify?token=deadbeefdeadbeefdeadbeef00000000000000000000000000000000000000');
    assert(r.status === 302, 'invalid token → 302');
    assert((r.headers.location || '').includes('auth_error'), 'redirects with auth_error param');
    ok('Invalid token → 302 with auth_error');
  }

  {
    // Expired token: manually test by checking that a wrong token fails
    const r = await getRedirect('/api/auth/verify?token=');
    assert(r.status === 302, 'empty token → redirect to error');
    assert((r.headers.location || '').includes('auth_error'), 'error param present');
    ok('Empty token → 302 with auth_error');
  }

  {
    // Already-used token: use the same token twice
    const magicUrl  = await getMagicUrl('useonce@test.com');
    const tokenPath = magicUrl.replace(`http://127.0.0.1:${PORT}`, '');
    const r1 = await getRedirect(tokenPath);
    assert(r1.status === 302, 'first use → 302');
    assert((r1.headers.location || '').startsWith('/dashboard#token='), 'first use succeeds');

    const r2 = await getRedirect(tokenPath);
    assert(r2.status === 302, 'second use → 302');
    assert((r2.headers.location || '').includes('auth_error'), 'second use → auth_error');
    ok('Already-used token → auth_error on second use');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('4. Magic Link — user creation & reuse');
  // ────────────────────────────────────────────────────────────────────────────

  {
    // First login creates user — verify via /api/auth/me
    const r = await get('/api/auth/me', bearer(jwtA));
    assert(r.status === 200, '/api/auth/me with JWT → 200');
    assert(r.body.user.email === 'alice@test.com', 'me.user.email correct');
    assert(typeof r.body.user.id === 'string', 'me.user.id present');
    ok('Magic link auto-creates user; /api/auth/me returns correct user');
  }

  {
    // Second login re-uses the same user — should get same id
    const jwt1Parts = jwtA.split('.');
    const id1 = JSON.parse(Buffer.from(jwt1Parts[1], 'base64url').toString()).id;

    const jwtB_url  = await getMagicUrl('alice@test.com');
    const tokenPath = jwtB_url.replace(`http://127.0.0.1:${PORT}`, '');
    const r2        = await getRedirect(tokenPath);
    const loc       = r2.headers.location || '';
    const match2    = loc.match(/#token=(.+)$/);
    const jwt2      = match2 ? match2[1] : '';
    const id2       = JSON.parse(Buffer.from(jwt2.split('.')[1], 'base64url').toString()).id;

    assertEqual(id1, id2, 'repeat login returns same user id');
    ok('Repeat login finds existing user (same id)');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('5. Auth — JWT from /api/auth/me');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await get('/api/auth/me');
    assert(r.status === 401, 'unauthenticated /api/auth/me → 401');
    ok('No auth → 401');
  }

  {
    const r = await get('/api/auth/me', bearer('garbage.token.here'));
    assert(r.status === 401, 'invalid JWT → 401');
    ok('Invalid JWT → 401');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('6. Site CRUD — create');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await post('/api/sites');  // no auth
    assert(r.status === 401, 'create site unauthenticated → 401');
    ok('Create site without auth → 401');
  }

  {
    const r = await post('/api/sites',
      { name: 'My First Site', html: '<h1>Hello World</h1>', message: 'initial' },
      bearer(jwtA));
    assert(r.status === 201, 'create site → 201');
    assert(typeof r.body.site === 'object', 'response has site object');
    assert(typeof r.body.site.id === 'string', 'site has id');
    assertEqual(r.body.site.name, 'My First Site', 'site.name correct');
    assert(r.body.site.html.includes('Hello World'), 'site.html stored');
    assertEqual(r.body.site.ownerId, JSON.parse(Buffer.from(jwtA.split('.')[1], 'base64url').toString()).id, 'site.ownerId = user id');
    siteId = r.body.site.id;
    ok(`Create site → 201, id=${siteId.slice(0, 8)}…`);
  }

  {
    // Default name when none provided
    const r = await post('/api/sites', { html: '<p>minimal</p>' }, bearer(jwtA));
    assert(r.status === 201, 'create with no name → 201');
    assertEqual(r.body.site.name, 'Untitled Site', 'default name = Untitled Site');
    ok('Create site with no name → Untitled Site');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('7. Site CRUD — list');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await get('/api/sites', bearer(jwtA));
    assert(r.status === 200, 'list sites → 200');
    assert(Array.isArray(r.body.sites), 'body.sites is array');
    assert(r.body.sites.length >= 2, 'alice sees her own sites');
    const ids = r.body.sites.map(s => s.id);
    assert(ids.includes(siteId), 'created site is in list');
    ok(`List sites → ${r.body.sites.length} sites for alice`);
  }

  {
    // User B should see 0 sites (separate owner)
    jwtB = await getJwt('bob@test.com');
    const r = await get('/api/sites', bearer(jwtB));
    assert(r.status === 200, 'list sites for bob → 200');
    assertEqual(r.body.sites.length, 0, 'bob sees 0 sites (ownership isolation)');
    ok('Ownership: bob sees 0 of alice\'s sites');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('8. Site CRUD — get single site');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await get(`/api/sites/${siteId}`, bearer(jwtA));
    assert(r.status === 200, 'get site → 200');
    assertEqual(r.body.site.id, siteId, 'site.id matches');
    assert(r.body.site.html === undefined, 'html not in metadata response');
    ok('GET /api/sites/:id → 200 (metadata, no html)');
  }

  {
    const r = await get(`/api/sites/${siteId}`, bearer(jwtB));
    assert(r.status === 403, 'bob cannot get alice\'s site → 403');
    ok('Ownership: bob GET alice\'s site → 403');
  }

  {
    const r = await get(`/api/sites/${siteId}/html`, bearer(jwtA));
    assert(r.status === 200, 'get html → 200');
    assert(typeof r.body === 'string' && r.body.includes('Hello World'), 'html content correct');
    ok('GET /api/sites/:id/html → raw HTML');
  }

  {
    const r = await get('/api/sites/nonexistent-id-xyz', bearer(jwtA));
    assert(r.status === 404, 'missing site → 404');
    ok('GET nonexistent site → 404');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('9. Site CRUD — save (creates revision)');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await post(`/api/sites/${siteId}/save`,
      { html: '<h1>Updated</h1><p>version 2</p>', message: 'second revision' },
      bearer(jwtA));
    assert(r.status === 200, 'save site → 200');
    assert(r.body.site.html === undefined, 'html excluded from metadata response');
    assertEqual(r.body.site.message, 'second revision', 'message updated');
    ok('POST /api/sites/:id/save → 200');
  }

  {
    const r = await post(`/api/sites/${siteId}/save`,
      { html: '<h1>v3</h1>' },
      bearer(jwtB));
    assert(r.status === 403, 'bob cannot save alice\'s site → 403');
    ok('Ownership: bob save alice\'s site → 403');
  }

  {
    const r = await post(`/api/sites/${siteId}/save`, {}, bearer(jwtA));
    assert(r.status === 400, 'save without html → 400');
    ok('POST /api/sites/:id/save without html → 400');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('10. Revisions');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await get(`/api/sites/${siteId}/revisions`, bearer(jwtA));
    assert(r.status === 200, 'list revisions → 200');
    assert(Array.isArray(r.body.revisions), 'body.revisions is array');
    assert(r.body.revisions.length >= 2, 'at least 2 revisions (create + save)');
    // Revisions should be newest-first
    const timestamps = r.body.revisions.map(rv => rv.createdAt);
    const sorted = [...timestamps].sort((a, b) => b.localeCompare(a));
    assert(JSON.stringify(timestamps) === JSON.stringify(sorted), 'revisions newest-first');
    revId = r.body.revisions[r.body.revisions.length - 1].id; // oldest
    ok(`List revisions → ${r.body.revisions.length} revisions, newest-first`);
  }

  {
    // Rollback to the first revision
    const r = await post(`/api/sites/${siteId}/revisions/${revId}/rollback`, {}, bearer(jwtA));
    assert(r.status === 200, 'rollback → 200');
    assert(r.body.site !== undefined, 'rollback returns site');
    ok(`Rollback to revision ${revId.slice(0, 12)}… → 200`);
  }

  {
    // Confirm content was rolled back
    const r = await get(`/api/sites/${siteId}/html`, bearer(jwtA));
    assert(r.body.includes('Hello World'), 'content matches original after rollback');
    ok('HTML content correct after rollback');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('11. Site CRUD — delete');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await del(`/api/sites/${siteId}`, bearer(jwtB));
    assert(r.status === 403, 'bob cannot delete alice\'s site → 403');
    ok('Ownership: bob delete alice\'s site → 403');
  }

  {
    const r = await del(`/api/sites/${siteId}`, bearer(jwtA));
    assert(r.status === 200, 'delete site → 200');
    assert(r.body.deleted === true, 'body.deleted = true');
    ok('DELETE /api/sites/:id → 200');
  }

  {
    const r = await get(`/api/sites/${siteId}`, bearer(jwtA));
    assert(r.status === 404, 'deleted site → 404');
    ok('Deleted site is gone → 404');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('12. Integration — full end-to-end flow');
  // ────────────────────────────────────────────────────────────────────────────

  {
    // carol: magic link → JWT → create → edit → list → delete
    const carolJwt = await getJwt('carol@test.com');

    const c1 = await get('/api/auth/me', bearer(carolJwt));
    assert(c1.status === 200, 'carol /api/auth/me → 200');
    assertEqual(c1.body.user.email, 'carol@test.com', 'carol email correct');

    const c2 = await post('/api/sites', { name: 'Carol Site', html: '<p>carol</p>' }, bearer(carolJwt));
    assert(c2.status === 201, 'carol create site → 201');
    const carolSiteId = c2.body.site.id;

    const c3 = await post(`/api/sites/${carolSiteId}/save`, { html: '<p>carol v2</p>', message: 'updated' }, bearer(carolJwt));
    assert(c3.status === 200, 'carol save → 200');

    const c4 = await get('/api/sites', bearer(carolJwt));
    assert(c4.body.sites.some(s => s.id === carolSiteId), 'carol site in list');

    const c5 = await del(`/api/sites/${carolSiteId}`, bearer(carolJwt));
    assert(c5.status === 200, 'carol delete → 200');

    ok('Full flow: magic link → JWT → create → edit → list → delete');
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('13. API key auth on site endpoints');
  // ────────────────────────────────────────────────────────────────────────────

  {
    const r = await post('/api/sites', { html: '<p>api</p>' }, apikey(API_KEY));
    assert(r.status === 201, 'create via API key → 201');
    const apiSiteId = r.body.site.id;

    const r2 = await get('/api/sites', apikey(API_KEY));
    assert(r2.status === 200, 'list via API key → 200');

    const r3 = await del(`/api/sites/${apiSiteId}`, apikey(API_KEY));
    assert(r3.status === 200, 'delete via API key → 200');
    ok('API key auth works for site CRUD');
  }

  {
    // Wrong API key — server returns 403 (not a valid key)
    const r = await get('/api/sites', apikey('wrong-key'));
    assert(r.status === 401 || r.status === 403, 'wrong API key → 401 or 403');
    ok('Wrong API key → rejected (401/403)');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  let server;
  try {
    server = await startServer();
    console.log(`\x1b[1mn3ware auth-flow tests\x1b[0m  (port ${PORT}, storage: local)`);
    await runTests();
  } catch (err) {
    console.error('\n\x1b[31mUnhandled error during tests:\x1b[0m', err);
    failed++;
  } finally {
    if (server) server.close();
    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }

    const total = passed + failed;
    console.log(`\n${'─'.repeat(60)}`);
    if (failed === 0) {
      console.log(`\x1b[32m✓ All ${total} assertions passed\x1b[0m\n`);
      process.exit(0);
    } else {
      console.log(`\x1b[31m✕ ${failed}/${total} assertions failed\x1b[0m`);
      failures.forEach(f => console.log(`  - ${f}`));
      console.log('');
      process.exit(1);
    }
  }
})();
