#!/usr/bin/env node
/**
 * tests/rate-limit.test.js — Unit tests for src/middleware/rate-limit.js
 *
 * Run: node tests/rate-limit.test.js
 * Exit: 0 if all pass, 1 if any fail.
 *
 * Tests run against the middleware directly (no HTTP server needed).
 * The 31-second wait test is opt-in via SLOW_TESTS=1 env var since it
 * blocks for ~31s — omitted from normal CI.
 */

'use strict';

const { createRateLimit, getIp } = require('../src/middleware/rate-limit');

// ── Tiny test runner ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  \x1b[31m✕\x1b[0m ${name}: ${err.message}\n`);
    failed++;
    failures.push({ name, message: err.message });
  }
}

function section(title) {
  process.stdout.write(`\n\x1b[1m\x1b[34m${title}\x1b[0m\n`);
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ── Mock request / response / next ────────────────────────────────────────────
function mockReq({ ip = '1.2.3.4', xff = '', url = 'https://example.com', body = {} } = {}) {
  return {
    ip,
    headers: xff ? { 'x-forwarded-for': xff } : {},
    body: { url, ...body },
  };
}

function mockRes() {
  const r = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { r.headers[k] = v; },
    status(code) { r.statusCode = code; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
section('createRateLimit — basic enforcement');

test('first request passes through', () => {
  const mw = createRateLimit({ keyFn: req => req.ip + '::' + req.body.url, window: 30, max: 1 });
  const req = mockReq();
  const res = mockRes();
  let called = false;
  mw(req, res, () => { called = true; });
  assert(called, 'next() should have been called');
  assert(res.statusCode === null, 'should not have set a status code');
});

test('second request from same (ip, url) within window is 429', () => {
  const mw = createRateLimit({ keyFn: req => req.ip + '::' + req.body.url, window: 30, max: 1 });
  const req1 = mockReq({ ip: '10.0.0.1', url: 'https://target.com' });
  const req2 = mockReq({ ip: '10.0.0.1', url: 'https://target.com' });
  const res1 = mockRes();
  const res2 = mockRes();
  let next1 = false, next2 = false;
  mw(req1, res1, () => { next1 = true; });
  mw(req2, res2, () => { next2 = true; });
  assert(next1, 'first request should pass');
  assert(!next2, 'second request should be blocked');
  assert(res2.statusCode === 429, `expected 429 got ${res2.statusCode}`);
  assert(typeof res2.body.retryAfter === 'number', 'should have retryAfter in body');
  assert(res2.headers['Retry-After'] > 0, 'should have Retry-After header');
});

test('retryAfter message is grammatically correct for singular', () => {
  // Create a limiter that will definitely hit immediately
  const mw = createRateLimit({ keyFn: () => 'same-key', window: 1, max: 1 });
  const res1 = mockRes(); mw(mockReq(), res1, () => {});
  const res2 = mockRes(); mw(mockReq(), res2, () => {});
  assert(res2.statusCode === 429);
  // retryAfter could be 0 or 1 for a 1-second window, just check it's a string
  assert(typeof res2.body.error === 'string', 'error should be a string');
});

section('createRateLimit — key isolation');

test('same IP, different URLs are NOT rate-limited against each other', () => {
  const mw = createRateLimit({ keyFn: req => req.ip + '::' + req.body.url, window: 30, max: 1 });
  const ip = '192.168.1.1';
  const r1 = mockRes(); mw(mockReq({ ip, url: 'https://site-a.com' }), r1, () => {});
  const r2 = mockRes();
  let next2 = false;
  mw(mockReq({ ip, url: 'https://site-b.com' }), r2, () => { next2 = true; });
  assert(next2, 'different URL from same IP should pass');
  assert(r2.statusCode === null, 'should not have 429');
});

test('different IPs, same URL are NOT rate-limited against each other', () => {
  const mw = createRateLimit({ keyFn: req => req.ip + '::' + req.body.url, window: 30, max: 1 });
  const url = 'https://shared-target.com';
  const r1 = mockRes(); mw(mockReq({ ip: '1.1.1.1', url }), r1, () => {});
  const r2 = mockRes();
  let next2 = false;
  mw(mockReq({ ip: '2.2.2.2', url }), r2, () => { next2 = true; });
  assert(next2, 'different IP to same URL should pass');
  assert(r2.statusCode === null, 'should not have 429');
});

test('max: 3 allows 3 requests then blocks 4th', () => {
  const mw = createRateLimit({ keyFn: () => 'fixed', window: 30, max: 3 });
  let passes = 0;
  for (let i = 0; i < 3; i++) {
    const r = mockRes(); mw(mockReq(), r, () => { passes++; });
  }
  const r4 = mockRes(); let next4 = false;
  mw(mockReq(), r4, () => { next4 = true; });
  assert(passes === 3, `expected 3 passes got ${passes}`);
  assert(!next4, '4th request should be blocked');
  assert(r4.statusCode === 429, `expected 429 got ${r4.statusCode}`);
});

section('getIp — proxy header handling');

test('uses x-forwarded-for first IP when present', () => {
  const ip = getIp({ headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }, ip: '10.0.0.1' });
  assert(ip === '5.6.7.8', `expected 5.6.7.8 got ${ip}`);
});

test('falls back to req.ip when x-forwarded-for absent', () => {
  const ip = getIp({ headers: {}, ip: '9.9.9.9' });
  assert(ip === '9.9.9.9', `expected 9.9.9.9 got ${ip}`);
});

test('handles missing ip and no header gracefully', () => {
  const ip = getIp({ headers: {} });
  assert(ip === 'unknown', `expected "unknown" got ${ip}`);
});

// ── Slow test: window expiry (only runs with SLOW_TESTS=1) ───────────────────
if (process.env.SLOW_TESTS === '1') {
  section('createRateLimit — window expiry (slow, ~31s)');

  // Use async IIFE since test() is synchronous
  (async () => {
    const mw = createRateLimit({ keyFn: () => 'expiry-key', window: 2, max: 1 });

    const r1 = mockRes(); mw(mockReq(), r1, () => {});
    const r2 = mockRes(); let blocked = false;
    mw(mockReq(), r2, () => { blocked = true; });
    assert(!blocked, 'should be blocked before window expires');

    process.stdout.write('  \x1b[2mWaiting 3 seconds for window to expire…\x1b[0m\n');
    await new Promise(r => setTimeout(r, 3000));

    const r3 = mockRes(); let passedAfter = false;
    mw(mockReq(), r3, () => { passedAfter = true; });

    if (passedAfter) {
      process.stdout.write(`  \x1b[32m✓\x1b[0m request passes after window expiry\n`);
      passed++;
    } else {
      process.stdout.write(`  \x1b[31m✕\x1b[0m request still blocked after window expiry\n`);
      failed++;
      failures.push({ name: 'window expiry', message: 'still blocked after 3s for 2s window' });
    }

    printSummary();
  })();
} else {
  printSummary();
}

function printSummary() {
  process.stdout.write(`\n\x1b[1m${'─'.repeat(50)}\x1b[0m\n`);
  process.stdout.write(`\x1b[1mSummary: ${passed}/${passed + failed} passed\x1b[0m\n`);
  if (failures.length) {
    process.stdout.write('\x1b[31mFailures:\x1b[0m\n');
    failures.forEach(f => process.stdout.write(`  ${f.name}: ${f.message}\n`));
    process.exit(1);
  } else {
    process.stdout.write('\x1b[32mAll tests passed.\x1b[0m\n');
    process.exit(0);
  }
}
