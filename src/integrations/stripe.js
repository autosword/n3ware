'use strict';

/**
 * Stripe billing integration.
 *
 * Mock mode: STRIPE_SECRET_KEY not set — returns fake Stripe-formatted responses.
 * Real mode: Uses stripe npm package with STRIPE_SECRET_KEY.
 *
 * Plans:
 *   n3ware_starter — $29/mo: 1 site, basic editor
 *   n3ware_pro     — $79/mo: 5 sites, all features, priority support
 *   n3ware_agency  — $199/mo: unlimited sites, white-label, API access
 */

const PLANS = {
  starter: {
    id:       'n3ware_starter',
    name:     'Starter',
    price:    2900,
    interval: 'month',
    features: ['1 site', 'Basic editor', 'Community support', '1 GB storage'],
    limits:   { sites: 1 },
  },
  pro: {
    id:       'n3ware_pro',
    name:     'Pro',
    price:    7900,
    interval: 'month',
    features: ['5 sites', 'All features', 'Priority support', '10 GB storage', 'Custom domains'],
    limits:   { sites: 5 },
  },
  agency: {
    id:       'n3ware_agency',
    name:     'Agency',
    price:    19900,
    interval: 'month',
    features: ['Unlimited sites', 'White-label', 'API access', '100 GB storage', 'Dedicated support'],
    limits:   { sites: Infinity },
  },
};

const isMock = !process.env.STRIPE_SECRET_KEY;

let _stripe = null;
let _mockNoticeLogged = false;

function getStripe() {
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
 * Create a Stripe customer.
 * @param {string} email
 * @param {string} name
 * @returns {Promise<{ id, email, name, created }>}
 */
async function createCustomer(email, name) {
  if (isMock) {
    _mockNotice();
    return {
      id:      _mockId('cus'),
      email,
      name:    name || '',
      created: Math.floor(Date.now() / 1000),
    };
  }
  const customer = await getStripe().customers.create({ email, name });
  return { id: customer.id, email: customer.email, name: customer.name, created: customer.created };
}

/**
 * Create a subscription for a customer.
 * @param {string} customerId
 * @param {string} planId  — one of the PLANS[x].id values
 * @returns {Promise<{ id, status, planId, currentPeriodEnd }>}
 */
async function createSubscription(customerId, planId) {
  if (isMock) {
    _mockNotice();
    return {
      id:               _mockId('sub'),
      status:           'active',
      planId,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    };
  }
  const sub = await getStripe().subscriptions.create({
    customer: customerId,
    items:    [{ price: planId }],
  });
  return {
    id:               sub.id,
    status:           sub.status,
    planId:           sub.items.data[0]?.price.id || planId,
    currentPeriodEnd: sub.current_period_end,
  };
}

/**
 * Cancel a subscription immediately.
 * @param {string} subscriptionId
 * @returns {Promise<{ id, status }>}
 */
async function cancelSubscription(subscriptionId) {
  if (isMock) {
    _mockNotice();
    return { id: subscriptionId, status: 'canceled' };
  }
  const sub = await getStripe().subscriptions.cancel(subscriptionId);
  return { id: sub.id, status: sub.status };
}

/**
 * Retrieve a subscription by ID.
 * @param {string} subscriptionId
 * @returns {Promise<{ id, status, planId, currentPeriodEnd, cancelAtPeriodEnd }>}
 */
async function getSubscription(subscriptionId) {
  if (isMock) {
    _mockNotice();
    return {
      id:                 subscriptionId,
      status:             'active',
      planId:             'n3ware_starter',
      currentPeriodEnd:   Math.floor(Date.now() / 1000) + 20 * 24 * 3600,
      cancelAtPeriodEnd:  false,
    };
  }
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  return {
    id:                sub.id,
    status:            sub.status,
    planId:            sub.items.data[0]?.price.id || '',
    currentPeriodEnd:  sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

/**
 * Create a Stripe Checkout session.
 * @param {string} planId
 * @param {string} successUrl
 * @param {string} cancelUrl
 * @param {string} customerEmail
 * @returns {Promise<{ id, url }>}
 */
async function createCheckoutSession(planId, successUrl, cancelUrl, customerEmail) {
  if (isMock) {
    _mockNotice();
    const sessionId = _mockId('cs');
    return {
      id:  sessionId,
      url: `/billing/success?session=${sessionId}`,
    };
  }
  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode:                 'subscription',
    customer_email:       customerEmail || undefined,
    line_items: [
      { price: planId, quantity: 1 },
    ],
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });
  return { id: session.id, url: session.url };
}

/**
 * Handle a Stripe webhook event.
 * @param {Buffer|string} rawBody
 * @param {string}        signature   Stripe-Signature header value
 * @returns {Promise<{ type, data }>}
 */
async function handleWebhook(rawBody, signature) {
  if (isMock) {
    _mockNotice();
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const event = JSON.parse(body);
    return { type: event.type || 'mock.event', data: event.data || {} };
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for webhook verification');
  }
  const event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  return { type: event.type, data: event.data };
}

/**
 * Return all available plans as an array.
 * @returns {Array}
 */
function getPlans() {
  return Object.values(PLANS);
}

module.exports = {
  PLANS,
  createCustomer,
  createSubscription,
  cancelSubscription,
  getSubscription,
  createCheckoutSession,
  handleWebhook,
  getPlans,
};
