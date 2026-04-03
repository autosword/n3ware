'use strict';

/**
 * Google Secret Manager loader.
 *
 * In production (NODE_ENV=production + GOOGLE_CLOUD_PROJECT set) this fetches
 * every secret listed in SECRET_MAP from GSM and writes the value into
 * process.env so that all downstream requires see them as normal env vars.
 *
 * In local development the function returns immediately — .env / dotenv
 * handles secrets the usual way.
 *
 * Values that are already present in process.env are NEVER overwritten, so
 * Cloud Run --set-env-vars still takes precedence if you ever need an override.
 */

const SECRET_MAP = {
  'jwt-secret':               'JWT_SECRET',
  'master-api-key':           'MASTER_API_KEY',
  'stripe-secret-key':        'STRIPE_SECRET_KEY',
  'stripe-webhook-secret':    'STRIPE_WEBHOOK_SECRET',
  'stripe-starter-price-id':  'STRIPE_STARTER_PRICE_ID',
  'stripe-pro-price-id':      'STRIPE_PRO_PRICE_ID',
  'stripe-agency-price-id':   'STRIPE_AGENCY_PRICE_ID',
  'sendgrid-api-key':         'SENDGRID_API_KEY',
  'postmark-api-key':         'POSTMARK_API_KEY',
  'cloudflare-api-token':     'CLOUDFLARE_API_TOKEN',
  'cloudflare-account-id':    'CLOUDFLARE_ACCOUNT_ID',
  'cloudflare-zone-id':       'CLOUDFLARE_ZONE_ID',
  'r2-access-key-id':         'R2_ACCESS_KEY_ID',
  'r2-secret-access-key':     'R2_SECRET_ACCESS_KEY',
  'anthropic-api-key':        'ANTHROPIC_API_KEY',
  'google-client-id':         'GOOGLE_CLIENT_ID',
  'google-client-secret':     'GOOGLE_CLIENT_SECRET',
};

async function loadSecrets() {
  if (process.env.NODE_ENV !== 'production' || !process.env.GOOGLE_CLOUD_PROJECT) {
    return; // local dev — rely on .env / dotenv
  }

  let client;
  try {
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    client = new SecretManagerServiceClient();
  } catch (err) {
    console.warn('[secrets] @google-cloud/secret-manager not available, skipping GSM load');
    return;
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const loaded  = [];

  for (const [secretName, envVar] of Object.entries(SECRET_MAP)) {
    if (process.env[envVar]) continue; // already set — do not overwrite

    try {
      const name = `projects/${project}/secrets/${secretName}/versions/latest`;
      const [version] = await client.accessSecretVersion({ name });
      process.env[envVar] = version.payload.data.toString('utf8');
      loaded.push(envVar);
    } catch (err) {
      console.warn(`[secrets] Could not load ${secretName}: ${err.message}`);
    }
  }

  if (loaded.length) {
    console.log(`[secrets] Loaded from Secret Manager: ${loaded.join(', ')}`);
  }
}

module.exports = { loadSecrets };
