'use strict';

/**
 * Billing API routes — Stripe plans, checkout, subscriptions, and webhooks.
 *
 * GET  /api/billing/          — list plans (public)
 * POST /api/billing/checkout  — create Stripe checkout session (JWT required)
 * GET  /api/billing/subscription — get user's current subscription (JWT required)
 * POST /api/billing/cancel    — cancel user's subscription (JWT required)
 * POST /api/billing/webhook   — Stripe webhook (no auth, raw body)
 */

const express  = require('express');
const stripe   = require('../integrations/stripe');
const users    = require('../storage/users');
const { verifyToken, authOrApiKey } = require('./auth'); // eslint-disable-line no-unused-vars

const router = express.Router();

// ---------------------------------------------------------------------------
// GET / — list available plans (public, no auth)
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const plans = stripe.getPlans();
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /checkout — create Stripe Checkout session
// ---------------------------------------------------------------------------
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const { planId, successUrl, cancelUrl } = req.body || {};
    if (!planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    const user          = users.getUserById(req.user.id);
    const customerEmail = user ? user.email : req.user.email;

    const session = await stripe.createCheckoutSession(
      planId,
      successUrl || 'https://n3ware.com/billing/success',
      cancelUrl  || 'https://n3ware.com/billing/cancel',
      customerEmail
    );

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /subscription — get current user's subscription
// ---------------------------------------------------------------------------
router.get('/subscription', verifyToken, async (req, res) => {
  try {
    const user = users.getUserById(req.user.id);
    if (!user || !user.subscriptionId) {
      return res.json({ subscription: null });
    }

    const subscription = await stripe.getSubscription(user.subscriptionId);
    res.json({ subscription });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /cancel — cancel current user's subscription
// ---------------------------------------------------------------------------
router.post('/cancel', verifyToken, async (req, res) => {
  try {
    const user = users.getUserById(req.user.id);
    if (!user || !user.subscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const result = await stripe.cancelSubscription(user.subscriptionId);

    // TODO: persist subscriptionId / status change to user record
    // e.g. users.updateUser(req.user.id, { subscriptionStatus: 'canceled' });

    res.json({ subscription: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /webhook — Stripe webhook (raw body required, no auth)
// ---------------------------------------------------------------------------
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'] || '';

    try {
      const event = await stripe.handleWebhook(req.body, signature);

      // Handle relevant event types
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          // TODO: update user's subscriptionId + plan in storage
          console.log(`[billing/webhook] Subscription event: ${event.type}`);
          break;
        }
        case 'customer.subscription.deleted': {
          // TODO: mark user subscription as canceled in storage
          console.log('[billing/webhook] Subscription canceled');
          break;
        }
        case 'checkout.session.completed': {
          // TODO: link Stripe customer to n3ware user record
          console.log('[billing/webhook] Checkout completed');
          break;
        }
        default:
          console.log(`[billing/webhook] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[billing/webhook] Error:', err.message);
      res.status(400).json({ error: err.message });
    }
  }
);

module.exports = router;
