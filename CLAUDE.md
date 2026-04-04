# n3ware — Visual Website Editor Platform

## What This Is
n3ware lets SMBs edit websites visually. One script tag enables inline editing, drag-and-drop, styling.

## Architecture
- Node.js API (server.js) — auth, CRUD, dashboard, templates
- Go Assembler (assembler/) — reads GCS files, assembles HTML, serves pages
- GCS (gs://n3ware-sites) — site files with versioning
- Firestore — users, site metadata, domains, tokens
- Cloudflare — DNS, CDN, SSL for n3ware.com
- Cloud Run — both services

## URLs
- n3ware.com — dashboard + API
- assembler.n3ware.com — serves customer sites
- GCP: n3ware (196247551045)

## Auth: Magic link → cookie on .n3ware.com → JWT in localStorage
## Save: Editor → PUT /api/sites/:id/pages/:slug → GCS + Firestore → purge cache
## Serve: assembler reads GCS → assembles header+nav+body+footer → returns HTML

## Key Files
- server.js, src/api/*.js, src/storage/*.js, src/integrations/*
- public/n3ware*.js (6 modules), public/*.html (8 pages)
- assembler/*.go (5 files)
- tests/*.js (4 test files, ~240 assertions)

## Deploy
- Node: gcloud run deploy n3ware --source=. --region=us-east1 --project=n3ware
- Go: gcloud run deploy n3ware-assembler --source=assembler/ --region=us-east1 --project=n3ware

## Env: see .env.example. Secrets in Google Secret Manager.
