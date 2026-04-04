# n3ware v2 Architecture

## Overview

v1 stored entire site HTML as a single blob in Firestore. This worked for single-page sites but hit several limits: Firestore documents cap at 1 MB, there was no page-level versioning, multi-page sites required client-side routing hacks, and shared components (header/nav/footer) were duplicated across every save.

v2 moves site content to Google Cloud Storage with versioning enabled, introduces a Go assembly engine for high-throughput serving, and adds native multi-page support with a shared component system.

---

## Storage Layout

```
gs://n3ware-sites/                         ← versioning ON, public read
  {siteId}/
    site.json                              ← manifest (pages, theme, integrations)
    header.html                            ← shared header component
    nav.html                               ← shared nav component
    footer.html                            ← shared footer component
    pages/
      index.html                           ← home page body (<main> content only)
      about.html
      contact.html
      {slug}.html
```

Firestore retains:
- `sites/{siteId}` — metadata (name, ownerId, createdAt, updatedAt)
- `domains/{host}` — domain → siteId mapping
- `sites/{siteId}/revisions/*` — v1 legacy revisions (preserved during migration)

---

## site.json Manifest Schema

```json
{
  "id": "dc37ffb9-32f6-4e33-9ef1-637e04bdc37a",
  "name": "Apex Solutions",
  "ownerId": "user-uuid-or-null",
  "theme": {
    "primaryColor": "#3B82F6",
    "fontFamily": "Inter"
  },
  "pages": [
    { "slug": "index",   "title": "Home",    "path": "/" },
    { "slug": "about",   "title": "About",   "path": "/about" },
    { "slug": "contact", "title": "Contact", "path": "/contact" }
  ],
  "headScripts": [
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">"
  ],
  "bodyScripts": [
    "<script src=\"https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX\"></script>"
  ],
  "createdAt": "2026-04-04T13:00:00.000Z",
  "updatedAt": "2026-04-04T14:30:00.000Z"
}
```

---

## Page Assembly Flow

```
Request: GET https://apex.n3ware.com/about

1. Go assembler receives request
2. Extract host → DomainResolver.Resolve(ctx, "apex.n3ware.com")
   a. Check Firestore domains/apex.n3ware.com → siteId
   b. Fallback: strip .n3ware.com suffix → treat as siteId
3. Check LRU cache: key = "{siteId}::/about"  →  MISS
4. Read gs://n3ware-sites/{siteId}/site.json  →  SiteManifest
5. Find page with path "/about"               →  slug = "about"
6. Read in parallel:
   - gs://{siteId}/header.html
   - gs://{siteId}/nav.html
   - gs://{siteId}/footer.html
   - gs://{siteId}/pages/about.html
7. Assemble full HTML document (see below)
8. Store in LRU cache (TTL 60s)
9. Return with Cache-Control: public, s-maxage=300, stale-while-revalidate=60
```

### Assembled Document Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{pageTitle} — {siteName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = { theme: { extend: {
      colors: { primary: '#3B82F6' },
      fontFamily: { sans: ['Inter', 'sans-serif'] }
    }}}
  </script>
  {headScripts from manifest}
</head>
<body>
  {header.html}
  {nav.html}
  <main>
    {pages/{slug}.html}
  </main>
  {footer.html}
  {bodyScripts from manifest}
</body>
</html>
```

---

## Script Injection Strategy

| Script | Source | Where injected |
|--------|--------|----------------|
| Tailwind CDN | Hardcoded | `<head>` — always present |
| Tailwind config | Built from `theme` in site.json | `<head>` — only if theme set |
| Custom head scripts | `headScripts[]` in site.json | `<head>` — after Tailwind |
| Analytics (GA, etc) | `bodyScripts[]` in site.json | Before `</body>` |
| n3ware.js editor | Node serving middleware | Before `</body>` — only on `/sites/` route |

The Go assembler does **not** inject n3ware.js — that is only injected by the Node serving layer at `/sites/:siteId`. This keeps the assembly engine free of editor concerns.

---

## Caching Layers

```
Browser
  ↓  (cached by browser up to max-age)
Cloudflare CDN
  ↓  Cache-Control: public, s-maxage=300, stale-while-revalidate=60
Go Assembler (LRU)
  ↓  100 entries, 60s TTL, evicts LRU
GCS
  ↓  object reads (header, nav, footer, page body, site.json)
```

Cache invalidation:
- Node API calls `cache.onSave(siteId)` after any write → purges Cloudflare zone
- Go LRU expires naturally at 60s TTL
- GCS has no cache (reads are always fresh)

---

## GCS Versioning for Rollback

Every write to GCS creates a new **generation** (object version). The bucket has uniform versioning enabled. To roll back a page:

1. `GET /api/sites/:id/pages/:slug/versions` → lists all generations with timestamps
2. `POST /api/sites/:id/pages/:slug/rollback` with `{ generation: "1234567890" }` → reads that generation, writes it as the new current version (creating yet another generation)

This means rollback is non-destructive — the history is never deleted.

---

## Domain Resolution

The Go assembler resolves incoming hostnames in this order:

1. **Firestore exact match**: `domains/{host}.siteId`
2. **Subdomain pattern**: `{anything}.n3ware.com` → `anything` is treated as the `siteId`
3. **Not found** → 404

Custom domains are registered via `POST /api/domains` which writes to Firestore `domains/{host}`.

---

## Multi-Page Management

Pages are managed via the Node API and stored as discrete HTML files in GCS. The `site.json` manifest is the source of truth for the page list — the assembler reads it on every request (with LRU caching).

### Slug rules
- Slugs are lowercased and sanitized to `[a-z0-9-]`
- `index` always maps to `/`
- All other slugs map to `/{slug}`
- Custom paths can be set by editing the manifest directly

### Adding a page
```
POST /api/sites/:id/pages
{ "slug": "about", "title": "About Us", "html": "<p>...</p>" }
```
Creates `pages/about.html` in GCS and appends `{ slug, title, path }` to the manifest.

---

## Component System

Three shared components — `header`, `nav`, `footer` — are stored as separate GCS objects and assembled around the page body on every request. Editing one component instantly affects every page of the site.

```
PUT /api/sites/:id/components/header
{ "html": "<header class=\"...\">...</header>" }
```

On site creation from a template, the template HTML is **decomposed**: the `<header>`, `<nav>`, and `<footer>` elements are extracted into separate files, and the remainder becomes `pages/index.html`.

---

## Go Assembler Architecture

```
assembler/
  main.go        — HTTP server, routing, env config
  assembler.go   — Assembly logic + SiteManifest type
  storage.go     — GCS client wrapper
  cache.go       — Thread-safe LRU cache (container/list)
  domain.go      — Firestore client + DomainResolver
  Dockerfile     — Multi-stage build (golang:1.22-alpine → alpine:3.19)
  go.mod         — Module: github.com/autosword/n3ware/assembler
```

Dependencies:
- `cloud.google.com/go/storage` — GCS reads
- `cloud.google.com/go/firestore` — domain lookups
- `google.golang.org/api` — shared Google API transport
- Standard library only for everything else (no LRU library needed — uses `container/list`)

The assembler is stateless — all state is in GCS/Firestore or the in-process LRU cache. It can scale horizontally with Cloud Run's autoscaling.

---

## Node API Endpoints

### Existing (v1, unchanged)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sites` | Create site (Firestore blob) |
| GET | `/api/sites` | List sites |
| GET | `/api/sites/:id` | Get site metadata |
| POST | `/api/sites/:id/save` | Save full HTML |
| DELETE | `/api/sites/:id` | Delete site |

### New (v2 — `src/api/pages.js`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sites/:id/pages` | List pages from manifest |
| POST | `/api/sites/:id/pages` | Add new page |
| PUT | `/api/sites/:id/pages/:slug` | Save page HTML |
| DELETE | `/api/sites/:id/pages/:slug` | Remove page |
| GET | `/api/sites/:id/pages/:slug/versions` | List GCS versions |
| POST | `/api/sites/:id/pages/:slug/rollback` | Rollback to version |
| GET | `/api/sites/:id/components/:name` | Get component |
| PUT | `/api/sites/:id/components/:name` | Save component |
| GET | `/api/sites/:id/manifest` | Get site.json |
| PATCH | `/api/sites/:id/manifest` | Update theme/scripts |

---

## Migration Plan (v1 → v2)

### Phase 1 — Parallel operation (current)
- v1 sites continue to be served by the Node serving middleware from Firestore blobs
- v2 APIs are available but not yet wired into the editor
- GCS bucket is live and accepting writes

### Phase 2 — Editor integration
- Editor sends `PUT /api/sites/:id/pages/index` instead of `POST /api/sites/:id/save`
- On first v2 save, `gcsFiles.createSite()` is called to initialize the GCS layout
- Firestore metadata record continues to exist (ownerId, createdAt, etc.)

### Phase 3 — Assembler serving
- Deploy Go assembler as a second Cloud Run service
- Route subdomain requests (*.n3ware.com) to the assembler via Cloud Run traffic splitting or a load balancer rule
- Node `/sites/:id` route is deprecated; assembler takes over

### Phase 4 — Cleanup
- Remove Firestore HTML blob storage (keep metadata)
- Remove Node serving middleware
- Remove v1 `POST /api/sites/:id/save` endpoint (or keep as a shim that calls gcsFiles)

### Data migration script
```bash
# For each existing site in Firestore:
#   1. Read site.html from Firestore
#   2. Call gcsFiles.createSite(siteId, name, ownerId, html)
#   3. Mark site as migrated in Firestore
node scripts/migrate-to-v2.js
```

---

## Local Development

```bash
# Node API (port 8080)
npm run dev

# Go assembler (requires Go 1.22+)
cd assembler
go run .
# Listens on port 8081

# Environment variables for local assembler
export GOOGLE_CLOUD_PROJECT=n3ware
export GCS_BUCKET=n3ware-sites
export PORT=8081
```

The Go assembler uses Application Default Credentials — run `gcloud auth application-default login` once.

---

## Deployment

### Node API (existing Cloud Run service)
```bash
gcloud run deploy n3ware \
  --source=. \
  --region=us-east1 \
  --project=n3ware \
  --set-env-vars="NODE_ENV=production,STORAGE_BACKEND=firestore,GOOGLE_CLOUD_PROJECT=n3ware,GCS_SITES_BUCKET=n3ware-sites,..."
```

### Go Assembler (new Cloud Run service)
```bash
gcloud run deploy n3ware-assembler \
  --source=assembler/ \
  --region=us-east1 \
  --project=n3ware \
  --allow-unauthenticated \
  --memory=256Mi \
  --max-instances=20 \
  --concurrency=1000 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=n3ware,GCS_BUCKET=n3ware-sites"
```

The Go assembler is intentionally over-provisioned for concurrency (1000 per instance) — Go goroutines are lightweight and GCS reads are highly parallelizable.

---

## Performance Characteristics

| Layer | Typical latency |
|-------|----------------|
| Cloudflare CDN hit | ~5ms |
| Go LRU cache hit | <1ms |
| Go + GCS (5 parallel reads) | ~40–80ms |
| Go + GCS (cold start) | ~200ms |
| Node + Firestore (v1) | ~80–150ms |

GCS reads are the primary cost for cache misses. Reading 5 objects in parallel (site.json + header + nav + footer + page body) takes roughly the same time as reading 1 (dominated by round-trip latency, not throughput). With the 60s LRU TTL and 300s Cloudflare CDN TTL, the typical site serves from Cloudflare or Go memory — GCS is rarely the hot path.
