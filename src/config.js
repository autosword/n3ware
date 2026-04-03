'use strict';

/**
 * Centralised env-based configuration.
 * All modules import from here rather than process.env directly.
 */
module.exports = {
  // Server
  port:            parseInt(process.env.PORT || '8080', 10),
  nodeEnv:         process.env.NODE_ENV || 'development',

  // Storage
  storageBackend:  process.env.STORAGE_BACKEND || 'local',          // 'local' | 'firestore'
  dataDir:         process.env.DATA_DIR        || './data/sites',
  gcpProject:      process.env.GCP_PROJECT_ID  || '',

  // Auth
  masterApiKey:    process.env.MASTER_API_KEY  || 'dev-master-key',
  jwtSecret:       process.env.JWT_SECRET      || 'dev-jwt-secret-change-in-prod',
  usersFile:       process.env.USERS_FILE      || './data/users.json',

  // CDN
  cdnProvider:     process.env.CDN_PROVIDER    || 'none',            // 'none' | 'cloudflare' | 'gcp'
  cloudflareZone:  process.env.CF_ZONE_ID      || '',
  cloudflareToken: process.env.CF_API_TOKEN    || '',
  gcpBackendName:  process.env.GCP_BACKEND_NAME|| '',

  // Cache
  cacheMaxSize:    parseInt(process.env.CACHE_MAX_SIZE || '100', 10),
  cacheTtlMs:      parseInt(process.env.CACHE_TTL_MS  || String(5 * 60 * 1000), 10),

  // Site serving
  n3wareScriptUrl: process.env.N3WARE_SCRIPT_URL || '/n3ware.js',
};
