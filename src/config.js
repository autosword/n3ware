'use strict';

module.exports = {
  storage:     process.env.STORAGE_BACKEND || (process.env.NODE_ENV === 'production' ? 'firestore' : 'local'),
  cdnProvider: process.env.CDN_PROVIDER || null,
  port:        parseInt(process.env.PORT, 10) || 3000,
  apiKey:      process.env.API_KEY || 'dev-key-change-in-prod',
  publicUrl:   process.env.PUBLIC_URL || null,
  cloudflare: {
    zoneId:   process.env.CF_ZONE_ID,
    apiToken: process.env.CF_API_TOKEN,
  },
  gcp: {
    project:        process.env.GCP_PROJECT,
    backendService: process.env.GCP_BACKEND_SERVICE,
  },
  firestoreProject: process.env.FIRESTORE_PROJECT || process.env.GCP_PROJECT,
};
