# n3ware Security & Data Architecture

This document is for developers and operators. It describes where data lives, how authentication works, secrets management, and the data flow for the two most critical operations: saving a site and serving a page view.

---

## Data Architecture

### Where data lives

| Data type | Local (dev) | Production |
|-----------|-------------|------------|
| User accounts | `data/users.json` | Firestore `users` collection |
| Site metadata + HTML | `data/sites/{id}.json` | Firestore `sites` collection |
| Site revisions | `data/sites/{id}/revisions/` (JSON files) | Firestore `sites/{id}/revisions` subcollection |
| Uploaded media files | `data/uploads/{siteId}/` | Google Cloud Storage `n3ware-uploads` bucket |
| Analytics events | `data/analytics.json` | Firestore `analytics` collection (or GA4 if connected) |
| Email send logs | `data/emails.json` | Sent via SendGrid; logs retained 30 days |
| Billing / subscription data | N/A (Stripe mock) | Stripe — we **never** store card numbers |
| Domain / DNS records | `data/domains.json` | Cloudflare API — we store zone IDs and record IDs locally |
| Google OAuth tokens (GA4) | `data/ga-tokens.json` | Firestore `ga_tokens` collection |

### Key storage abstractions

```
src/storage/
  local.js      — JSON file-based storage (dev)
  firestore.js  — Firestore implementation (prod)
  index.js      — Exports active backend based on STORAGE_BACKEND env var

src/cache/
  memory.js     — In-process LRU cache (all environments)
  cdn.js        — Cloudflare Cache-Control / purge (prod)
  index.js      — Combined cache layer
```

Storage backend is selected by `STORAGE_BACKEND` env var:
- `local` (default in dev) → flat JSON files in `data/`
- `firestore` → Google Cloud Firestore

---

## Authentication Flow

### Registration
1. User submits `POST /api/auth/register` with `{ email, password }`
2. Password hashed with **bcrypt** (12 rounds)
3. User record `{ id, email, passwordHash, createdAt }` written to storage
4. JWT issued (see below) and returned

### Login
1. User submits `POST /api/auth/login` with `{ email, password }`
2. `bcrypt.compare(password, storedHash)` — constant-time comparison
3. On success: JWT issued, returned in response body
4. Client stores JWT in `localStorage` (dashboard SPA)

### JWT Details
- Signed with `JWT_SECRET` (HS256)
- Payload: `{ userId, email, iat, exp }`
- **Expiry: 7 days**
- No refresh token mechanism — users re-authenticate after expiry

### API Authorization (two methods)
1. **Bearer token**: `Authorization: Bearer <jwt>` — validates JWT
2. **API key**: `X-API-Key: <key>` — compares against stored key

**Master API key** (`MASTER_API_KEY`) grants full admin access to all sites and internal endpoints (e.g., `/api/cache/stats`). Store with extreme care.

### Google OAuth (GA4 only)
- OAuth flow at `GET /api/ga/auth` → redirects to Google consent
- Callback at `GET /api/ga/callback` stores refresh token in `data/ga-tokens.json` (dev) or Firestore (prod)
- Used exclusively for fetching GA4 analytics on behalf of the user
- Not used for general authentication

---

## Secrets Management

### Development
All secrets in `.env` (gitignored). Copy `.env.example` to `.env` and fill in values.

### Production (Google Cloud Run)
Secrets are stored in **Google Secret Manager** and injected as environment variables at container startup via `--set-secrets` in Cloud Run configuration. The server loads them in `src/secrets.js` before `app.listen()`.

### Secret inventory

| Secret name | Environment variable | Purpose |
|-------------|---------------------|---------|
| `n3ware-jwt-secret` | `JWT_SECRET` | Sign/verify JWTs |
| `n3ware-master-api-key` | `MASTER_API_KEY` | Admin API access |
| `n3ware-stripe-secret` | `STRIPE_SECRET_KEY` | Stripe API (charges, subscriptions) |
| `n3ware-stripe-webhook` | `STRIPE_WEBHOOK_SECRET` | Verify Stripe webhook signatures |
| `n3ware-sendgrid-key` | `SENDGRID_API_KEY` | Transactional email |
| `n3ware-anthropic-key` | `ANTHROPIC_API_KEY` | AI migration feature |
| `n3ware-cloudflare-token` | `CLOUDFLARE_API_TOKEN` | DNS management, CDN cache purge |
| `n3ware-gcs-keyfile` | `GCS_KEYFILE` | Google Cloud Storage (file uploads) |

### Rotating a secret
1. Generate new secret value
2. Update in Google Secret Manager: `gcloud secrets versions add n3ware-<name> --data-file=-`
3. Redeploy Cloud Run service (picks up new version automatically on next deploy, or force: `gcloud run services update n3ware --region=... --set-secrets=...`)
4. For JWT rotation: existing tokens remain valid until expiry (7 days); force re-auth if needed by invalidating old tokens in a deny-list or by bumping a `tokenVersion` field in user records

---

## Data Flow: Saving a Site

```
Browser (n3ware.js editor)
  │
  │  1. User edits page in browser — all edits are client-side DOM mutations
  │     n3ware.js collects the live DOM HTML from the page's <body>
  │
  ▼
POST /api/sites/:id/save
  { html: "<full page html>", name: "Site Name", message: "Saved at 2:00pm" }
  Authorization: Bearer <jwt>  OR  X-API-Key: <key>
  │
  │  2. Server authenticates request (JWT or API key)
  │  3. HTML sanitized via sanitize-html library
  │     (strips <script> tags, on* event handlers, dangerous protocols)
  │  4. Previous current version saved as a new revision in Firestore
  │     revisions/{id} = { html, createdAt, message, size }
  │  5. New HTML written to Firestore sites/{id} document
  │  6. In-memory LRU cache invalidated for this site ID
  │  7. Cloudflare CDN cache purged for the site's public URL
  │
  ▼
Response: { success: true, revisionId, publishedAt }
```

### Sanitization policy
`sanitize-html` is configured to:
- Strip `<script>` and `<iframe>` tags entirely
- Remove all `on*` event handler attributes
- Remove `javascript:` and `data:` URI schemes from `href`/`src`
- Allow a broad set of HTML elements and safe attributes (style, class, id, data-*)
- Allow inline `<style>` blocks (required for page styling)

---

## Data Flow: Page View (Site Serving)

```
Visitor browser
  │
  │  GET https://n3ware.com/sites/{siteId}
  │
  ▼
Cloudflare CDN edge
  │
  ├── Cache HIT (TTL < 5 min): serve from edge, no backend hit
  │
  └── Cache MISS ──►  Cloud Run (n3ware server)
                            │
                            │  src/serving/sites.js
                            │
                            ├── Check in-memory LRU cache
                            │     HIT: return cached HTML
                            │
                            └── Cache MISS ──► Firestore lookup
                                    │
                                    │  sites/{siteId}.html
                                    │
                                    ▼
                              Inject n3ware.js embed (if data-n3-* attrs)
                              Set Cache-Control: public, max-age=300
                              Return HTML to Cloudflare → visitor
                              │
                              └── Fire-and-forget analytics:
                                    POST /api/sites/:id/track
                                    (IP, User-Agent, path, timestamp)
```

---

## Third-Party Data Sharing

| Service | What we share | Purpose | PCI/GDPR notes |
|---------|--------------|---------|----------------|
| **Stripe** | Email, name, subscription metadata | Payment processing | PCI DSS Level 1 — we never see card numbers |
| **SendGrid** | Email addresses | Transactional email only | EU data processing addendum available |
| **Cloudflare** | Domain names, DNS records | CDN + DNS management | GDPR compliant |
| **Google Analytics** | Anonymized page views (if customer connects GA4) | Customer analytics dashboard | Customer-controlled; anonymization at collection |
| **Anthropic** | Page HTML (migration feature only) | AI-powered HTML cleanup | Not stored for training per Anthropic data policy |

We **do not** sell or share personal data for advertising purposes.

---

## Security Headers

Currently implemented:
- `CORS`: restricted to `*` in dev, `false` (same-origin only) in production
- Stripe webhook: raw body parser, signature verified via `stripe.webhooks.constructEvent()`
- Input sanitization on all user-provided HTML before storage

**Recommended for production (not yet implemented):**
```js
// Add helmet.js
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  }
}));

// Add rate limiting
const rateLimit = require('express-rate-limit');
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 200 }));
```

---

## Incident Response

**To report a security vulnerability:**
- Email: [security@n3ware.com](mailto:security@n3ware.com)
- Please include: description of the vulnerability, steps to reproduce, potential impact
- We aim to acknowledge reports within 48 hours and resolve critical issues within 7 days
- We do not currently offer a bug bounty program but will credit responsible disclosures

**For active incidents:**
1. Revoke the affected secret in Google Secret Manager immediately
2. Force-redeploy Cloud Run to pick up the new secret
3. If user data is affected, notify affected users within 72 hours per GDPR requirements
4. Document the incident in a post-mortem

---

*Last updated: April 2026*
