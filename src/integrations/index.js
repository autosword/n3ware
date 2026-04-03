'use strict';

/**
 * Integration manager.
 * Initializes all integrations and exports them.
 * Each logs a notice if running in mock mode.
 */

const stripe      = require('./stripe');
const email       = require('./email');
const cloudflare  = require('./cloudflare');
const storageCloud = require('./storage-cloud');
const analytics   = require('./analytics');

// Log which integrations are running in mock mode at startup.
const mocks = [];

if (!process.env.STRIPE_SECRET_KEY) {
  mocks.push('stripe');
}
if (!process.env.SENDGRID_API_KEY && !process.env.POSTMARK_API_KEY) {
  mocks.push('email');
}
if (!process.env.CLOUDFLARE_API_TOKEN) {
  mocks.push('cloudflare');
}
if (!process.env.R2_ACCESS_KEY_ID && !process.env.GCS_BUCKET) {
  mocks.push('storage-cloud');
}

// Analytics is always local in this version.
mocks.push('analytics (local)');

if (mocks.length > 0) {
  console.log(`[integrations] Mock mode active for: ${mocks.join(', ')}`);
}

module.exports = { stripe, email, cloudflare, storageCloud, analytics };
