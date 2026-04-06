'use strict';

/**
 * Stripe billing integration.
 *
 * Mock mode: STRIPE_SECRET_KEY not set — returns fake responses.
 * Real mode: Uses stripe npm package with STRIPE_SECRET_KEY.
 */

const isMock = !process.env.STRIPE_SECRET_KEY;

let _stripe = null;
let _mockNoticeLogged = false;
let _cachedPriceId = process.env.STRIPE_PRICE_ID || null;

function getStripeRaw() {
  if (!_stripe) _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

function _mockNotice() {
  if (!_mockNoticeLogged) {
    console.log('[stripe] Running in mock mode — STRIPE_SECRET_KEY not set');
    _mockNoticeLogged = true;
  }
}

function _mockId(prefix) {
  return `${prefix}_mock_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Lazily look up or create the $20/mo n3ware Hosting product + price.
 * Cached in memory for the lifetime of the process.
 * @returns {Promise<string>} Stripe price ID
 */
async function getOrCreatePrice() {
  if (_cachedPriceId) return _cachedPriceId;
  if (isMock) { _mockNotice(); return 'price_mock_20_monthly'; }

  const stripe = getStripeRaw();

  // Find existing product
  const products = await stripe.products.list({ limit: 20, active: true });
  let product = products.data.find(p => p.name === 'n3ware Hosting');
  if (!product) {
    product = await stripe.products.create({
      name: 'n3ware Hosting',
      description: 'n3ware Pro — unlimited pages, uploads, and live site hosting.',
    });
    console.log('[stripe] Created product:', product.id);
  }

  // Find existing $20/mo price
  const prices = await stripe.prices.list({ product: product.id, limit: 20, active: true });
  let price = prices.data.find(p =>
    p.unit_amount === 2000 && p.currency === 'usd' && p.recurring?.interval === 'month'
  );
  if (!price) {
    price = await stripe.prices.create({
      product:     product.id,
      unit_amount: 2000,
      currency:    'usd',
      recurring:   { interval: 'month' },
    });
    console.log('[stripe] Created price:', price.id);
  }

  _cachedPriceId = price.id;
  return price.id;
}

/**
 * Get or create a Stripe Customer for a user.
 */
async function getOrCreateCustomer(email, existingCustomerId) {
  if (isMock) { _mockNotice(); return existingCustomerId || _mockId('cus'); }
  const stripe = getStripeRaw();
  if (existingCustomerId) return existingCustomerId;
  const customer = await stripe.customers.create({ email });
  return customer.id;
}

/**
 * Create a Stripe Checkout session for the $20/mo plan.
 */
async function createCheckoutSession({ siteId, userId, customerEmail, stripeCustomerId, successUrl, cancelUrl }) {
  if (isMock) {
    _mockNotice();
    const sessionId = _mockId('cs');
    return { id: sessionId, url: `${cancelUrl || '/dashboard'}?billing=mock_success&session=${sessionId}`, customerId: stripeCustomerId || _mockId('cus') };
  }
  const stripe    = getStripeRaw();
  const priceId   = await getOrCreatePrice();
  const customerId = await getOrCreateCustomer(customerEmail, stripeCustomerId);

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    payment_method_types: ['card'],
    mode:                 'subscription',
    line_items:           [{ price: priceId, quantity: 1 }],
    success_url:          successUrl || 'https://n3ware.com/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url:           cancelUrl  || 'https://n3ware.com/dashboard',
    metadata:             { siteId: siteId || '', userId: userId || '' },
    subscription_data:    { metadata: { siteId: siteId || '', userId: userId || '' } },
  });
  return { id: session.id, url: session.url, customerId };
}

/**
 * Create a Stripe Billing Portal session.
 */
async function createPortalSession(stripeCustomerId, returnUrl) {
  if (isMock) { _mockNotice(); return { url: returnUrl || '/dashboard' }; }
  const stripe  = getStripeRaw();
  const session = await stripe.billingPortal.sessions.create({
    customer:   stripeCustomerId,
    return_url: returnUrl || 'https://n3ware.com/dashboard',
  });
  return { url: session.url };
}

/**
 * Verify and parse a Stripe webhook event from raw body.
 */
function constructWebhookEvent(rawBody, signature) {
  if (isMock) {
    _mockNotice();
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    return JSON.parse(body);
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret.startsWith('whsec_placeholder')) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured — update via Secret Manager');
  }
  return getStripeRaw().webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/** Return available plans (public API). */
function getPlans() {
  return [{
    id:       'n3ware_pro',
    name:     'Pro',
    price:    2000,
    interval: 'month',
    features: ['Unlimited pages', 'Unlimited uploads', 'Live site hosting', 'Custom domain', 'Priority support'],
    limits:   { pages: Infinity, uploads: Infinity },
  }];
}

module.exports = {
  isMock,
  getStripeRaw,
  getOrCreatePrice,
  getOrCreateCustomer,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  getPlans,
};
