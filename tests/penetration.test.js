#!/usr/bin/env node
/**
 * tests/penetration.test.js — n3ware API penetration / auth boundary test suite
 *
 * Exercises every API route with missing, bogus, expired, and wrong-secret
 * credentials. Also tests injection payloads, oversized bodies, and method
 * override mismatches. Does NOT mutate data.
 *
 * Usage:
 *   node tests/penetration.test.js
 *   BASE_URL=http://localhost:8080 node tests/penetration.test.js
 *
 * Exit: 0 if all pass, 1 if any fail.
 *
 * NOTE: This is NOT part of the normal dev loop. Run manually before major
 * launches or after auth-related changes only. See CLAUDE.md §22.
 */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL    = (process.env.BASE_URL || 'https://n3ware.com').replace(/\/$/, '');
const DELAY_MS    = 100;   // between requests — avoids WAF / rate-limiter triggers
const FAKE_SITE   = 'pen-test-nonexistent-site-000';
const FAKE_SLUG   = 'pen-test-slug';
const FAKE_JOB    = 'pen-test-job-000';
const FAKE_REV    = 'pen-test-rev-000';
const OVERSIZED   = 'x'.repeat(11 * 1024 * 1024);  // 11MB string

// ── Minimal JWT builder (no external deps) ────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function makeJwt(payload, secret) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify(payload));
  const { createHmac } = require('crypto');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const NOW = Math.floor(Date.now() / 1000);
// Expired JWT signed with "wrong" secret
const EXPIRED_JWT     = makeJwt({ sub: 'u_pentest', iat: NOW - 7200, exp: NOW - 3600 }, 'wrong-secret');
// Valid-structure JWT but signed with random secret (will fail verify)
const BAD_SECRET_JWT  = makeJwt({ sub: 'u_pentest', iat: NOW,        exp: NOW + 3600 }, 'not-the-real-secret-' + Math.random());

// ── Route manifest ────────────────────────────────────────────────────────────
// auth: 'required'  — expect 401/403 with no/bad credentials
// auth: 'public'    — no cred checks; still test injection/oversized/method mismatch
// skip: true        — excluded (domain purchase, webhook, OAuth callbacks, etc.)
//
// Path tokens like :id are substituted with FAKE_SITE (etc.) at request time.

const ROUTES = [
  // ── Auth endpoints ────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/auth/magic',              auth: 'public'   },
  { method: 'GET',  path: '/api/auth/verify',             auth: 'public'   },
  { method: 'GET',  path: '/api/auth/magic/status',       auth: 'public'   },
  { method: 'POST', path: '/api/auth/register',           auth: 'public'   },
  { method: 'POST', path: '/api/auth/login',              auth: 'public'   },
  { method: 'GET',  path: '/api/auth/me',                 auth: 'required' },

  // ── Sites ────────────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/sites',                   auth: 'required' },
  { method: 'POST', path: '/api/sites',                   auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id',               auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/html',          auth: 'required' },
  { method: 'POST', path: '/api/sites/:id/save',          auth: 'required' },
  { method: 'PUT',  path: '/api/sites/:id/theme',         auth: 'required' },
  { method: 'DELETE', path: '/api/sites/:id',             auth: 'required' },

  // ── Pages (v2) ────────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/sites/:id/pages',                      auth: 'required' },
  { method: 'POST', path: '/api/sites/:id/pages',                      auth: 'required' },
  { method: 'PUT',  path: '/api/sites/:id/pages/:slug',                auth: 'required' },
  { method: 'DELETE', path: '/api/sites/:id/pages/:slug',              auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/pages/:slug/versions',       auth: 'required' },
  { method: 'POST', path: '/api/sites/:id/pages/:slug/rollback',       auth: 'required' },
  { method: 'POST', path: '/api/sites/:id/pages/generate',             auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/manifest',                   auth: 'required' },
  { method: 'PATCH', path: '/api/sites/:id/manifest',                  auth: 'required' },

  // ── Components (shared: header/nav/footer) ────────────────────────────────
  { method: 'GET',  path: '/api/sites/:id/components/:name',           auth: 'required' },
  { method: 'PUT',  path: '/api/sites/:id/components/:name',           auth: 'required' },

  // ── Revisions ────────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/sites/:id/revisions',                  auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/revisions/:revId',           auth: 'required' },
  { method: 'POST', path: '/api/sites/:id/revisions/:revId/rollback',  auth: 'required' },

  // ── Integrations ─────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/sites/:id/integrations',               auth: 'required' },
  { method: 'PUT',  path: '/api/sites/:id/integrations',               auth: 'required' },
  { method: 'DELETE', path: '/api/sites/:id/integrations/:key',        auth: 'required' },

  // ── Billing ──────────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/billing',                              auth: 'public'   },
  { method: 'POST', path: '/api/billing/checkout',                     auth: 'required' },
  { method: 'GET',  path: '/api/billing/subscription',                 auth: 'required' },
  { method: 'POST', path: '/api/billing/cancel',                       auth: 'required' },
  { method: 'POST', path: '/api/billing/webhook',   auth: 'public',   skip: 'webhook — raw body, not worth probing' },

  // ── Domains ───────────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/domains/search',                       auth: 'required' },
  { method: 'GET',  path: '/api/domains',                              auth: 'required' },
  { method: 'POST', path: '/api/domains/register',  auth: 'required',  skip: 'SKIP — could accidentally purchase a domain' },
  { method: 'POST', path: '/api/domains/sites/:id/connect',            auth: 'required' },
  { method: 'DELETE', path: '/api/domains/sites/:id/connect',          auth: 'required' },
  { method: 'GET',  path: '/api/domains/sites/:id/verify',             auth: 'required' },

  // ── Uploads ───────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/uploads/:id/upload',                   auth: 'required' },
  { method: 'GET',  path: '/api/uploads/:id/files',                    auth: 'required' },
  { method: 'GET',  path: '/api/uploads/:id/upload-url',               auth: 'required' },

  // ── Analytics ────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/analytics/:id/track',  auth: 'public',  skipInjection: 'write-only tracking endpoint — accepts any siteId by design, 200 is correct' },
  { method: 'GET',  path: '/api/analytics/:id',                        auth: 'required' },
  { method: 'GET',  path: '/api/analytics/:id/daily',                  auth: 'required' },

  // ── Migration ────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/migrate/scrape',                       auth: 'public'   },
  { method: 'POST', path: '/api/migrate/import',                       auth: 'required' },
  { method: 'GET',  path: '/api/migrate/status/:jobId',                auth: 'public'   },

  // ── Google Analytics ──────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/ga/auth-url',                          auth: 'required' },
  { method: 'GET',  path: '/api/ga/callback',       auth: 'public'                      },
  { method: 'GET',  path: '/api/ga/properties',                        auth: 'required' },
  { method: 'POST', path: '/api/sites/:id/ga/connect',                 auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/ga/stats',                   auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/ga/page',                    auth: 'required' },
  { method: 'GET',  path: '/api/sites/:id/ga/realtime',                auth: 'required' },
  { method: 'DELETE', path: '/api/sites/:id/ga',                       auth: 'required' },

  // ── Component library (public) ────────────────────────────────────────────
  { method: 'GET',  path: '/api/components',                           auth: 'public'   },
  { method: 'GET',  path: '/api/components/categories',                auth: 'public'   },
  { method: 'GET',  path: '/api/components/:id',                       auth: 'public'   },
  { method: 'POST', path: '/api/components/customize',                 auth: 'public'   },

  // ── Templates (public) ───────────────────────────────────────────────────
  { method: 'GET',  path: '/api/templates',                            auth: 'public'   },
  { method: 'GET',  path: '/api/templates/:name',                      auth: 'public'   },
  { method: 'GET',  path: '/api/page-templates',                       auth: 'public'   },
  { method: 'GET',  path: '/api/page-templates/:id',                   auth: 'public'   },

  // ── Internal ─────────────────────────────────────────────────────────────
  { method: 'GET',  path: '/api/cache/stats',                          auth: 'required' },

  // ── Health (public) ───────────────────────────────────────────────────────
  { method: 'GET',  path: '/health',                                   auth: 'public'   },
];

// ── Path substitution ─────────────────────────────────────────────────────────
function resolvePath(p) {
  return p
    .replace(':id',   FAKE_SITE)
    .replace(':slug', FAKE_SLUG)
    .replace(':jobId', FAKE_JOB)
    .replace(':revId', FAKE_REV)
    .replace(':name', 'header')
    .replace(':key',  'ga4');
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function req(method, path, { headers = {}, body } = {}) {
  const url  = BASE_URL + path;
  const opts = { method, headers: { ...headers }, redirect: 'manual' };
  if (body !== undefined) {
    if (typeof body === 'string') {
      opts.body = body;
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  try {
    const r = await fetch(url, opts);
    return r.status;
  } catch (e) {
    return -1;  // network error
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function isAuthReject(status) { return status === 401 || status === 403; }
function is2xx(status)        { return status >= 200 && status < 300; }

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
};
const pad = (s, n) => String(s).padEnd(n);

// ── Result tracking ───────────────────────────────────────────────────────────
let totalChecks = 0;
let passed = 0;
const failures = [];

function recordPass(method, path, attackCase, status) {
  passed++;
  totalChecks++;
  const badge  = `${C.green}✓ PASS${C.reset}`;
  const status_ = `${C.dim}[${status}]${C.reset}`;
  process.stdout.write(`  ${badge} ${status_} ${pad(method, 7)} ${pad(path, 44)} ${C.dim}(${attackCase})${C.reset}\n`);
}

function recordFail(method, path, attackCase, status, expected, note) {
  totalChecks++;
  failures.push({ method, path, attackCase, status, expected, note });
  const badge   = `${C.red}✗ FAIL${C.reset}`;
  const status_ = `${C.red}[${status}]${C.reset}`;
  const exp_    = `${C.dim}expected ${expected}${C.reset}`;
  process.stdout.write(`  ${badge} ${status_} ${pad(method, 7)} ${pad(path, 44)} ${C.red}(${attackCase})${C.reset} — ${note}\n`);
}

function recordSkip(method, path, attackCase, reason) {
  const badge = `${C.yellow}○ SKIP${C.reset}`;
  process.stdout.write(`  ${badge}        ${pad(method, 7)} ${pad(path, 44)} ${C.dim}${reason}${C.reset}\n`);
}

// ── Attack cases ──────────────────────────────────────────────────────────────

async function runAuthAttacks(route, resolvedPath) {
  const { method } = route;
  // A minimal non-mutating body for POST/PUT/PATCH that would otherwise fail with 400
  const minBody = ['POST', 'PUT', 'PATCH'].includes(method) ? { _pen: 1 } : undefined;

  // 1. No credentials
  {
    const s = await req(method, resolvedPath, { body: minBody });
    await delay(DELAY_MS);
    if (isAuthReject(s)) recordPass(method, resolvedPath, 'no creds', s);
    else recordFail(method, resolvedPath, 'no creds', s, '401/403', `server accepted unauthenticated request (${s})`);
  }

  // 2. Bogus Bearer token
  {
    const s = await req(method, resolvedPath, { headers: { Authorization: 'Bearer totally-fake-jwt-definitely-not-real' }, body: minBody });
    await delay(DELAY_MS);
    if (isAuthReject(s)) recordPass(method, resolvedPath, 'bogus bearer', s);
    else recordFail(method, resolvedPath, 'bogus bearer', s, '401/403', `bogus bearer accepted (${s})`);
  }

  // 3. Bogus API key
  {
    const s = await req(method, resolvedPath, { headers: { 'X-Api-Key': 'n3-fake-00000000000000000000000000000000' }, body: minBody });
    await delay(DELAY_MS);
    if (isAuthReject(s)) recordPass(method, resolvedPath, 'bogus api key', s);
    else recordFail(method, resolvedPath, 'bogus api key', s, '401/403', `bogus api key accepted (${s})`);
  }

  // 4. Bogus cookie
  {
    const s = await req(method, resolvedPath, { headers: { Cookie: 'n3_token=garbage.garbage.garbage' }, body: minBody });
    await delay(DELAY_MS);
    if (isAuthReject(s)) recordPass(method, resolvedPath, 'bogus cookie', s);
    else recordFail(method, resolvedPath, 'bogus cookie', s, '401/403', `bogus cookie accepted (${s})`);
  }

  // 5. Expired JWT (signed with wrong secret)
  {
    const s = await req(method, resolvedPath, { headers: { Authorization: `Bearer ${EXPIRED_JWT}` }, body: minBody });
    await delay(DELAY_MS);
    if (isAuthReject(s)) recordPass(method, resolvedPath, 'expired jwt', s);
    else recordFail(method, resolvedPath, 'expired jwt', s, '401/403', `expired jwt accepted (${s})`);
  }

  // 6. JWT signed with wrong secret (valid structure, future exp)
  {
    const s = await req(method, resolvedPath, { headers: { Authorization: `Bearer ${BAD_SECRET_JWT}` }, body: minBody });
    await delay(DELAY_MS);
    if (isAuthReject(s)) recordPass(method, resolvedPath, 'wrong-secret jwt', s);
    else recordFail(method, resolvedPath, 'wrong-secret jwt', s, '401/403', `wrong-secret jwt accepted (${s})`);
  }

  // 7. Wrong-owner isolation — requires two real tokens we don't have; note it
  recordSkip(method, resolvedPath, 'wrong-owner isolation', 'TODO: requires two distinct authenticated sessions — run manually');
}

async function runInputAttacks(route, resolvedPath) {
  const { method } = route;

  // 8. Injection payloads
  const SQL_INJ   = `'; DROP TABLE users; --`;
  const NOSQL_INJ = `{"$ne":null}`;
  if (route.skipInjection) {
    recordSkip(method, resolvedPath, 'injection (sql)',   route.skipInjection);
    recordSkip(method, resolvedPath, 'injection (nosql)', route.skipInjection);
  } else {
  // Strategy: only inject into URL if the route template actually has a path param.
  // For parameterless routes, the substitution is a no-op and a 200 is expected
  // normal behavior — testing injection there produces false positives.
  const hasPathParam = route.path.includes(':');

  if (hasPathParam) {
    // Substitute into URL path param positions
    const injPaths = [
      resolvedPath.replace(FAKE_SITE, SQL_INJ).replace(FAKE_SLUG, SQL_INJ)
                  .replace(FAKE_JOB, SQL_INJ).replace(FAKE_REV, SQL_INJ),
      resolvedPath.replace(FAKE_SITE, NOSQL_INJ).replace(FAKE_SLUG, NOSQL_INJ)
                  .replace(FAKE_JOB, NOSQL_INJ).replace(FAKE_REV, NOSQL_INJ),
    ];
    for (const [label, injPath] of [['sql', injPaths[0]], ['nosql', injPaths[1]]]) {
      const injBody = ['POST', 'PUT', 'PATCH'].includes(method)
        ? { id: SQL_INJ, '$where': '1==1' }
        : undefined;
      const s = await req(method, encodeURI(injPath), { body: injBody });
      await delay(DELAY_MS);
      if (s >= 400 && s < 600 && s !== 500) {
        recordPass(method, resolvedPath, `injection (${label})`, s);
      } else if (s === 500) {
        recordFail(method, resolvedPath, `injection (${label})`, s, '4xx', `server crashed (500) on ${label} injection`);
      } else if (is2xx(s)) {
        recordFail(method, resolvedPath, `injection (${label})`, s, '4xx', `server returned ${s} — verify no data leak`);
      } else {
        recordPass(method, resolvedPath, `injection (${label} — redirect/other)`, s);
      }
    }
  } else {
    // Parameterless route: inject via query string + body only
    for (const [label, payload] of [['sql', SQL_INJ], ['nosql', NOSQL_INJ]]) {
      const injQs   = `?q=${encodeURIComponent(payload)}&id=${encodeURIComponent(payload)}`;
      const injBody = ['POST', 'PUT', 'PATCH'].includes(method)
        ? { id: payload, '$where': '1==1', q: payload }
        : undefined;
      const s = await req(method, resolvedPath + injQs, { body: injBody });
      await delay(DELAY_MS);
      // For parameterless public routes responding 200, query-string injection is not
      // a meaningful test (params are ignored). Skip if route is public and returns 200.
      if (route.auth === 'public' && is2xx(s)) {
        recordSkip(method, resolvedPath, `injection (${label} via qs)`, 'parameterless public route — 200 is expected, qs injection not testable here');
      } else if (s === 500) {
        recordFail(method, resolvedPath, `injection (${label} via qs)`, s, '4xx', `server crashed (500) on ${label} injection`);
      } else if (is2xx(s) && route.auth === 'required') {
        recordFail(method, resolvedPath, `injection (${label} via qs)`, s, '4xx', `server returned ${s} — verify no data leak`);
      } else {
        recordPass(method, resolvedPath, `injection (${label} via qs)`, s);
      }
    }
  }
  } // end skipInjection else

  // 9. Oversized payload (only for POST/PUT/PATCH)
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const s = await req(method, resolvedPath, {
      body: OVERSIZED,
      headers: { 'Content-Type': 'application/json' },
    });
    await delay(DELAY_MS);
    // Expect 413 (payload too large) or a clean rejection (400, 401, 403, 404)
    // 200/2xx would mean the server processed 11MB — unacceptable
    // 500 is also a failure (crash rather than clean rejection)
    if (s === 413 || (s >= 400 && s < 500)) {
      recordPass(method, resolvedPath, 'oversized body', s);
    } else if (s === 500) {
      recordFail(method, resolvedPath, 'oversized body', s, '413/4xx', `server crashed (500) on 11MB body`);
    } else if (is2xx(s)) {
      recordFail(method, resolvedPath, 'oversized body', s, '413', `server accepted 11MB body (${s})`);
    } else {
      recordPass(method, resolvedPath, 'oversized body', s);
    }
  }

  // 10. Method mismatch (try the opposite method)
  const altMethod = method === 'GET' ? 'POST' : 'GET';
  const s = await req(altMethod, resolvedPath, {
    body: altMethod !== 'GET' ? { _pen: 1 } : undefined,
  });
  await delay(DELAY_MS);
  // Expect 404 or 405 — NOT 500 or an unintended 2xx response
  if (s === 404 || s === 405 || (s >= 400 && s < 500)) {
    recordPass(method, resolvedPath, `method mismatch (${altMethod})`, s);
  } else if (s === 500) {
    recordFail(method, resolvedPath, `method mismatch (${altMethod})`, s, '404/405', `server crashed (500) on ${altMethod} to ${method}-only route`);
  } else if (is2xx(s)) {
    recordFail(method, resolvedPath, `method mismatch (${altMethod})`, s, '404/405', `${altMethod} to ${method} route returned ${s} — unexpected handler`);
  } else {
    recordPass(method, resolvedPath, `method mismatch (${altMethod})`, s);
  }
}

// ── Rate-limit checks ─────────────────────────────────────────────────────────
// Hits /api/migrate/scrape twice in rapid succession with the same payload.
// The safe target is https://example.com (we don't care about its content).
// IMPORTANT: After this check we wait RATE_LIMIT_WAIT_MS before continuing so
// the window has expired and subsequent pen test runs don't inherit rate-limit
// state from this run.
const RATE_LIMIT_WAIT_MS = 31_000;
const SCRAPE_TARGET = 'https://example.com';

async function runRateLimitChecks() {
  process.stdout.write(`\n${C.cyan}── Rate-limit: POST /api/migrate/scrape${C.reset} ${C.dim}[category: rate-limit]${C.reset}\n`);
  const path = '/api/migrate/scrape';
  const body = { url: SCRAPE_TARGET };

  // First request — should pass (200 or 422 if scrape fails; not 429)
  const s1 = await req('POST', path, { body });
  await delay(DELAY_MS);
  if (s1 !== 429) {
    recordPass('POST', path, 'rate-limit first request (should not be 429)', s1);
  } else {
    recordFail('POST', path, 'rate-limit first request', s1, '2xx/4xx (not 429)', 'first request was rate-limited — possible leftover state from previous run');
  }

  // Second request immediately after — must be 429
  const s2 = await req('POST', path, { body });
  await delay(DELAY_MS);
  if (s2 === 429) {
    recordPass('POST', path, 'rate-limit second request (must be 429)', s2);
  } else {
    recordFail('POST', path, 'rate-limit second request', s2, '429', `second rapid request returned ${s2} — rate limit not enforced`);
  }

  // Wait for the rate-limit window to expire so subsequent runs start clean.
  process.stdout.write(`  ${C.dim}Waiting ${RATE_LIMIT_WAIT_MS / 1000}s for rate-limit window to expire…${C.reset}\n`);
  await delay(RATE_LIMIT_WAIT_MS);
}

// ── Main runner ───────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write(`\n${C.bold}n3ware penetration test suite${C.reset}\n`);
  process.stdout.write(`${C.dim}Target: ${BASE_URL}${C.reset}\n`);
  process.stdout.write(`${C.dim}Routes: ${ROUTES.filter(r => !r.skip).length} active, ${ROUTES.filter(r => r.skip).length} skipped${C.reset}\n\n`);

  for (const route of ROUTES) {
    if (route.skip) {
      process.stdout.write(`\n${C.cyan}── ${route.method} ${route.path}${C.reset} ${C.yellow}[skipped: ${route.skip}]${C.reset}\n`);
      continue;
    }

    const resolvedPath = resolvePath(route.path);
    process.stdout.write(`\n${C.cyan}── ${route.method} ${route.path}${C.reset} ${C.dim}[${route.auth}]${C.reset}\n`);

    if (route.auth === 'required') {
      await runAuthAttacks(route, resolvedPath);
    }
    // All routes (required and public) get input attack tests
    await runInputAttacks(route, resolvedPath);
  }

  // ── Rate-limit category ───────────────────────────────────────────────────
  await runRateLimitChecks();

  // ── Summary ──────────────────────────────────────────────────────────────
  process.stdout.write(`\n${C.bold}${'─'.repeat(72)}${C.reset}\n`);
  process.stdout.write(`${C.bold}Summary: ${passed}/${totalChecks} passed, ${failures.length} failed${C.reset}\n`);

  if (failures.length === 0) {
    process.stdout.write(`\n${C.green}${C.bold}All checks passed.${C.reset}\n\n`);
    process.exit(0);
  } else {
    process.stdout.write(`\n${C.red}${C.bold}FAILURES:${C.reset}\n`);
    for (const f of failures) {
      process.stdout.write(
        `  ${C.red}✗${C.reset} ${f.method} ${f.path}\n` +
        `    attack: ${f.attackCase}\n` +
        `    actual: ${f.status}  expected: ${f.expected}\n` +
        `    detail: ${f.note}\n\n`
      );
    }
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
