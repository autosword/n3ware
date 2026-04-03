# n3ware Cloud

Visual webpage editor + hosted platform. Drop `n3ware.js` on any page to enable editing. Deploy to Google Cloud Run for a fully hosted service where saves publish live with cache invalidation.

## Quick start (local)

```bash
npm install
API_KEY=your-secret node server.js
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | — | Set to `production` to default to Firestore |
| `API_KEY` | `dev-key-change-in-prod` | Master API key for admin operations |
| `STORAGE_BACKEND` | `local` | `local` or `firestore` |
| `DATA_DIR` | `./data/sites` | Local storage directory (local backend only) |
| `PUBLIC_URL` | — | Public base URL injected into served sites |
| `CDN_PROVIDER` | — | `cloudflare` or `gcp` |
| `CF_ZONE_ID` | — | Cloudflare zone ID |
| `CF_API_TOKEN` | — | Cloudflare API token with Cache Purge permission |
| `GCP_PROJECT` | — | GCP project ID |
| `GCP_BACKEND_SERVICE` | — | Cloud CDN backend service name |
| `FIRESTORE_PROJECT` | `GCP_PROJECT` | Firestore project (if different from GCP_PROJECT) |

## API reference

All write endpoints require authentication via `X-API-Key` header or `?api_key=` query param.

### Sites

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/sites` | Master key | Create site → returns `{ siteId, apiKey }` |
| `GET` | `/api/sites/:id` | Site or master key | Get site metadata |
| `PUT` | `/api/sites/:id` | Site or master key | Update metadata |
| `DELETE` | `/api/sites/:id` | Master key | Delete site + revisions |
| `POST` | `/api/sites/:id/save` | Site or master key | **Save HTML**, create revision, invalidate cache |
| `GET` | `/api/sites/:id/html` | Public | Get current HTML (cached) |

### Revisions

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/sites/:id/revisions` | Site or master key | List revisions (newest first) |
| `GET` | `/api/sites/:id/revisions/:revId` | Site or master key | Get specific revision |
| `POST` | `/api/sites/:id/revisions/:revId/rollback` | Site or master key | Rollback + cache invalidation |

### Hosted sites

`GET /sites/:siteId` — serves the site HTML with n3ware.js injected for in-place editing.

## Creating a site

```bash
# Create
curl -X POST http://localhost:3000/api/sites \
  -H "X-API-Key: your-master-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Site"}'
# → {"siteId":"<uuid>","apiKey":"<uuid>"}

# Save HTML
curl -X POST http://localhost:3000/api/sites/<siteId>/save \
  -H "X-API-Key: <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"html": "<html><body><h1>Hello!</h1></body></html>"}'
# → {"revisionId":"<uuid>","savedAt":"..."}

# View live
open http://localhost:3000/sites/<siteId>
```

## Cloud save from n3ware.js

Add `data-n3-*` attributes to the script tag:

```html
<script
  src="https://your-n3ware.run.app/n3ware.js"
  data-n3-api="https://your-n3ware.run.app"
  data-n3-site="<siteId>"
  data-n3-key="<apiKey>">
</script>
```

The editor toolbar gains **☁ Publish** and **↺ Revisions** buttons. Publish POSTs clean HTML to the API and shows a toast with the new revision ID.

## Cache strategy

| Resource | Cache-Control |
|---|---|
| Site HTML (`/api/sites/:id/html`, `/sites/:id`) | `public, max-age=60, s-maxage=300` |
| Static assets (`.js`, `.css`) | `public, max-age=86400` |
| API responses | `private, no-cache` |

On every save: memory cache key is invalidated immediately, then CDN URLs are purged asynchronously.

Memory cache: LRU, max 100 entries, 5-minute TTL.

## Deployment to Google Cloud Run

### Prerequisites

- Google Cloud project with Firestore (Native mode) enabled
- Cloud Build API enabled
- Container Registry or Artifact Registry enabled

### Deploy

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Submit build + deploy
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=COMMIT_SHA=$(git rev-parse --short HEAD)
```

The `cloudbuild.yaml` builds a multi-stage Docker image (Node 22 Alpine), pushes to GCR, and deploys to Cloud Run in `us-east1` with 512 Mi memory and 10 max instances.

### Set secrets after deploy

```bash
gcloud run services update n3ware --region us-east1 \
  --set-env-vars="API_KEY=your-production-secret,GCP_PROJECT=your-project-id"
```

## Running tests

```bash
# Smoke tests (validates n3ware.js structure)
node tests/run-tests.js

# API integration tests (starts local server, runs end-to-end)
node tests/api.test.js

# Both
npm test
```
