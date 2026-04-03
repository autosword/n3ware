#!/usr/bin/env node
'use strict';

/**
 * Seed test data into the local storage.
 *
 * Creates:
 *   - 3 test users
 *   - 6 sites (2 per user, various templates)
 *   - 3-4 revisions per site
 *   - 30 days of fake analytics per site
 *   - Fake billing subscriptions
 *   - Fake connected domain
 *
 * Usage:
 *   node scripts/seed-test-data.js
 */

const path = require('path');

// ── Set env before requiring any app modules ──────────────────────────────────
const DATA_SITES = path.join(__dirname, '../data/sites');
process.env.DATA_DIR         = DATA_SITES;
process.env.NODE_ENV         = 'development';
process.env.MASTER_API_KEY   = 'dev-master-key';
process.env.STORAGE_BACKEND  = 'local';

const fs      = require('fs');
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');

// Reset singleton so it picks up fresh env
const { resetUserStore, getUserStore } = require('../src/storage/users');
resetUserStore();
const userStore = getUserStore();

const LocalStorage = require('../src/storage/local');
const analytics    = require('../src/integrations/analytics');

const DATA_ROOT = path.join(__dirname, '../data');
fs.mkdirSync(DATA_ROOT, { recursive: true });

// ── Test users ─────────────────────────────────────────────────────────────────
const TEST_USERS = [
  { email: 'test@example.com',  password: 'test1234',  plan: 'pro' },
  { email: 'demo@n3ware.com',   password: 'demo1234',  plan: 'starter' },
  { email: 'randy@zesty.io',    password: 'randy1234', plan: null },
];

// ── Sites to create ────────────────────────────────────────────────────────────
const SITE_DEFS = [
  { userIdx: 0, template: 'restaurant', name: 'The Waypoint Restaurant' },
  { userIdx: 0, template: 'realtor',    name: 'South County Homes' },
  { userIdx: 1, template: 'lawncare',   name: 'Green Thumb Lawn Care' },
  { userIdx: 1, template: 'handyman',   name: 'FixIt Pro Services' },
  { userIdx: 2, template: 'salon',      name: 'Lumière Salon' },
  { userIdx: 2, template: 'petcare',    name: 'Pawfect Care' },
];

async function run() {
  console.log('🌱  Seeding n3ware test data...\n');

  // ── 1. Users ────────────────────────────────────────────────────────────────
  console.log('👤  Creating users...');
  const users = [];
  for (const def of TEST_USERS) {
    let user = userStore.getUserByEmail(def.email);
    if (!user) {
      const hash = await bcrypt.hash(def.password, 10);
      user = userStore.createUser(def.email, hash);
      console.log(`    + ${def.email}`);
    } else {
      console.log(`    ~ ${def.email} (already exists)`);
    }
    users.push(user);
  }

  // ── 2. Sites ─────────────────────────────────────────────────────────────────
  console.log('\n🌐  Creating sites...');
  const storage  = new LocalStorage(DATA_SITES);
  const siteIds  = [];

  for (const def of SITE_DEFS) {
    const siteId = uuid();
    const owner  = users[def.userIdx];
    const tmplPath = path.join(__dirname, '../public/templates', `${def.template}.html`);

    if (!fs.existsSync(tmplPath)) {
      console.warn(`    ⚠ Template not found: ${def.template}.html — skipping`);
      siteIds.push(null);
      continue;
    }

    const baseHtml = fs.readFileSync(tmplPath, 'utf8');

    // Initial create
    storage.saveSite(siteId, {
      html:    baseHtml,
      name:    def.name,
      ownerId: owner.id,
      message: 'Created from template',
    });

    // Add 3 more revisions with minor messages
    const revMessages = [
      'Updated hero headline',
      'Revised contact information',
      'Added seasonal promotion',
    ];
    for (const msg of revMessages) {
      storage.saveSite(siteId, {
        html:    baseHtml,
        name:    def.name,
        ownerId: owner.id,
        message: msg,
      });
    }

    siteIds.push(siteId);
    console.log(`    + [${def.template}] ${def.name}  (${siteId.slice(0, 8)}…)`);
  }

  // ── 3. Analytics ─────────────────────────────────────────────────────────────
  console.log('\n📊  Generating analytics (30 days per site)...');
  for (const siteId of siteIds) {
    if (!siteId) continue;
    await analytics.generateMockData(siteId, 30);
  }
  console.log('    ✓ Analytics written');

  // ── 4. Billing subscriptions ─────────────────────────────────────────────────
  console.log('\n💳  Writing billing data...');
  const now = new Date();
  const subscriptions = TEST_USERS
    .map((def, i) => def.plan ? {
      id:                `sub_mock_${String(i + 1).padStart(3, '0')}`,
      userId:            users[i].id,
      planId:            `n3ware_${def.plan}`,
      status:            'active',
      currentPeriodEnd:  new Date(now.getTime() + (30 - i * 5) * 86400000).toISOString(),
      cancelAtPeriodEnd: false,
      createdAt:         new Date(now.getTime() - 60 * 86400000).toISOString(),
    } : null)
    .filter(Boolean);

  fs.writeFileSync(
    path.join(DATA_ROOT, 'subscriptions.json'),
    JSON.stringify({ subscriptions }, null, 2)
  );
  console.log(`    ✓ ${subscriptions.length} subscription(s) written`);

  // ── 5. Domain data ────────────────────────────────────────────────────────────
  console.log('\n🌍  Writing domain data...');
  const domains = {
    zones: [
      {
        id:          'zone_mock_001',
        name:        'thewaypointri.com',
        status:      'active',
        nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
        siteId:      siteIds[0],
        createdAt:   new Date(now.getTime() - 45 * 86400000).toISOString(),
      },
    ],
    registered: [
      {
        id:        'reg_mock_001',
        domain:    'thewaypointri.com',
        status:    'registered',
        expiresAt: new Date(now.getTime() + 320 * 86400000).toISOString(),
      },
    ],
  };

  fs.writeFileSync(
    path.join(DATA_ROOT, 'domains.json'),
    JSON.stringify(domains, null, 2)
  );
  console.log('    ✓ Domain data written');

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n✅  Seed complete!\n');
  console.log('Test accounts:');
  TEST_USERS.forEach((u, i) => {
    const plan = u.plan ? `(${u.plan} plan)` : '(free)';
    console.log(`  ${u.email}  /  ${u.password}  ${plan}`);
    SITE_DEFS
      .filter(s => s.userIdx === i)
      .forEach(s => console.log(`    └─ ${s.name}`));
  });
  console.log('\nStart the server:  node server.js');
  console.log('Dashboard:         http://localhost:8080/dashboard\n');
}

run().catch(err => {
  console.error('\n❌  Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
