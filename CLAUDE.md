# n3ware — Visual Website Editor Platform

## What This Is
n3ware is a visual website editor that lets small business owners edit their sites by clicking on them. One script tag enables inline text editing, drag-and-drop layout, and styling.

## Architecture (v2)
- **Node.js API** (`server.js`) — auth, site CRUD, dashboard, templates, integrations
- **Go Assembler** (`assembler/`) — reads site files from GCS, assembles HTML, serves pages fast
- **GCS** (`gs://n3ware-sites`) — stores site files with object versioning for rollback
- **Firestore** — user accounts, site metadata, domain mappings, magic tokens
- **Cloudflare** — DNS, CDN, cache purge, SSL for n3ware.com
- **Cloud Run** — hosts both services, scales to zero

## Key URLs
- n3ware.com — main site + dashboard + API
- assembler.n3ware.com — Go assembler serving customer sites
- GCP Project: n3ware (196247551045)

## File Map

### Server (Node.js)
- `server.js` — Express app, mounts all routes, middleware
- `src/config.js` — environment-based config
- `src/api/sites.js` — site CRUD (POST/GET/PUT/DELETE /api/sites)
- `src/api/pages.js` — multi-page management (/api/sites/:id/pages/:slug)
- `src/api/magic-auth.js` — magic link authentication (no passwords)
- `src/api/auth.js` — JWT/API key middleware, verifyToken, authOrApiKey
- `src/api/templates.js` — template listing/serving
- `src/api/components.js` — Tailwind component library API
- `src/api/integrations-config.js` — tracking script management
- `src/api/billing.js` — Stripe billing (mock)
- `src/api/domains.js` — domain management (mock)
- `src/api/uploads.js` — file upload
- `src/api/analytics-routes.js` — analytics API
- `src/api/ga.js` — Google Analytics integration
- `src/api/migrate.js` — website migration/scraper

### Storage
- `src/storage/index.js` — factory (local or firestore)
- `src/storage/local.js` — JSON file storage for dev
- `src/storage/firestore.js` — Firestore for production
- `src/storage/users.js` — user storage (local JSON, wraps FirestoreUserStore in prod)
- `src/storage/gcs-files.js` — GCS file storage for site content

### Integrations
- `src/integrations/index.js` — integration manager
- `src/integrations/email.js` — SendGrid/Postmark
- `src/integrations/cloudflare.js` — DNS/CDN
- `src/integrations/stripe.js` — billing
- `src/integrations/analytics.js` — built-in analytics
- `src/integrations/storage-cloud.js` — GCS/R2 uploads
- `src/integrations/google-analytics.js` — GA4
- `src/integrations/tracker-scripts.js` — 13 tracking providers
- `src/integrations/scraper.js` — page scraper
- `src/integrations/migrator.js` — AI migration

### Cache
- `src/cache/index.js` — cache manager
- `src/cache/memory.js` — LRU memory cache
- `src/cache/cdn.js` — CDN cache purge

### Frontend (Editor)
- `public/n3ware.js` — core editor (N3Events, N3UI, N3History, N3Editor + module loader)
- `public/n3ware-text.js` — text editing, drag-and-drop, element controls
- `public/n3ware-style.js` — style panel, toolbar, export
- `public/n3ware-charts.js` — N3Chart canvas charting library
- `public/n3ware-analytics.js` — analytics overlay + script placeholders
- `public/n3ware-components.js` — component panel, cloud save, revisions

### Frontend (Pages)
- `public/index.html` — landing page
- `public/dashboard.html` — customer dashboard (login, sites, settings)
- `public/demo.html` — editor demo
- `public/components.html` — component browser
- `public/brand.html` — brand guidelines
- `public/privacy.html` — privacy policy
- `public/terms.html` — terms of service
- `public/chart-demo.html` — chart library demo

### Go Assembler
- `assembler/main.go` — HTTP server, routing
- `assembler/assembler.go` — HTML page assembly from GCS parts
- `assembler/storage.go` — GCS read with caching
- `assembler/cache.go` — in-memory LRU
- `assembler/domain.go` — domain resolution
- `assembler/Dockerfile` — Cloud Run image

### Tests
- `tests/run-tests.js` — smoke tests (76 assertions)
- `tests/api.test.js` — API endpoint tests (63 assertions)
- `tests/auth-flow.test.js` — magic link + CRUD tests (80 assertions)
- `tests/save-flow.test.js` — save pipeline tests (21 assertions)
- `tests/n3ware.test.html` — browser-based editor tests

## Auth Flow
1. User enters email → POST /api/auth/magic → SendGrid sends magic link
2. Click link → GET /api/auth/verify?token=X → validates token, finds/creates user in Firestore
3. Sets cookie `n3_token` on `.n3ware.com` + redirects to /dashboard#token=JWT
4. Dashboard reads token from hash → localStorage
5. Editor reads JWT from cookie for saves

## Site Serving Flow
1. Browser hits assembler.n3ware.com/sites/:id
2. Go assembler reads site.json from GCS
3. Reads header.html, nav.html, pages/index.html, footer.html
4. Assembles full HTML with Tailwind + scripts
5. Returns with Cache-Control headers

## Save Flow
1. User edits in browser → clicks green Save FAB
2. n3ware.js extracts changed content by region (main body vs header/footer)
3. PUT /api/sites/:id/pages/:slug with JWT cookie
4. Node writes to GCS + Firestore
5. Purges assembler cache + Cloudflare CDN
6. Page auto-reloads with cache-busting param

## Environment Variables
See .env.example for full list. Key ones:
- NODE_ENV, STORAGE_BACKEND (local|firestore)
- GOOGLE_CLOUD_PROJECT, GCS_BUCKET
- JWT_SECRET, MASTER_API_KEY (in Secret Manager)
- SENDGRID_API_KEY, CLOUDFLARE_API_TOKEN (in Secret Manager)

## Deployment
- Node: `gcloud run deploy n3ware --source=. --region=us-east1 --project=n3ware`
- Go: `gcloud run deploy n3ware-assembler --source=assembler/ --region=us-east1 --project=n3ware`
- Purge cache after: `curl -X POST cloudflare.com/.../purge_cache`

## Common Tasks
- Send magic link: `curl -X POST https://n3ware.com/api/auth/magic -H 'Content-Type: application/json' -d '{"email":"user@example.com"}'`
- Create site: `curl -X POST https://n3ware.com/api/sites -H 'X-API-Key: MASTER' -H 'Content-Type: application/json' -d '{"name":"Site","html":"...","ownerId":"..."}'`
- Run tests: `node tests/run-tests.js && MASTER_API_KEY=test JWT_SECRET=test node tests/api.test.js`
