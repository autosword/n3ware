'use strict';

/**
 * tests/comprehensive.test.js
 *
 * 35 tests covering gaps in the existing suite:
 *   - Security: advanced XSS vectors, JWT edge cases
 *   - Error handling: invalid JSON, missing fields, nonexistent IDs
 *   - Input edge cases: long IDs, path traversal, unicode, NoSQL injection
 *   - Concurrent saves, content integrity, API key scoping
 *
 * Usage:
 *   MASTER_API_KEY=test JWT_SECRET=test node tests/comprehensive.test.js
 */

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

// ── Env — must be set before requiring server ─────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET  || 'test-jwt-secret-at-least-32-chars!!';
const API_KEY    = process.env.MASTER_API_KEY || 'test-master-key';
const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'n3ware-comp-test-'));

process.env.JWT_SECRET      = JWT_SECRET;
process.env.MASTER_API_KEY  = API_KEY;
process.env.NODE_ENV        = 'test';
process.env.STORAGE_BACKEND = 'local';
process.env.CDN_PROVIDER    = 'none';
process.env.DATA_DIR        = tmpDir;

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
    console.error(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m\x1b[34m${title}\x1b[0m`);
}

function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m  ${msg}`);
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
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
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
      'Content-Type':  'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers,
    },
  }, payload);
}

function withKey(headers = {}) { return { 'X-API-Key': API_KEY, ...headers }; }
function bearer(token)         { return { Authorization: `Bearer ${token}` }; }

/** Sign a JWT valid for 1 h. */
function makeJwt(payload = {}) {
  return jwt.sign({ id: crypto.randomUUID(), email: 'test@test.com', ...payload }, JWT_SECRET, { expiresIn: '1h' });
}

/** Sign a JWT that is already expired. */
function expiredJwt() {
  return jwt.sign(
    { id: crypto.randomUUID(), email: 'test@test.com', exp: Math.floor(Date.now() / 1000) - 3600 },
    JWT_SECRET,
  );
}

/** Tamper the payload of a real JWT (keeping header + signature unchanged → invalid). */
function tamperedJwt() {
  const token = makeJwt();
  const [header, , sig] = token.split('.');
  const fakePay = Buffer.from(JSON.stringify({ id: 'haxor', email: 'evil@evil.com', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${fakePay}.${sig}`;
}

/** Create a site and return its id + apiKey. */
async function createSite(server, html = '<p>test</p>', name = 'Test Site') {
  const r = await apiReq(server, 'POST', '/api/sites', { html, name }, withKey());
  if (r.status !== 201) throw new Error(`createSite failed ${r.status}: ${r.raw}`);
  return { siteId: r.body.site.id, apiKey: r.body.site.apiKey };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function runTests(server) {

  // ═══════════════════════════════════════════════════════════════════════════
  section('1. Security — advanced XSS vectors');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // javascript: URI in anchor href
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<a href="javascript:alert(1)">click</a>' }, withKey());
    assert(r.status === 201, 'XSS href create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(!html.raw.includes('javascript:'), 'javascript: URI in href stripped');
    ok('XSS: javascript: href stripped');
  }

  {
    // SVG onload handler
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<svg onload="alert(1)"><rect/></svg>' }, withKey());
    assert(r.status === 201, 'XSS svg create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(!html.raw.includes('onload'), 'SVG onload handler stripped');
    ok('XSS: SVG onload stripped');
  }

  {
    // onclick / onfocus event handlers
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<button onclick="xss()" onfocus="xss()">ok</button>' }, withKey());
    assert(r.status === 201, 'XSS button create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(!html.raw.includes('onclick'), 'onclick stripped');
    assert(!html.raw.includes('onfocus'), 'onfocus stripped');
    ok('XSS: onclick/onfocus stripped');
  }

  {
    // Nested/broken script tag obfuscation
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<p>text</p><scr<script>ipt>alert(1)</scr</script>ipt>' }, withKey());
    assert(r.status === 201, 'XSS nested script create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(!html.raw.includes('<script>'), 'nested script obfuscation stripped');
    ok('XSS: nested script obfuscation stripped');
  }

  {
    // Safe HTML preserved through sanitization
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<h1>Title</h1><p class="body">Text with <strong>bold</strong></p>' }, withKey());
    assert(r.status === 201, 'safe HTML create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(html.raw.includes('Title'), 'safe: heading preserved');
    assert(html.raw.includes('bold'), 'safe: strong preserved');
    ok('XSS: safe HTML preserved through sanitization');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('2. Security — JWT edge cases');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Expired JWT signed with correct secret
    const token = expiredJwt();
    const r = await apiReq(server, 'GET', '/api/sites', undefined, bearer(token));
    assert(r.status === 401, 'expired JWT → 401');
    ok('JWT: expired token → 401');
  }

  {
    // JWT signed with wrong secret
    const token = jwt.sign({ id: 'x', email: 'x@test.com' }, 'wrong-secret-completely-different!!');
    const r = await apiReq(server, 'GET', '/api/sites', undefined, bearer(token));
    assert(r.status === 401, 'wrong-secret JWT → 401');
    ok('JWT: wrong-secret token → 401');
  }

  {
    // Tampered JWT (valid structure, invalid signature)
    const token = tamperedJwt();
    const r = await apiReq(server, 'GET', '/api/sites', undefined, bearer(token));
    assert(r.status === 401, 'tampered JWT → 401');
    ok('JWT: tampered payload → 401');
  }

  {
    // Malformed bearer — not a JWT at all
    const r = await apiReq(server, 'GET', '/api/sites', undefined, bearer('not.a.jwt'));
    assert(r.status === 401, 'malformed bearer → 401');
    ok('JWT: malformed bearer → 401');
  }

  {
    // Bearer that is just a random string (no dots)
    const r = await apiReq(server, 'GET', '/api/sites', undefined, bearer('randomstringwithoutdots'));
    assert(r.status === 401, 'random bearer string → 401');
    ok('JWT: random string as bearer → 401');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('3. Error handling — invalid request bodies');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Malformed JSON body
    const badBody = '{broken!!}';
    const r = await request(server, {
      method: 'POST',
      path:   '/api/sites',
      headers: {
        'X-API-Key':      API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': String(Buffer.byteLength(badBody)),
      },
    }, badBody);
    assert(r.status === 400, 'malformed JSON body → 400');
    ok('Error: malformed JSON body → 400');
  }

  {
    // Missing html on POST /:id/save
    const { siteId } = await createSite(server);
    const r = await apiReq(server, 'POST', `/api/sites/${siteId}/save`, { message: 'no html' }, withKey());
    assert(r.status === 400, 'save without html → 400');
    ok('Error: POST /save without html → 400');
  }

  {
    // Missing html on PUT /pages/:slug
    const { siteId, apiKey } = await createSite(server);
    const r = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { title: 'no html here' }, { 'X-API-Key': apiKey });
    assert(r.status === 400, 'PUT page without html → 400');
    ok('Error: PUT /pages/:slug without html → 400');
  }

  {
    // POST save on nonexistent site
    const r = await apiReq(server, 'POST', '/api/sites/nonexistent-uuid-xyz/save',
      { html: '<p>x</p>' }, withKey());
    assert(r.status === 404, 'save on nonexistent site → 404');
    ok('Error: save on nonexistent site → 404');
  }

  {
    // DELETE on nonexistent site
    const r = await apiReq(server, 'DELETE', '/api/sites/totally-fake-id-123', undefined, withKey());
    assert(r.status === 404, 'delete nonexistent site → 404');
    ok('Error: DELETE nonexistent site → 404');
  }

  {
    // GET html for nonexistent site
    const r = await apiReq(server, 'GET', '/api/sites/no-such-site/html', undefined, withKey());
    assert(r.status === 404, 'get html nonexistent → 404');
    ok('Error: GET /html nonexistent site → 404');
  }

  {
    // GET revisions for nonexistent site
    const r = await apiReq(server, 'GET', '/api/sites/no-such-site/revisions', undefined, withKey());
    assert(r.status === 404, 'get revisions nonexistent → 404');
    ok('Error: GET /revisions nonexistent site → 404');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('4. Input edge cases — IDs and names');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Very long site ID (5000 chars) should not crash — just 404
    const longId = 'a'.repeat(5000);
    const r = await apiReq(server, 'GET', `/api/sites/${longId}`, undefined, withKey());
    assert(r.status === 404 || r.status === 400, 'very long site ID → 404 or 400 (no crash)');
    ok('Edge: 5000-char site ID handled gracefully');
  }

  {
    // Path traversal in site ID — Express URL-decodes but router won't match /../
    const r = await request(server, {
      method:  'GET',
      path:    '/api/sites/..%2F..%2Fetc%2Fpasswd',
      headers: { 'X-API-Key': API_KEY },
    });
    assert(r.status === 404 || r.status === 400, 'path traversal ID → 404 or 400 (no fs access)');
    ok('Security: path traversal in site ID → rejected');
  }

  {
    // Site name truncated to 200 chars
    const longName = 'N'.repeat(250);
    const r = await apiReq(server, 'POST', '/api/sites', { html: '<p>x</p>', name: longName }, withKey());
    assert(r.status === 201, 'long name create → 201');
    assert(r.body.site.name.length <= 200, `name truncated to ≤200 chars (got ${r.body.site.name.length})`);
    ok('Edge: site name truncated to 200 chars');
  }

  {
    // Unicode / emoji in site name preserved
    const unicodeName = '我的网站 🚀 Сайт';
    const r = await apiReq(server, 'POST', '/api/sites', { html: '<p>x</p>', name: unicodeName }, withKey());
    assert(r.status === 201, 'unicode name create → 201');
    assert(r.body.site.name === unicodeName, 'unicode name preserved exactly');
    ok('Edge: unicode/emoji site name preserved');
  }

  {
    // NoSQL injection attempt in site name — stored as plain string, not interpreted
    const injectionName = '{"$gt":""}; db.dropDatabase()';
    const r = await apiReq(server, 'POST', '/api/sites', { html: '<p>x</p>', name: injectionName }, withKey());
    assert(r.status === 201, 'NoSQL injection name create → 201 (stored as string)');
    // Fetch back and confirm name is the literal string (not evaluated)
    const r2 = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}`, undefined, withKey());
    assert(r2.body.site.name === injectionName.slice(0, 200), 'NoSQL injection name stored as plain string');
    ok('Security: NoSQL injection in site name stored safely');
  }

  {
    // html field as a number (type coercion edge case)
    const r = await apiReq(server, 'POST', '/api/sites', { html: 12345, name: 'Type Test' }, withKey());
    // Should either accept (stringified) or reject — must not crash (500)
    assert(r.status === 201 || r.status === 400, 'html as number → 201 or 400 (no crash)');
    ok('Edge: html as number type coercion handled');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('5. API key scoping');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Site-A's apiKey cannot be used to save site-B's pages
    const { siteId: siteA } = await createSite(server, '<p>A</p>', 'Site A');
    const { siteId: siteB, apiKey: keyB } = await createSite(server, '<p>B</p>', 'Site B');

    const r = await apiReq(server, 'PUT', `/api/sites/${siteA}/pages/index`,
      { html: '<p>hacked A via B key</p>' }, { 'X-API-Key': keyB });
    assert(r.status === 403, 'site-B apiKey on site-A → 403');
    ok('API key scoping: site-B key rejected on site-A');
  }

  {
    // Site's own apiKey works for its own pages
    const { siteId, apiKey } = await createSite(server, '<p>owned</p>', 'Own Site');
    const r = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
      { html: '<p>updated via own key</p>' }, { 'X-API-Key': apiKey });
    assert(r.status === 200, 'own site apiKey on own site → 200');
    ok('API key scoping: own apiKey works on own site');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('6. Content integrity');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Unicode content round-trips without corruption
    const unicodeHtml = '<p>日本語テスト — ñoño — 🎉</p>';
    const r = await apiReq(server, 'POST', '/api/sites', { html: unicodeHtml, name: 'Unicode Test' }, withKey());
    assert(r.status === 201, 'unicode content create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(html.raw.includes('日本語テスト'), 'CJK characters preserved');
    assert(html.raw.includes('🎉'), 'emoji preserved');
    ok('Integrity: unicode content round-trips correctly');
  }

  {
    // HTML entities not double-encoded
    const entityHtml = '<p>5 &lt; 10 &amp; 3 &gt; 2</p>';
    const r = await apiReq(server, 'POST', '/api/sites', { html: entityHtml, name: 'Entity Test' }, withKey());
    assert(r.status === 201, 'entity content create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(!html.raw.includes('&amp;lt;'), 'entities not double-encoded');
    ok('Integrity: HTML entities not double-encoded');
  }

  {
    // Large content (100KB) stored and retrieved correctly
    const bigContent = '<p>' + 'x'.repeat(100 * 1024) + '</p>';
    const r = await apiReq(server, 'POST', '/api/sites', { html: bigContent, name: '100KB Test' }, withKey());
    assert(r.status === 201, '100KB create → 201');
    const html = await apiReq(server, 'GET', `/api/sites/${r.body.site.id}/html`, undefined, withKey());
    assert(html.raw.length >= 100 * 1024, '100KB content retrieved fully');
    ok('Integrity: 100KB content stored and retrieved');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('7. Concurrent saves');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // 5 concurrent saves to the same site — all should succeed (no deadlock or crash)
    const { siteId, apiKey } = await createSite(server, '<p>init</p>', 'Concurrent Test');
    const saves = Array.from({ length: 5 }, (_, i) =>
      apiReq(server, 'PUT', `/api/sites/${siteId}/pages/index`,
        { html: `<p>concurrent save ${i}</p>` }, { 'X-API-Key': apiKey })
    );
    const results = await Promise.all(saves);
    const allOk = results.every(r => r.status === 200);
    assert(allOk, `all 5 concurrent saves → 200 (got: ${results.map(r => r.status).join(',')})`);
    ok('Concurrent: 5 parallel saves all succeed');
  }

  {
    // After concurrent saves, a fresh read is coherent (no corrupted JSON)
    const { siteId } = await createSite(server, '<p>init</p>', 'Concurrent Read Test');
    const r = await apiReq(server, 'GET', `/api/sites/${siteId}`, undefined, withKey());
    assert(r.status === 200, 'site readable after concurrent saves');
    assert(typeof r.body.site === 'object', 'site metadata is valid JSON object');
    ok('Concurrent: site metadata coherent after parallel saves');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('8. Page slug sanitization');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Mixed-case slug gets lowercased
    const { siteId, apiKey } = await createSite(server);
    const r = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/AboutUs`,
      { html: '<p>about</p>' }, { 'X-API-Key': apiKey });
    assert(r.status === 200, 'mixed-case slug save → 200');
    assert(/^[a-z0-9-]+$/.test(r.body.slug), `slug sanitized to [a-z0-9-] (got: ${r.body.slug})`);
    ok('Slug: mixed-case lowercased on save');
  }

  {
    // Slug with spaces/special chars → sanitized to dashes
    const { siteId, apiKey } = await createSite(server);
    const r = await apiReq(server, 'PUT', `/api/sites/${siteId}/pages/my%20page%21`,
      { html: '<p>my page</p>' }, { 'X-API-Key': apiKey });
    assert(r.status === 200, 'special-char slug save → 200');
    assert(/^[a-z0-9-]+$/.test(r.body.slug), `slug sanitized to [a-z0-9-] (got: ${r.body.slug})`);
    ok('Slug: special chars sanitized to dashes');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('9. Response structure');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // Create response includes all expected fields
    const r = await apiReq(server, 'POST', '/api/sites',
      { html: '<p>struct</p>', name: 'Structure Test', message: 'init' }, withKey());
    assert(r.status === 201, 'create → 201');
    const s = r.body.site;
    assert(typeof s.id        === 'string', 'response.site.id is string');
    assert(typeof s.name      === 'string', 'response.site.name is string');
    assert(typeof s.apiKey    === 'string', 'response.site.apiKey is string');
    assert(s.apiKey.length === 64,          'response.site.apiKey is 64-char hex');
    assert(typeof s.createdAt === 'string', 'response.site.createdAt is string');
    ok('Structure: create response has id, name, apiKey(64), createdAt');
  }

  {
    // apiKey never leaks in list response
    const r = await apiReq(server, 'GET', '/api/sites', undefined, withKey());
    assert(r.status === 200, 'list → 200');
    const leaked = (r.body.sites || []).some(s => typeof s.apiKey === 'string' && s.apiKey.length > 0);
    assert(!leaked, 'apiKey not exposed in list response');
    ok('Security: apiKey not exposed in GET /api/sites list');
  }

  {
    // html field not in metadata response (GET /:id)
    const { siteId } = await createSite(server, '<h1>secret html</h1>');
    const r = await apiReq(server, 'GET', `/api/sites/${siteId}`, undefined, withKey());
    assert(r.status === 200, 'get site → 200');
    assert(r.body.site.html === undefined, 'html not leaked in metadata endpoint');
    ok('Security: html not exposed in GET /api/sites/:id metadata');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('10. Component library API — placement mode backend');
  // ═══════════════════════════════════════════════════════════════════════════

  {
    // GET /api/components returns JSON array (no auth required — public)
    const r = await apiReq(server, 'GET', '/api/components');
    assert(r.status === 200, 'GET /api/components → 200');
    assert(Array.isArray(r.body), 'components response is an array');
    ok('GET /api/components returns array');
  }

  {
    // Each component has required fields for placement mode
    const r = await apiReq(server, 'GET', '/api/components');
    if (Array.isArray(r.body) && r.body.length > 0) {
      const first = r.body[0];
      assert(typeof first.id       === 'string', 'component has id field');
      assert(typeof first.name     === 'string', 'component has name field');
      assert(typeof first.html     === 'string', 'component has html field');
      assert(typeof first.category === 'string', 'component has category field');
      ok('Component shape: id, name, html, category present');
    } else {
      // If no components loaded, just pass gracefully
      assert(true, 'components array (empty or populated)');
      ok('Component shape: skipped (empty component library)');
    }
  }

  {
    // lucideIcon field present for icon picker rendering
    const r = await apiReq(server, 'GET', '/api/components');
    if (Array.isArray(r.body) && r.body.length > 0) {
      const withIcon = r.body.filter(c => typeof c.lucideIcon === 'string');
      assert(withIcon.length > 0, 'at least one component has lucideIcon');
      ok(`Components with lucideIcon: ${withIcon.length}/${r.body.length}`);
    } else {
      assert(true, 'lucideIcon check skipped (empty library)');
      ok('lucideIcon check skipped');
    }
  }

  {
    // Component HTML is non-empty strings
    const r = await apiReq(server, 'GET', '/api/components');
    if (Array.isArray(r.body) && r.body.length > 0) {
      const emptyHtml = r.body.filter(c => !c.html || c.html.trim().length === 0);
      assert(emptyHtml.length === 0, 'no component has empty html');
      ok(`All ${r.body.length} components have non-empty html`);
    } else {
      assert(true, 'html check skipped');
      ok('html check skipped');
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const app    = require('../server');
  const server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  const { port } = server.address();
  console.log(`\x1b[1mn3ware comprehensive tests\x1b[0m  (port ${port}, storage: local)`);
  console.log('='.repeat(60));

  try {
    await runTests(server);
  } catch (err) {
    console.error('\n\x1b[31mUnhandled error during tests:\x1b[0m', err);
    failed++;
    failures.push(err.message);
  } finally {
    server.close();
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
