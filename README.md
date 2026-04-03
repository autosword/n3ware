# n3ware

Drop-in JavaScript visual editor + cloud backend. Add one `<script>` tag and your users can edit any page in-browser and publish changes instantly.

---

## Features

- **Visual editing** — click any element to edit text, drag to reorder, style via sidebar
- **Undo / redo** — full snapshot-based history
- **One-line integration** — single `<script>` tag, zero dependencies
- **n3ware Cloud** — REST API to persist, version, and serve pages
- **Revision history** — every save creates a revision; roll back any time
- **CDN-aware** — Cloudflare or GCP cache purge on publish
- **Deployable** — Docker + Cloud Run ready out of the box

---

## Quick start

### Local dev

```bash
npm install
node server.js
```

Open `http://localhost:3000`. The demo page is at `/demo`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `development` or `production` |
| `STORAGE_BACKEND` | `local` | `local` or `firestore` |
| `DATA_DIR` | `./data` | Local JSON storage root |
| `MASTER_API_KEY` | *(required)* | API key for all `/api/*` routes |
| `GCP_PROJECT` | — | GCP project ID (Firestore) |
| `CDN_PROVIDER` | `none` | `cloudflare`, `gcp`, or `none` |
| `CLOUDFLARE_ZONE_ID` | — | Cloudflare zone ID |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare API token |
| `GCP_BACKEND_NAME` | — | GCP backend service name (CDN purge) |
| `CACHE_MAX_SIZE` | `500` | In-memory LRU cache size |
| `CACHE_TTL_MS` | `300000` | Cache TTL (5 min) |
| `N3WARE_SCRIPT_URL` | `/n3ware.js` | Injected script URL |

---

## API

All API routes require `X-API-Key` header (or `?apiKey` query param).

### Sites

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites` | List all sites (no HTML) |
| `POST` | `/api/sites` | Create site `{ html, message? }` |
| `GET` | `/api/sites/:id` | Get site with HTML |
| `GET` | `/api/sites/:id/html` | Get raw HTML only |
| `POST` | `/api/sites/:id/save` | Save new revision `{ html, message? }` |
| `DELETE` | `/api/sites/:id` | Delete site + all revisions |

### Revisions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites/:id/revisions` | List revisions (newest first) |
| `GET` | `/api/sites/:id/revisions/:revId` | Get single revision |
| `POST` | `/api/sites/:id/revisions/:revId/rollback` | Restore revision |

### Serving

Published sites are served at `/sites/:siteId` with the n3ware editor automatically injected before `</body>`.

### Other

| Path | Description |
|---|---|
| `GET /health` | Health check |
| `GET /api/cache/stats` | LRU cache stats (requires `MASTER_API_KEY`) |

---

## Embedding

```html
<script
  src="https://your-domain.com/n3ware.js"
  data-n3-site="my-site-id"
  data-n3-api="https://your-domain.com/api"
  data-n3-key="YOUR_API_KEY"
></script>
```

| Attribute | Description |
|---|---|
| `data-n3-site` | Site ID to save/load |
| `data-n3-api` | API base URL |
| `data-n3-key` | API key (omit if serving via `/sites/:id`) |

The editor toolbar appears in the bottom-right corner. Use **Publish** to push changes to the cloud.

---

## Architecture

```
n3ware.js  (client)
  N3Events          — pub/sub event bus
  N3UI              — CSS injection + DOM factories
  N3History         — snapshot undo/redo stack
  N3Export          — HTML cleanup, diff, download
  N3TextEditor      — contentEditable + formatting toolbar
  N3DragManager     — drag-and-drop reorder
  N3ElementControls — hover overlays + selection
  N3StylePanel      — right-side style panel
  N3Toolbar         — top toolbar (edit/preview/export/publish)
  N3Cloud           — REST API integration (save/revisions/rollback)
  N3RevisionsPanel  — slide-out revisions history panel
  N3Editor          — orchestrator / public API

server.js  (Node/Express)
  src/config.js          — env config
  src/api/auth.js        — API key middleware
  src/api/sites.js       — sites CRUD router
  src/api/revisions.js   — revisions router
  src/serving/sites.js   — site serving + editor injection
  src/storage/local.js   — JSON file storage
  src/storage/firestore.js — Firestore storage
  src/cache/memory.js    — LRU memory cache
  src/cache/cdn.js       — CDN cache purge
  src/cache/index.js     — cache coordinator
```

---

## Deployment

### Docker

```bash
docker build -t n3ware .
docker run -e MASTER_API_KEY=secret -p 8080:8080 n3ware
```

### Google Cloud Run

1. Set up a Cloud Build trigger pointing at this repo
2. Grant the Cloud Build SA: `roles/run.admin`, `roles/iam.serviceAccountUser`, `roles/artifactregistry.writer`
3. Add substitution variables or accept defaults (`_SERVICE=n3ware`, `_REGION=us-east1`)
4. Push — Cloud Build handles build → push → deploy

For Firestore storage, set `STORAGE_BACKEND=firestore` and ensure the Cloud Run SA has `roles/datastore.user`.

---

## Tests

```bash
# Browser tests (open in browser)
open http://localhost:3000/tests

# Node smoke tests
node tests/run-tests.js

# API integration tests
MASTER_API_KEY=test node tests/api.test.js
```

---

## License

MIT
