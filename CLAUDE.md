# n3ware — Visual Website Editor Platform

## 1. What n3ware Is

n3ware lets small business owners edit their own websites by clicking on them. One `<script>` tag turns any hosted page into an in-browser WYSIWYG editor: inline text editing, drag-and-drop layout, styling panels, nav management, theme controls, and one-click save back to cloud storage.

**Pre-launch / no live users.** The database was wiped clean in April 2026. There is no backwards-compatible legacy data to worry about.

---

## 2. Read These First

| Question | Go to |
|---|---|
| Where does a save go? | `src/api/pages.js` → `src/storage/gcs-files.js` |
| How does a page get served? | `assembler/assembler.go` → `assembler/main.go` |
| How does auth work? | `src/api/magic-auth.js` → `src/api/auth.js` |
| How does the editor load? | `public/n3ware.js` `_MODULES` array |
| How does theme work? | `public/n3ware-theme-persist.js` → `n3ware-theme-apply.js` → `n3ware-theme.js` |
| How does nav work? | `public/n3ware-nav-persist.js` → `n3ware-nav-render.js` → `n3ware-nav.js` |
| How to deploy? | Section 12 (Deploy Pipeline) — read the critical note |

---

## 3. Architecture

```
Browser
  │
  ├─ n3ware.com (Cloudflare proxied)
  │    └─ Cloud Run: n3ware (Node.js)
  │         ├─ /api/*          — REST API (auth, sites, pages, uploads, billing…)
  │         ├─ /sites/*        — proxies to assembler then injects trackers
  │         ├─ /dashboard.html — customer dashboard
  │         └─ /n3ware*.js     — editor scripts (static files)
  │
  └─ assembler.n3ware.com (Cloudflare proxied)
       └─ Cloud Run: n3ware-assembler (Go)
            └─ reads GCS → assembles HTML → serves with LRU cache
                          ↑
                  gs://n3ware-sites/{siteId}/
                    site.json          (manifest)
                    header.html
                    nav.html
                    footer.html
                    pages/index.html
                    pages/{slug}.html

Firestore
  ├─ sites/{siteId}     — metadata (name, ownerId, apiKey, subdomain…)
  ├─ users/{userId}     — accounts
  ├─ magic_tokens/{tok} — one-time auth tokens
  └─ domains/{domain}   — subdomain → siteId mapping

Secret Manager (project: n3ware / 196247551045)
  ├─ JWT_SECRET
  ├─ MASTER_API_KEY
  ├─ SENDGRID_API_KEY
  └─ CLOUDFLARE_API_TOKEN
```

---

## 4. Editor Module Map

`public/n3ware.js` is the core. It defines `N3Events`, `N3UI`, `N3History`, `N3Editor`, then runs `_loadModules()` which fetches these 16 scripts in order:

```js
const _MODULES = [
  'n3ware-icons.js',          // SVG icon registry
  'n3ware-text.js',           // inline text editing, drag-and-drop, element controls
  'n3ware-style.js',          // style panel + toolbar
  'n3ware-charts.js',         // N3Chart canvas charting
  'n3ware-analytics.js',      // analytics overlay + script placeholders
  'n3ware-components.js',     // component panel, cloud save, revisions
  'n3ware-theme-css.js',      // ← MISSING / planned
  'n3ware-theme-persist.js',  // DEFAULTS, FONTS, loadState, save to localStorage + API
  'n3ware-theme-apply.js',    // CSS vars, Tailwind config, font injection, typography
  'n3ware-theme-panel.js',    // ← MISSING / planned
  'n3ware-theme.js',          // theme orchestrator (init, open panel, apply, save)
  'n3ware-nav-persist.js',    // nav data localStorage + cloud save
  'n3ware-nav-render.js',     // renders <nav> with mobile drawer, _wireMobileNav
  'n3ware-nav-panel.js',      // ← MISSING / planned
  'n3ware-nav.js',            // nav orchestrator (init, open panel, save)
  'n3ware-sub-nav.js',        // IntersectionObserver scroll-spy sub-nav
];
```

Missing modules (`n3ware-theme-css.js`, `n3ware-theme-panel.js`, `n3ware-nav-panel.js`) are skipped gracefully with `console.warn`; the editor still loads.

**Design tokens** (in `n3ware.js`):
```js
const T = {
  accent:    '#E31337',
  accentDark:'#B91C2C',
  bgPanel:   '#111111',
  border:    '#2A2A2A',
  text:      '#E5E5E5',
  muted:     '#888888',
};
```

---

## 5. Data Models

### Site (Firestore `sites/{id}`)
```js
{
  id, name, ownerId, apiKey, subdomain,
  html,          // legacy / v1 only; not used for v2 GCS sites
  css,
  message,
  theme,         // nested — see Theme below
  integrations,  // { ga4, gtm, fb, … }
  updatedAt, createdAt
}
```

### GCS Manifest (`{siteId}/site.json`)
```json
{
  "id": "uuid",
  "name": "My Site",
  "ownerId": "uid or null",
  "apiKey": "hex64",
  "theme": {
    "colors":    { "primary": "#3B82F6", "secondary": "#8B5CF6", "accent": "#F59E0B" },
    "logoUrl":   null,
    "faviconUrl": null,
    "fonts":     { "heading": "system", "body": "system" },
    "sizes":     { "h1": 60, "h2": 48, "h3": 36, "h4": 28, "h5": 22, "h6": 18, "body": 16 }
  },
  "pages": [ { "slug": "index", "title": "Home", "path": "/" } ],
  "collections": [ { "slug": "team", "name": "Team Members", "entryCount": 3 } ],
  "headScripts": [],
  "bodyScripts": [],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### Collection Definition (`{siteId}/collections/{slug}.json`)
```json
{
  "id": "team",
  "name": "Team Members",
  "slug": "team",
  "fields": [
    { "key": "name",  "type": "text",   "label": "Name",  "required": true },
    { "key": "role",  "type": "text",   "label": "Role" },
    { "key": "order", "type": "number", "label": "Order" }
  ],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```
Valid field types: `text`, `richtext`, `image`, `url`, `number`, `date`, `boolean`, `select`.

### Collection Entry (`{siteId}/collections/{slug}/{entryId}.json`)
```json
{
  "id": "uuid",
  "collectionId": "team",
  "data": { "name": "Alice", "role": "Engineer", "order": 1 },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

No flat/legacy theme schema (`primaryColor`, `fontFamily`, `bg`, `fg`, `radius`). These were fully removed in April 2026.

### Nav (localStorage `n3_nav_{siteId}`)
```js
{
  links: [ { label, href, target? } ],
  logo: { text, href, show },
  cta:  { label, href, show },
}
```

### Theme (localStorage `n3_theme`)
```js
{
  colors:    { primary, secondary, accent },
  logoUrl:   string|null,
  faviconUrl: string|null,
  fonts:     { heading, body },
  sizes:     { h1, h2, h3, h4, h5, h6, body },
}
```

---

## 6. GCS Storage Layout

Bucket: `gs://n3ware-sites` (object versioning enabled — every save = new generation, enabling rollback)

```
{siteId}/
  site.json          manifest (see above)
  header.html        shared header HTML
  nav.html           shared nav HTML
  footer.html        shared footer HTML
  pages/
    index.html       home page body (no <html>/<head>/<body> tags — just content)
    {slug}.html      other page bodies
  collections/
    {slug}.json      collection definition (fields schema)
    {slug}/
      {entryId}.json individual entry data
```

The Go assembler reads all of these and assembles a full HTML document at request time.

---

## 7. API Routes

### Auth
| Method | Path | Description |
|---|---|---|
| POST | /api/auth/magic | Send magic link email |
| GET | /api/auth/verify | Validate magic token, issue JWT |
| GET | /api/auth/me | Get current user from JWT |
| POST | /api/auth/logout | Clear cookie |

### Sites
| Method | Path | Description |
|---|---|---|
| POST | /api/sites | Create site |
| GET | /api/sites | List sites (owner-filtered for JWT) |
| GET | /api/sites/:id | Get site metadata |
| DELETE | /api/sites/:id | Delete site |
| POST | /api/sites/:id/save | Legacy save (full HTML) |
| GET | /api/sites/:id/html | Get raw HTML |
| PUT | /api/sites/:id/theme | Save theme object |

### Pages (v2)
| Method | Path | Description |
|---|---|---|
| GET | /api/sites/:id/pages | List pages |
| POST | /api/sites/:id/pages | Create page |
| GET | /api/sites/:id/pages/:slug | Get page body |
| PUT | /api/sites/:id/pages/:slug | Save page body (primary save path) |
| DELETE | /api/sites/:id/pages/:slug | Delete page |
| GET | /api/sites/:id/pages/:slug/versions | List GCS versions |
| POST | /api/sites/:id/pages/:slug/rollback | Rollback to generation |
| GET | /api/sites/:id/components | Get shared components (header/nav/footer) |
| PUT | /api/sites/:id/components/:name | Save component |

### Other
| Method | Path | Description |
|---|---|---|
| GET/POST | /api/integrations | Tracker config |
| POST | /api/uploads | File upload to GCS |
| GET | /api/templates | List templates |
| GET | /api/analytics/* | Analytics data |
| GET | /api/migrate | Migrate/scrape external site |
| GET | /health | `{"status":"ok","ts":"ISO8601"}` (Node fingerprint) |

---

## 8. Auth Details

1. User enters email → `POST /api/auth/magic` → SendGrid sends magic link to `https://n3ware.com/api/auth/verify?token=X`
2. `GET /api/auth/verify?token=X` — validates one-time token in Firestore, finds/creates user, issues JWT
3. Sets `n3_token` cookie on `.n3ware.com` domain (7-day TTL, httpOnly, SameSite=Lax)
4. Redirects to `/dashboard#token=JWT`
5. Dashboard reads token from hash → `localStorage['n3_token']`
6. All API calls: JWT in `Authorization: Bearer <token>` header or `n3_token` cookie
7. `authOrApiKey` middleware accepts: JWT cookie, Bearer JWT, or `X-Api-Key` header
8. `MASTER_API_KEY` (from Secret Manager) allows all operations regardless of owner

---

## 9. Site Serving Flow

```
Browser → assembler.n3ware.com/sites/{siteId}/{path}
  Go assembler:
    1. Read {siteId}/site.json from GCS (LRU cached 30s)
    2. Resolve slug from path
    3. Read header.html, nav.html, footer.html, pages/{slug}.html (concurrently)
    4. Inject Tailwind CDN, CSS vars for theme, Tailwind config
    5. Inject n3ware.js with data-n3-site + data-n3-key
    6. Assemble full <html> document
    7. Return with Cache-Control: public, max-age=10, s-maxage=30, stale-while-revalidate=5

  Node serving middleware (src/serving/sites.js):
    - Proxies to assembler
    - Injects tracker scripts (GA4, GTM, FB pixel, etc.) before </head>
    - Returns 502 page if assembler is down (no fallback to Firestore HTML)
```

---

## 10. Save Flow

```
Editor (browser):
  1. User edits, clicks green Save FAB
  2. n3ware.js extracts body HTML from <main>, header from <header>, nav from <nav>
  3. PUT /api/sites/:id/pages/:slug  { html: bodyHtml }
  4. PUT /api/sites/:id/components/header  (if changed)
  5. PUT /api/sites/:id/components/nav     (if changed)

Node API:
  6. Sanitizes HTML (sanitize-html, generous allowlist)
  7. Writes to GCS
  8. Updates Firestore metadata (updatedAt, etc.)
  9. Purges assembler in-memory cache via HTTP POST to assembler /purge/:id
  10. Purges Cloudflare CDN cache

Browser:
  11. On success, reloads page with ?v={timestamp} to bypass CDN cache
```

---

## 11. Slide-in Panel Pattern

All editor panels (theme, nav, components, etc.) use this exact open sequence:

```js
function open() {
  panel.classList.remove('n3-panel-open');
  panel.style.removeProperty('transform');
  void panel.offsetHeight;              // force reflow
  setTimeout(() => {                   // setTimeout(0) — must NOT be rAF
    panel.classList.add('n3-panel-open');
    panel.style.setProperty('transform', 'translateX(0)', 'important');
  }, 0);
}
```

The CSS:
```css
.n3-panel { transform: translateX(110%); transition: transform 0.3s ease; }
.n3-panel-open { transform: translateX(0) !important; }
```

**Do not use `requestAnimationFrame` here** — it races on some browsers and the slide-in doesn't trigger. `setTimeout(0)` is correct.

---

## 12. Tailwind CDN JIT Gotchas

The assembler injects `<script src="https://cdn.tailwindcss.com">` and a `tailwind.config = {...}` block. In editor context, `n3ware-theme-apply.js` calls `tailwind.refresh()` after DOM insertions.

Rules:
- Call `tailwind.refresh()` after inserting new DOM nodes that use Tailwind classes
- Do NOT call `tailwind.refresh()` immediately after writing `tailwind.config =` — this races the internal Tailwind rebuild and produces double-rebuild issues
- Set config first, wait for Tailwind's own rebuild, then refresh if needed
- Classes added by JavaScript (e.g., panel open/close) must be in the initial HTML or safelisted in config

---

## 13. Nav System

Two nav types coexist:

**Primary nav** (`data-n3-primary-nav` attribute):
- Full site nav: logo, links, CTA button, mobile hamburger drawer
- Managed by `n3ware-nav-persist.js` + `n3ware-nav-render.js` + `n3ware-nav.js`
- Stored in localStorage + synced to `{siteId}/nav.html` in GCS via component save

**Sub-nav** (`data-n3-sub-nav` attribute):
- In-page scroll-spy nav (highlights active section as user scrolls)
- Managed by `n3ware-sub-nav.js` using `IntersectionObserver`
- Auto-discovers `<section id="...">` elements on the page

---

## 14. Deploy Pipeline

### CRITICAL: Assembler deploy must use `--source=assembler`

```bash
# ✅ CORRECT — deploys Go binary
gcloud run deploy n3ware-assembler \
  --source=assembler \
  --region=us-east1 \
  --project=n3ware

# ❌ WRONG — deploys Node.js binary to the Go service (Node Dockerfile picked up from repo root)
gcloud run deploy n3ware-assembler \
  --source=. \
  --region=us-east1 \
  --project=n3ware
```

This has happened twice. If `assembler.n3ware.com/health` returns `{"status":"ok","ts":"..."}` with a timestamp, you deployed the wrong binary. Go assembler returns `{"status":"ok"}` with no `ts` field.

### Node.js service
```bash
gcloud run deploy n3ware \
  --source=. \
  --region=us-east1 \
  --project=n3ware
```

### After any deploy
```bash
# Purge Cloudflare cache (get zone ID + token from Secret Manager)
curl -X POST "https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer {CF_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

### Verify correct binaries are serving
```bash
curl https://n3ware.com/health
# → {"status":"ok","ts":"2026-..."}   ← Node (correct)

curl https://assembler.n3ware.com/health
# → {"status":"ok"}                   ← Go (correct, no ts field)
```

---

## 15. Domain & DNS

| Domain | DNS | Points to |
|---|---|---|
| n3ware.com | A/CNAME (Cloudflare proxied) | Cloud Run: n3ware (Node) |
| www.n3ware.com | CNAME → n3ware.com (proxied) | same |
| assembler.n3ware.com | CNAME → ghs.googlehosted.com (proxied) | Cloud Run: n3ware-assembler (Go) |
| {slug}.n3ware.com | wildcard → assembler (proxied) | customer sites |

Cloud Run domain mappings: `gcloud beta run domain-mappings list --region us-east1`

`assembler.n3ware.com` has `CertificateProvisioned: True` — SSL is managed by Cloud Run, fronted by Cloudflare.

---

## 16. Secrets

All sensitive values are in GCP Secret Manager (project: `n3ware`). The Cloud Run services access them at runtime via mounted env vars.

| Secret | Used by | Notes |
|---|---|---|
| JWT_SECRET | Node | Signs/verifies n3_token JWTs |
| MASTER_API_KEY | Node | Admin API access |
| SENDGRID_API_KEY | Node | Magic link emails |
| CLOUDFLARE_API_TOKEN | Node | Cache purge, DNS |
| CLOUDFLARE_ZONE_ID | Node | Cache purge |

Do not put secrets in `.env` files committed to git. Use `.env.local` (gitignored) for local dev.

---

## 17. Environment Variables

| Variable | Values | Notes |
|---|---|---|
| NODE_ENV | development \| production | |
| STORAGE_BACKEND | local \| firestore | `local` uses JSON files in `.data/` |
| GOOGLE_CLOUD_PROJECT | n3ware | |
| GCS_BUCKET | n3ware-sites | Enables GCS site storage |
| GCS_SITES_BUCKET | n3ware-sites | Used by gcs-files.js |
| ASSEMBLER_URL | https://assembler.n3ware.com | Node → assembler proxy |
| JWT_SECRET | — | From Secret Manager in prod |
| MASTER_API_KEY | — | From Secret Manager in prod |
| SENDGRID_API_KEY | — | |
| CLOUDFLARE_API_TOKEN | — | |
| PORT | 8080 | Cloud Run default |

---

## 18. Common Tasks

```bash
# Run tests
node tests/run-tests.js
MASTER_API_KEY=test JWT_SECRET=test node tests/api.test.js

# Send magic link
curl -X POST https://n3ware.com/api/auth/magic \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com"}'

# Create site (admin)
curl -X POST https://n3ware.com/api/sites \
  -H 'X-Api-Key: MASTER_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Site","html":"<h1>Hello</h1>"}'

# List GCS objects for a site
gsutil ls -r gs://n3ware-sites/{siteId}/

# Check assembler health
curl https://assembler.n3ware.com/health

# Purge assembler cache for a site
curl -X POST https://assembler.n3ware.com/purge/{siteId}

# List Cloud Run domain mappings
gcloud beta run domain-mappings list --region us-east1
```

---

## 19. Known Issues & Hard-Learned Lessons

### Never use `requestAnimationFrame` for panel slide-in
`rAF` races on some browsers. `setTimeout(0)` is the correct approach. See Section 11.

### Always use `--source=assembler` for assembler deploy
See Section 12. Has caused two bad deploys. The Node Dockerfile at repo root gets picked up if you use `--source=.`.

### `gsutil -m rm` hangs on macOS
macOS multiprocessing bug. Use Python GCS REST API with `gcloud auth print-access-token` instead.

### Tailwind `tailwind.refresh()` after config change races
Set `tailwind.config` first, let Tailwind rebuild internally, then call `tailwind.refresh()` if needed for new DOM. Don't call both in sequence immediately.

### No legacy theme schema
Flat legacy properties (`primaryColor`, `fontFamily`, `bg`, `fg`, `radius`) were fully removed in April 2026. The only valid schema is nested: `{ colors: {primary,secondary,accent}, fonts: {heading,body}, sizes: {h1..body}, logoUrl, faviconUrl }`.

### Auth: JWT is in both cookie and localStorage
`n3_token` cookie set on `.n3ware.com` (editor reads it). Dashboard also stores it in `localStorage['n3_token']`. Both are maintained.

### Go assembler does not fall back to Firestore HTML
`src/serving/sites.js` returns a 502 error page if the assembler is unreachable. There is no fallback. If the assembler is down, sites are down.

### Worktrees are not main
Any code deployed from a worktree that wasn't committed to main is orphaned when the worktree is deleted. Always commit before deploying.

---

## 20. File Map (Quick Reference)

### Server (Node.js)
- `server.js` — Express app, mounts all routes
- `src/config.js` — environment config
- `src/api/auth.js` — JWT/API key middleware
- `src/api/magic-auth.js` — magic link auth
- `src/api/sites.js` — site CRUD + theme PUT
- `src/api/pages.js` — multi-page management, component save, rollback
- `src/api/collections.js` — collections + entries CRUD (GCS-only)
- `src/api/templates.js` — template listing/serving
- `src/api/components.js` — Tailwind component library API
- `src/api/integrations-config.js` — tracker script config
- `src/api/billing.js` — Stripe (mock)
- `src/api/domains.js` — domain management (mock)
- `src/api/uploads.js` — file upload to GCS
- `src/api/analytics-routes.js` — analytics API
- `src/api/migrate.js` — website migration/scraper
- `src/serving/sites.js` — site serving middleware (proxies to assembler)

### Storage
- `src/storage/index.js` — factory (local or Firestore)
- `src/storage/local.js` — JSON file storage for dev
- `src/storage/firestore.js` — Firestore (prod)
- `src/storage/users.js` — user storage
- `src/storage/gcs-files.js` — GCS file operations (createSite, savePage, saveComponent, updateManifest, rollback, listCollections, saveEntry, etc.)

### Cache
- `src/cache/index.js` — cache manager
- `src/cache/memory.js` — LRU memory cache
- `src/cache/cdn.js` — Cloudflare CDN purge

### Integrations
- `src/integrations/tracker-scripts.js` — 13 tracking providers (GA4, GTM, FB, etc.)
- `src/integrations/email.js` — SendGrid/Postmark
- `src/integrations/cloudflare.js` — DNS/CDN
- `src/integrations/analytics.js` — built-in analytics
- `src/integrations/storage-cloud.js` — GCS/R2 uploads
- `src/integrations/migrator.js` — AI migration

### Frontend (Editor modules)
- `public/n3ware.js` — core: N3Events, N3UI, N3History, N3Editor, _loadModules
- `public/n3ware-text.js` — text editing, drag-and-drop
- `public/n3ware-style.js` — style panel, toolbar, export
- `public/n3ware-charts.js` — N3Chart canvas charts
- `public/n3ware-analytics.js` — analytics overlay
- `public/n3ware-components.js` — component panel, cloud save, revisions
- `public/n3ware-theme-persist.js` — DEFAULTS, FONTS, loadState, save
- `public/n3ware-theme-apply.js` — CSS vars, Tailwind config, font injection
- `public/n3ware-theme.js` — theme orchestrator
- `public/n3ware-nav-persist.js` — nav data localStorage + cloud save
- `public/n3ware-nav-render.js` — renders `<nav>` with mobile drawer
- `public/n3ware-nav.js` — nav orchestrator
- `public/n3ware-sub-nav.js` — IntersectionObserver scroll-spy

### Frontend (Pages)
- `public/index.html` — landing page
- `public/dashboard.html` — customer dashboard
- `public/demo.html` — editor demo
- `public/components.html` — component browser
- `public/brand.html` — brand guidelines

### Go Assembler
- `assembler/main.go` — HTTP server, routing, health + purge endpoints
- `assembler/assembler.go` — HTML assembly from GCS parts, CSS var injection, collection loading
- `assembler/storage.go` — GCS client with caching, ListFiles helper
- `assembler/template.go` — Handlebars-style template processor ({{#each}}, {{#if}}, {{site.*}})
- `assembler/cache.go` — in-memory LRU
- `assembler/domain.go` — domain → siteId resolution via Firestore
- `assembler/Dockerfile` — Cloud Run image

### Tests
- `tests/run-tests.js` — smoke tests (76 assertions)
- `tests/api.test.js` — API endpoint tests (63 assertions)
- `tests/auth-flow.test.js` — magic link + CRUD tests (80 assertions)
- `tests/save-flow.test.js` — save pipeline tests (21 assertions)
- `tests/collections.test.js` — collections + entries API tests (GCS-dependent CRUD)
- `tests/n3ware.test.html` — browser-based editor tests

---

## 21. Shared Marketing Partials

These HTML blocks are copy-pasted verbatim across multiple pages (no build step). When copy changes, update **all** copies listed below.

### Convert-or-launch module
Two-card section: Card A = domain input → `/demo.html?url=<encoded>`, Card B = "Start free →" `/dashboard`. Inline `<script>` uses `document.currentScript.previousElementSibling` for scoping.

Appears on **9 pages**:
- `public/index.html` (before `<!-- Templates Showcase -->`)
- `public/features.html` (before `<!-- CTA section -->`)
- `public/brand.html` (before `<!-- FOOTER -->`) — uses `n3-` CSS var classes
- `public/components.html` (before `<!-- ─── JavaScript -->`)
- `public/vs-agency.html` (before `<!-- Final CTA -->`)
- `public/vs-wix.html` (before `<!-- Final CTA -->`)
- `public/vs-squarespace.html` (before `<!-- Final CTA -->`)
- `public/vs-weebly.html` (before `<!-- Final CTA -->`)
- `public/vs-godaddy.html` (before `<!-- Final CTA -->`)

### Bring-your-own-domain callout
Red-background `<section>` with domain input and "Connect your domain →" CTA.

Appears on **6 pages**: `index.html`, `features.html`, `vs-agency.html`, `vs-wix.html`, `vs-squarespace.html`, `vs-weebly.html` (search for `<!-- Any domain callout -->` or `bg-[#E31337]` domain section).

### No-developer-required module
Dark card: "No developer. No designer. No excuses." with 3-bullet checklist.

Appears on **6 pages**: `index.html`, `features.html`, `vs-agency.html`, `vs-wix.html`, `vs-squarespace.html`, `vs-godaddy.html`.

### ROI calculator
Interactive `<div class="n3-roi-calc ...">` with `data-default-cost` attribute. Inputs: current monthly cost, extras toggle (+$15), years. Output: their total vs n3ware total, savings in red, equiv phrase. Edge case: if current < $20 and no extras → "Already cheaper". Canonical n3ware price = **$20/mo**.

Appears on **6 pages** (with different `data-default-cost`):
- `public/vs-agency.html` — `data-default-cost="400"`
- `public/vs-wix.html` — `data-default-cost="17"`
- `public/vs-squarespace.html` — `data-default-cost="23"`
- `public/vs-weebly.html` — `data-default-cost="10"`
- `public/vs-godaddy.html` — `data-default-cost="11"`
- `public/index.html` — `data-default-cost="50"`

---

## 22. Penetration test suite

**Location:** `tests/penetration.test.js`
**Run:** `node tests/penetration.test.js` or `npm run pentest`
**Override target:** `BASE_URL=http://localhost:8080 node tests/penetration.test.js`

Exercises every API route with missing, bogus, expired, and wrong-secret credentials. Also tests NoSQL/SQL injection payloads in path params and request bodies, oversized bodies (11MB), and method override mismatches. Does NOT mutate data — auth failures are expected and the suite verifies them.

**Skipped routes** (deliberately excluded):
- `POST /api/domains/register` — could accidentally purchase a domain
- `POST /api/billing/webhook` — raw-body Stripe endpoint, not worth probing
- Wrong-owner isolation test (case 7) — requires two real authenticated sessions, must be done manually

**This suite is NOT part of the normal dev loop.** Do not run it on every session or include it in CI. It is an on-demand check before major launches or after any auth-boundary changes. Future AI sessions: you do not need to read or run this file unless explicitly asked to verify auth security.

---

## 23. Repeatable Content (Collections)

Phase 1 backend implementation only. No editor UI yet.

### What it is
CMS-style collections (e.g. "Team Members", "Blog Posts") with typed field schemas and individual entries. Stored in GCS. The Go assembler renders `{{#each slug}}...{{/each}}` blocks in page HTML at request time using a lightweight Handlebars-style template processor.

### Collection definition
```json
{
  "id": "team",
  "name": "Team Members",
  "slug": "team",
  "fields": [
    { "key": "name",  "type": "text",   "label": "Name",  "required": true },
    { "key": "role",  "type": "text",   "label": "Role" },
    { "key": "order", "type": "number", "label": "Order" }
  ],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```
Valid field types: `text`, `richtext`, `image`, `url`, `number`, `date`, `boolean`, `select`.

### Entry
```json
{
  "id": "uuid",
  "collectionId": "team",
  "data": { "name": "Alice", "role": "Engineer", "order": 1 },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### GCS layout for collections
```
{siteId}/collections/{slug}.json               — collection definition
{siteId}/collections/{slug}/{entryId}.json     — individual entry
```

### API routes (all require auth, GCS must be enabled)
| Method | Path | Description |
|---|---|---|
| GET | /api/sites/:id/collections | List collection definitions |
| POST | /api/sites/:id/collections | Create collection |
| GET | /api/sites/:id/collections/:slug | Get collection |
| PUT | /api/sites/:id/collections/:slug | Update collection (name, fields) |
| DELETE | /api/sites/:id/collections/:slug | Delete collection + all its entries |
| GET | /api/sites/:id/collections/:slug/entries | List entries (supports ?sort=field:dir&limit=N) |
| POST | /api/sites/:id/collections/:slug/entries | Create entry |
| GET | /api/sites/:id/collections/:slug/entries/:id | Get entry |
| PUT | /api/sites/:id/collections/:slug/entries/:id | Update entry (data is merged) |
| DELETE | /api/sites/:id/collections/:slug/entries/:id | Delete entry |

### Template syntax (in page HTML)
```html
{{#each team}}
  <div>
    <h3>{{this.name}}</h3>
    <p>{{this.role}}</p>
    {{#if this.featured}}<span>Featured</span>{{/if}}
    {{#if this.featured}}<span>VIP</span>{{else}}<span>Standard</span>{{/if}}
    {{{this.bio}}}  <!-- triple braces = unescaped HTML -->
  </div>
{{/each}}

{{#each team limit=3 sort="order:asc"}}...{{/each}}

{{team.count}} team members

<title>{{site.name}}</title>
<meta name="color" content="{{site.theme.colors.primary}}">
```

### Free vs Pro limits
| Limit | Free | Pro |
|---|---|---|
| Collections per site | 2 | Unlimited |
| Entries per collection | 10 | Unlimited |

### Implementation files
- `src/api/collections.js` — router, mounted at `/api/sites/:siteId/collections`
- `src/storage/gcs-files.js` — listCollections, getCollection, saveCollection, deleteCollection, listEntries, getEntry, saveEntry, deleteEntry
- `assembler/template.go` — ProcessTemplate(), supports {{#each}}, {{#if}}/{{else}}, {{this.*}}, {{site.*}}, {{{triple}}}
- `assembler/assembler.go` — findReferencedCollections(), loadCollectionEntries(), integration into assemble()
- `assembler/storage.go` — GCSClient.ListFiles() for enumerating entry objects
- `assembler/template_test.go` — 12 Go unit tests (all pass)
- `tests/collections.test.js` — Node integration tests (6 auth/routing assertions pass; CRUD requires GCS)
