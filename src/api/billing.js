'use strict';

/**
 * Billing API routes — Stripe $20/mo subscription per site.
 *
 * POST /api/billing/checkout           — create Stripe Checkout session (JWT required)
 * POST /api/billing/portal             — create Stripe Billing Portal session (JWT required)
 * GET  /api/billing/subscription/:id   — get site subscription (JWT required)
 * GET  /api/billing/                   — list plans (public)
 * POST /api/billing/webhook            — Stripe webhook (raw body, no auth)
 */

const express  = require('express');
const storage  = require('../storage');
const users    = require('../storage/users');
const stripe   = require('../integrations/stripe');
const { verifyToken } = require('./auth');

const router = express.Router();

const FREE_SUBSCRIPTION = {
  status:               'none',
  plan:                 'free',
  stripeCustomerId:     null,
  stripeSubscriptionId: null,
  currentPeriodEnd:     null,
  limits:               { pages: 4, uploads: 5, collections: 2, entriesPerCollection: 10 },
};

const PRO_LIMITS = { pages: Infinity, uploads: Infinity, collections: Infinity, entriesPerCollection: Infinity };

// ── GET / — list plans (public) ───────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({ plans: stripe.getPlans() });
});

// ── POST /checkout — create checkout session (JWT required) ───────────────────
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const { siteId, successUrl, cancelUrl } = req.body || {};
    if (!siteId) return res.status(400).json({ error: '`siteId` is required' });

    const site = await storage.getSite(siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.ownerId && site.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await users.getUserById(req.user.id);
    const customerEmail      = user?.email || req.user.email || req.user.sub;
    const existingCustomerId = site.subscription?.stripeCustomerId || null;

    const session = await stripe.createCheckoutSession({
      siteId,
      userId:           req.user.id,
      customerEmail,
      stripeCustomerId: existingCustomerId,
      successUrl:       successUrl || 'https://n3ware.com/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl:        cancelUrl  || 'https://n3ware.com/dashboard',
    });

    // Persist customerId to site so we can open the portal later
    if (session.customerId && session.customerId !== existingCustomerId) {
      await storage.updateSiteFields(siteId, {
        subscription: { ...FREE_SUBSCRIPTION, ...(site.subscription || {}), stripeCustomerId: session.customerId },
      });
    }

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[billing/checkout]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /portal — billing portal session (JWT required) ──────────────────────
router.post('/portal', verifyToken, async (req, res) => {
  try {
    const { siteId, returnUrl } = req.body || {};
    if (!siteId) return res.status(400).json({ error: '`siteId` is required' });

    const site = await storage.getSite(siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.ownerId && site.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const customerId = site.subscription?.stripeCustomerId;
    if (!customerId) {
      return res.status(400).json({ error: 'No Stripe customer found — subscribe first' });
    }

    const session = await stripe.createPortalSession(customerId, returnUrl || 'https://n3ware.com/dashboard');
    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/portal]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /subscription/:siteId — site subscription status ─────────────────────
router.get('/subscription/:siteId', verifyToken, async (req, res) => {
  try {
    const site = await storage.getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.ownerId && site.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ subscription: site.subscription || FREE_SUBSCRIPTION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /webhook — Stripe webhook (raw body, no auth) ────────────────────────
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'] || '';
    let event;
    try {
      event = stripe.constructWebhookEvent(req.body, signature);
    } catch (err) {
      console.error('[billing/webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    try {
      await _handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error('[billing/webhook] Handler error:', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Stripe event handler ──────────────────────────────────────────────────────

async function _handleStripeEvent(event) {
  switch (event.type) {

    case 'checkout.session.completed': {
      const session  = event.data.object;
      const siteId   = session.metadata?.siteId;
      const subId    = session.subscription;
      const customer = session.customer;
      if (!siteId) { console.warn('[billing] checkout.session.completed: missing siteId in metadata'); return; }

      let periodEnd = null;
      if (subId && !stripe.isMock) {
        try {
          const sub = await stripe.getStripeRaw().subscriptions.retrieve(subId);
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        } catch (_) {}
      }

      await storage.updateSiteFields(siteId, {
        subscription: {
          status:               'active',
          plan:                 'pro',
          stripeCustomerId:     customer || null,
          stripeSubscriptionId: subId    || null,
          currentPeriodEnd:     periodEnd,
          limits:               PRO_LIMITS,
        },
      });
      console.log(`[billing] Site ${siteId} activated → pro`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub    = event.data.object;
      const siteId = sub.metadata?.siteId;
      if (!siteId) { console.warn('[billing] subscription.updated: missing siteId in metadata'); return; }

      const isPro     = sub.status === 'active' || sub.status === 'trialing';
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      await storage.updateSiteFields(siteId, {
        subscription: {
          status:               sub.status,
          plan:                 isPro ? 'pro' : 'free',
          stripeCustomerId:     sub.customer    || null,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd:     periodEnd,
          limits:               isPro ? PRO_LIMITS : { pages: 4, uploads: 5 },
          cancelAtPeriodEnd:    sub.cancel_at_period_end || false,
        },
      });
      console.log(`[billing] Site ${siteId} subscription updated → ${sub.status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub    = event.data.object;
      const siteId = sub.metadata?.siteId;
      if (!siteId) { console.warn('[billing] subscription.deleted: missing siteId in metadata'); return; }

      await storage.updateSiteFields(siteId, {
        subscription: {
          status:               'canceled',
          plan:                 'free',
          stripeCustomerId:     sub.customer || null,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd:     null,
          limits:               { pages: 4, uploads: 5 },
        },
      });
      console.log(`[billing] Site ${siteId} canceled → free`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subId   = invoice.subscription;
      if (!subId || stripe.isMock) return;
      try {
        const sub    = await stripe.getStripeRaw().subscriptions.retrieve(subId);
        const siteId = sub.metadata?.siteId;
        if (!siteId) return;
        await storage.updateSiteFields(siteId, { subscription: { status: 'past_due' } });
        console.log(`[billing] Site ${siteId} payment failed → past_due`);
      } catch (_) {}
      break;
    }

    default:
      console.log(`[billing/webhook] Unhandled event: ${event.type}`);
  }
}

module.exports = router;
