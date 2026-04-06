# n3ware

Visual website editor platform. One `<script>` tag turns any hosted page into an in-browser WYSIWYG editor: inline text editing, drag-and-drop layout, component placement, theme controls, nav management, CMS collections, and one-click save to cloud storage.

**Stack:** Node.js (Express) · Go assembler · Google Cloud Run · Firestore · GCS · Cloudflare

See **`CLAUDE.md`** for the full architecture, module map, data models, deploy pipeline, and all known gotchas.

---

## Quick start (local dev)

```bash
npm install
STORAGE_BACKEND=local JWT_SECRET=dev MASTER_API_KEY=dev node server.js
# → http://localhost:8080
```

---

## Testing

### Standard suite

All tests run against a local server with mock/local storage. No GCS, Firestore, or real secrets required.

```bash
# API endpoint tests
MASTER_API_KEY=test JWT_SECRET=test NODE_ENV=test node tests/api.test.js

# Comprehensive route coverage
MASTER_API_KEY=test JWT_SECRET=test NODE_ENV=test node tests/comprehensive.test.js

# Save pipeline (local storage backend, port 8099)
STORAGE_BACKEND=local MASTER_API_KEY=test JWT_SECRET=test PORT=8099 NODE_ENV=test node tests/save-flow.test.js

# Auth flow (local storage backend, port 8099)
STORAGE_BACKEND=local JWT_SECRET=test MASTER_API_KEY=test PORT=8099 NODE_ENV=test node tests/auth-flow.test.js

# Domain management
MASTER_API_KEY=test JWT_SECRET=test NODE_ENV=test node tests/domains.test.js

# Rate limiting
node tests/rate-limit.test.js

# Smoke tests
node tests/run-tests.js

# Collections CRUD (full assertions require GCS_BUCKET env var)
MASTER_API_KEY=test JWT_SECRET=test NODE_ENV=test node tests/collections.test.js

# Media management
MASTER_API_KEY=test JWT_SECRET=test NODE_ENV=test node tests/media.test.js
```

- `STORAGE_BACKEND=local` uses JSON file storage under `.data/` (no GCS or Firestore)
- `MASTER_API_KEY=test` and `JWT_SECRET=test` are test-only values
- Tests marked `[SKIP: GCS]` require `GCS_BUCKET` and are skipped in local dev

### Test count

| Suite | Checks |
|---|---|
| `api.test.js` | 63 |
| `comprehensive.test.js` | 67 |
| `save-flow.test.js` | 21 |
| `auth-flow.test.js` | 80 |
| `domains.test.js` | 23 |
| `rate-limit.test.js` | 9 |
| `run-tests.js` | 76 |
| `collections.test.js` | ~6 |
| `media.test.js` | ~6 |
| `penetration.test.js` | 637 |
| **Total** | **~1000** |

### Go assembler tests

```bash
cd assembler && /opt/homebrew/bin/go test ./... -v
```

12 unit tests for the Handlebars-style template processor (`{{#each}}`, `{{#if}}`, `{{this.field}}`, `{{site.*}}`, `{{slug.count}}`).

---

### Visual QA

Uses Claude in Chrome MCP to open the live site, authenticate, and exercise every editor feature interactively.

**QA login endpoint** — bypasses email, creates a real auth session directly:

```
GET https://n3ware.com/api/auth/_qa_login?secret=n3qa2026&email=randy@zesty.io
```

Navigate to this URL in Chrome. It creates a real magic token in Firestore, redirects to `/api/auth/verify`, sets the `n3_token` cookie server-side, and lands on `/dashboard`. No email required.

> **Remove or rotate this secret before production launch.** See `CLAUDE.md §25`.

**Visual QA covers:**
- Editor loading (22 modules in `_MODULES`)
- FAB pills: Save, Components, Theme, Nav, Content, Media
- Component placement + AI Customize (images sent as base64 to Claude)
- Theme panel: colors, typography, border radius, logo/favicon upload
- Nav editor: links, logo, CTA button, mobile drawer preview
- Image replace modal (click any `<img>` in the editor)
- Content/Collections panel: create collection (AI or presets), add entries, live preview
- Media manager: upload, browse, insert, delete
- Test mode: iframe device preview (mobile/tablet/desktop)
- Save roundtrip: edit → save → reload → verify persistence
- Billing dashboard: usage counters (pages/uploads), plan status, Stripe checkout

---

### Penetration testing

Run before major launches or after any auth-boundary change. **Not part of the normal dev loop.**

```bash
# Against production
BASE_URL=https://n3ware.com node tests/penetration.test.js

# Against local
BASE_URL=http://localhost:8080 node tests/penetration.test.js
```

637 checks across every API route: no credentials, bogus/expired/wrong-secret JWT, bogus API key, NoSQL/SQL injection payloads in path params and bodies, 11MB oversized bodies, method mismatches, rate limit verification.

**Deliberately excluded:**
- `POST /api/domains/register` — could purchase a real domain
- `POST /api/billing/webhook` — raw-body Stripe endpoint
- Wrong-owner cross-site isolation — requires two real auth sessions, must be done manually

---

## Deploy

**Critical:** always use `--source=assembler` for the Go service. Using `--source=.` deploys the Node.js Dockerfile instead. This has happened twice.

```bash
# Go assembler
gcloud run deploy n3ware-assembler --source=assembler --region=us-east1 --project=n3ware

# Node service
gcloud run deploy n3ware --source=. --region=us-east1 --project=n3ware
```

After any deploy, purge Cloudflare cache (zone ID + token in Secret Manager).

See `CLAUDE.md §12` for the full deploy pipeline and verification steps.

---

## Key file map

| Question | File |
|---|---|
| Save flow | `src/api/pages.js` → `src/storage/gcs-files.js` |
| Auth | `src/api/magic-auth.js` → `src/api/auth.js` |
| Editor modules | `public/n3ware.js` (`_MODULES` array, 22 entries) |
| Assembler entry | `assembler/assembler.go` + `assembler/main.go` |
| Template processor | `assembler/template.go` |
| Theme | `n3ware-theme-persist.js` → `n3ware-theme-apply.js` → `n3ware-theme.js` |
| Nav | `n3ware-nav-persist.js` → `n3ware-nav-render.js` → `n3ware-nav.js` |
| Collections UI | `n3ware-content-panel.js` → `n3ware-content.js` |
| Collections API | `src/api/collections.js` + `src/storage/gcs-files.js` |
| Billing | `src/api/billing.js` (Stripe) |
| Media | `public/n3ware-media.js` + `src/api/media.js` |
| Image replace | `public/n3ware-image.js` |

Full file map: `CLAUDE.md §20`.
