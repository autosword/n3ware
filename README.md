# n3ware Cloud

Visual webpage editor + hosted publishing platform.

Embed `n3ware.js` on any page, edit visually, and click **Publish** to push updates live — with cache invalidation and revision history.

## Quick Start (local dev)

```bash
npm install
npm start          # http://localhost:8080
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` or `production` |
| `PORT` | `8080` | HTTP port |
| `STORAGE_BACKEND` | `local` | `local` (JSON files) or `firestore` |
| `DATA_DIR` | `./data/sites` | Local storage root |
| `MASTER_API_KEY` | `dev-master-key` | API key for all requests |
| `CDN_PROVIDER` | `none` | `none`, `cloudflare`, or `gcp` |
| `CF_ZONE_ID` | — | Cloudflare Zone ID |
| `CF_API_TOKEN` | — | Cloudflare API token |
| `GCP_PROJECT_ID` | — | Google Cloud project |
| `GCP_BACKEND_NAME` | — | Cloud CDN URL map name |

## API Reference

All endpoints require `X-API-Key` header (or `?apiKey=` query param).

### Sites

```bash
# Create site
curl -X POST /api/sites \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"html":"<html>...</html>","message":"Initial"}'

# List sites
curl /api/sites -H "X-API-Key: $KEY"

# Get site metadata
curl /api/sites/:id -H "X-API-Key: $KEY"

# Get raw HTML
curl /api/sites/:id/html -H "X-API-Key: $KEY"

# Save (publish) new HTML — invalidates cache
curl -X POST /api/sites/:id/save \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"html":"<html>...</html>","message":"Updated hero"}'

# Delete site
curl -X DELETE /api/sites/:id -H "X-API-Key: $KEY"
```

### Revisions

```bash
# List revision history
curl /api/sites/:id/revisions -H "X-API-Key: $KEY"

# Get a specific revision (includes full HTML)
curl /api/sites/:id/revisions/:revId -H "X-API-Key: $KEY"

# Rollback to a revision
curl -X POST /api/sites/:id/revisions/:revId/rollback -H "X-API-Key: $KEY"
```

### Site Serving

Published sites are served at `/sites/:siteId`. Each page has the n3ware editor auto-injected:

```
GET /sites/:siteId
```

The injected script tag looks like:
```html
<script src="/n3ware.js"
        data-n3-site="site_abc123"
        data-n3-api="/api"></script>
```

The site owner can add a `data-n3-key` attribute manually to enable the **Publish** button.

## Cloud Save Integration

When `n3ware.js` detects cloud config on its script tag, it enables cloud saving:

```html
<script src="https://your-app.example.com/n3ware.js"
        data-n3-api="https://your-app.example.com/api"
        data-n3-site="site_abc123"
        data-n3-key="your-api-key"></script>
```

In edit mode:
- **☁ Publish** — saves clean HTML to the API, invalidates cache
- **↺ History** — opens revision panel with rollback support
- **⬇ Download** — still available as local backup

## Deploying to Google Cloud Run

### Prerequisites

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
```

### Deploy with Cloud Build

```bash
gcloud builds submit --config cloudbuild.yaml
```

This builds the Docker image, pushes it to Artifact Registry, and deploys to Cloud Run in `us-east1`.

### First-time Firestore setup

```bash
gcloud firestore databases create --region=us-east1
```

Set these environment variables on the Cloud Run service:

```bash
gcloud run services update n3ware \
  --region=us-east1 \
  --set-env-vars="STORAGE_BACKEND=firestore,GCP_PROJECT_ID=YOUR_PROJECT,MASTER_API_KEY=your-secure-key"
```

## Cache Invalidation Strategy

| Asset | Cache-Control |
|---|---|
| Site HTML (`/sites/:id`) | `public, s-maxage=300, stale-while-revalidate=60` |
| API responses | `private, no-cache` |
| Static files (`n3ware.js`) | `public, max-age=86400` |

When a site is saved:
1. Memory cache for that site is immediately invalidated
2. CDN purge request is fired (Cloudflare or GCP CDN, if configured)
3. Next request fetches fresh HTML from storage

## Running Tests

```bash
# API integration tests (starts server internally)
node tests/api.test.js

# n3ware.js smoke tests
node tests/run-tests.js

# Both
npm test
```
