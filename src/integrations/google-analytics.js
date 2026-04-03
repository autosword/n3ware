'use strict';

/**
 * Google Analytics 4 Data API integration.
 *
 * Mock mode  (GOOGLE_CLIENT_ID unset): returns realistic fake GA4 data.
 * Real mode: uses googleapis OAuth2 + GA4 Data API.
 *
 * Functions:
 *   getAuthUrl(redirectUri)                                → string (OAuth2 URL)
 *   handleCallback(code, redirectUri)                     → { accessToken, refreshToken, email }
 *   getProperties(tokens)                                 → [{ propertyId, displayName }]
 *   getPageViews(propertyId, startDate, endDate, pagePath?, tokens) → { total, daily }
 *   getTopPages(propertyId, startDate, endDate, limit, tokens) → [{ path, views, avgDuration }]
 *   getTrafficSources(propertyId, startDate, endDate, tokens) → [{ source, medium, sessions }]
 *   getDeviceBreakdown(propertyId, startDate, endDate, tokens) → { mobile, desktop, tablet }
 *   getGeography(propertyId, startDate, endDate, tokens)  → [{ city, state, sessions }]
 *   getRealtime(propertyId, tokens)                       → { activeUsers }
 *   getPageSpecificStats(propertyId, pagePath, startDate, endDate, tokens) → { views, avgDuration, bounceRate, sources, devices, daily }
 */

const isMock = !process.env.GOOGLE_CLIENT_ID;

// ── OAuth helpers (real mode) ─────────────────────────────────────────────────

function _oauth2Client(redirectUri) {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function _dataClient(tokens) {
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials(tokens);
  return require('@googleapis/analytics-data')
    ? require('@googleapis/analytics-data').v1beta({ auth })
    : google.analyticsdata({ version: 'v1beta', auth });
}

function _adminClient(tokens) {
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials(tokens);
  return google.analyticsadmin({ version: 'v1alpha', auth });
}

// ── Mock data helpers ─────────────────────────────────────────────────────────

function _seed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function _randFromSeed(seed, min, max) {
  const lcg = ((seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Math.floor(lcg * (max - min + 1)) + min;
}

function _mockDailyViews(propertyId, startDate, endDate) {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const days  = [];
  let   s     = _seed(propertyId);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    s = _seed(String(s) + d.toISOString().slice(0, 10));
    const base = _randFromSeed(s, 40, 280);
    // Weekday boost
    const dow = d.getDay();
    const boost = (dow >= 1 && dow <= 5) ? 1.3 : 0.7;
    days.push({ date: d.toISOString().slice(0, 10), views: Math.round(base * boost) });
  }
  return days;
}

const MOCK_PAGES = ['/', '/about', '/services', '/contact', '/blog', '/pricing', '/gallery'];
const MOCK_SOURCES = [
  { source: 'google', medium: 'organic',  sessions: 420 },
  { source: '(direct)', medium: '(none)', sessions: 310 },
  { source: 'facebook', medium: 'social', sessions: 185 },
  { source: 'yelp',     medium: 'referral', sessions: 94 },
  { source: 'instagram', medium: 'social', sessions: 61 },
];
const MOCK_CITIES = [
  { city: 'Narragansett', state: 'Rhode Island', sessions: 210 },
  { city: 'South Kingstown', state: 'Rhode Island', sessions: 187 },
  { city: 'Westerly',      state: 'Rhode Island', sessions: 143 },
  { city: 'Wakefield',     state: 'Rhode Island', sessions: 121 },
  { city: 'Charlestown',   state: 'Rhode Island', sessions: 88 },
  { city: 'Providence',    state: 'Rhode Island', sessions: 74 },
];
const MOCK_PROPERTIES = [
  { propertyId: '123456789', displayName: 'My Business Website (mock)' },
  { propertyId: '987654321', displayName: 'Blog & Portfolio (mock)' },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {string} redirectUri
 * @returns {string}
 */
function getAuthUrl(redirectUri) {
  if (isMock) return `${redirectUri}?code=mock-code&state=mock`;
  const client = _oauth2Client(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

/**
 * @param {string} code
 * @param {string} redirectUri
 * @returns {Promise<{ accessToken, refreshToken, email }>}
 */
async function handleCallback(code, redirectUri) {
  if (isMock) {
    return { accessToken: 'mock-at', refreshToken: 'mock-rt', email: 'demo@n3ware.com' };
  }
  const client = _oauth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const { google } = require('googleapis');
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    accessToken:  tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    email:        data.email || '',
    tokens,
  };
}

/**
 * @param {object} tokens  { access_token, refresh_token, ... }
 * @returns {Promise<Array<{ propertyId, displayName }>>}
 */
async function getProperties(tokens) {
  if (isMock) return MOCK_PROPERTIES;
  const admin = _adminClient(tokens);
  const res   = await admin.properties.list({ filter: 'parent:accounts/-' });
  return (res.data.properties || []).map(p => ({
    propertyId:  p.name.replace('properties/', ''),
    displayName: p.displayName,
  }));
}

/**
 * @param {string} propertyId
 * @param {string} startDate   YYYY-MM-DD
 * @param {string} endDate     YYYY-MM-DD
 * @param {string} [pagePath]
 * @param {object} [tokens]
 * @returns {Promise<{ total: number, daily: Array<{date, views}> }>}
 */
async function getPageViews(propertyId, startDate, endDate, pagePath, tokens) {
  if (isMock) {
    const daily = _mockDailyViews(propertyId + (pagePath || ''), startDate, endDate);
    return { total: daily.reduce((s, d) => s + d.views, 0), daily };
  }
  const client = _dataClient(tokens);
  const dimensionFilter = pagePath ? {
    filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: pagePath } },
  } : undefined;
  const res = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges:  [{ startDate, endDate }],
      dimensions:  [{ name: 'date' }],
      metrics:     [{ name: 'screenPageViews' }],
      dimensionFilter,
    },
  });
  const rows  = res.data.rows || [];
  const daily = rows.map(r => ({
    date:  r.dimensionValues[0].value,
    views: parseInt(r.metricValues[0].value, 10) || 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
  return { total: daily.reduce((s, d) => s + d.views, 0), daily };
}

/**
 * @param {string} propertyId
 * @param {string} startDate
 * @param {string} endDate
 * @param {number} [limit=10]
 * @param {object} [tokens]
 * @returns {Promise<Array<{ path, views, avgDuration }>>}
 */
async function getTopPages(propertyId, startDate, endDate, limit = 10, tokens) {
  if (isMock) {
    return MOCK_PAGES.slice(0, limit).map((path, i) => ({
      path,
      views:       Math.max(10, 450 - i * 68),
      avgDuration: 45 + i * 12,
    }));
  }
  const client = _dataClient(tokens);
  const res = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics:    [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
      orderBys:   [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit,
    },
  });
  return (res.data.rows || []).map(r => ({
    path:        r.dimensionValues[0].value,
    views:       parseInt(r.metricValues[0].value, 10) || 0,
    avgDuration: parseFloat(r.metricValues[1].value) || 0,
  }));
}

/**
 * @param {string} propertyId
 * @param {string} startDate
 * @param {string} endDate
 * @param {object} [tokens]
 * @returns {Promise<Array<{ source, medium, sessions }>>}
 */
async function getTrafficSources(propertyId, startDate, endDate, tokens) {
  if (isMock) return MOCK_SOURCES;
  const client = _dataClient(tokens);
  const res = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
      limit:      10,
    },
  });
  return (res.data.rows || []).map(r => ({
    source:   r.dimensionValues[0].value,
    medium:   r.dimensionValues[1].value,
    sessions: parseInt(r.metricValues[0].value, 10) || 0,
  }));
}

/**
 * @param {string} propertyId
 * @param {string} startDate
 * @param {string} endDate
 * @param {object} [tokens]
 * @returns {Promise<{ mobile: number, desktop: number, tablet: number }>}
 */
async function getDeviceBreakdown(propertyId, startDate, endDate, tokens) {
  if (isMock) return { mobile: 58, desktop: 37, tablet: 5 };
  const client = _dataClient(tokens);
  const res = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics:    [{ name: 'sessions' }],
    },
  });
  const result = { mobile: 0, desktop: 0, tablet: 0 };
  for (const row of (res.data.rows || [])) {
    const cat = row.dimensionValues[0].value.toLowerCase();
    const val = parseInt(row.metricValues[0].value, 10) || 0;
    if (cat === 'mobile') result.mobile = val;
    else if (cat === 'desktop') result.desktop = val;
    else if (cat === 'tablet') result.tablet = val;
  }
  return result;
}

/**
 * @param {string} propertyId
 * @param {string} startDate
 * @param {string} endDate
 * @param {object} [tokens]
 * @returns {Promise<Array<{ city, state, sessions }>>}
 */
async function getGeography(propertyId, startDate, endDate, tokens) {
  if (isMock) return MOCK_CITIES;
  const client = _dataClient(tokens);
  const res = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'city' }, { name: 'region' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
      limit:      10,
    },
  });
  return (res.data.rows || []).map(r => ({
    city:     r.dimensionValues[0].value,
    state:    r.dimensionValues[1].value,
    sessions: parseInt(r.metricValues[0].value, 10) || 0,
  }));
}

/**
 * @param {string} propertyId
 * @param {object} [tokens]
 * @returns {Promise<{ activeUsers: number }>}
 */
async function getRealtime(propertyId, tokens) {
  if (isMock) return { activeUsers: Math.floor(Math.random() * 12) + 1 };
  const client = _dataClient(tokens);
  const res = await client.properties.runRealtimeReport({
    property: `properties/${propertyId}`,
    requestBody: { metrics: [{ name: 'activeUsers' }] },
  });
  const val = (res.data.rows || [])[0]?.metricValues[0]?.value || '0';
  return { activeUsers: parseInt(val, 10) || 0 };
}

/**
 * Full stats for a single page path.
 * @param {string} propertyId
 * @param {string} pagePath
 * @param {string} startDate
 * @param {string} endDate
 * @param {object} [tokens]
 * @returns {Promise<object>}
 */
async function getPageSpecificStats(propertyId, pagePath, startDate, endDate, tokens) {
  if (isMock) {
    const daily = _mockDailyViews(propertyId + pagePath, startDate, endDate);
    return {
      views:        daily.reduce((s, d) => s + d.views, 0),
      uniqueVisitors: Math.round(daily.reduce((s, d) => s + d.views, 0) * 0.72),
      avgDuration:  87,
      bounceRate:   42,
      daily,
      sources:  MOCK_SOURCES,
      devices:  { mobile: 58, desktop: 37, tablet: 5 },
      topPages: [],
      realtime: Math.floor(Math.random() * 5),
      gaConnected: true,
    };
  }
  const [pvData, srcData, devData, rt] = await Promise.all([
    getPageViews(propertyId, startDate, endDate, pagePath, tokens),
    getTrafficSources(propertyId, startDate, endDate, tokens),
    getDeviceBreakdown(propertyId, startDate, endDate, tokens),
    getRealtime(propertyId, tokens),
  ]);
  return {
    views:        pvData.total,
    uniqueVisitors: Math.round(pvData.total * 0.72),
    avgDuration:  null,
    bounceRate:   null,
    daily:        pvData.daily,
    sources:      srcData,
    devices:      devData,
    topPages:     [],
    realtime:     rt.activeUsers,
    gaConnected:  true,
  };
}

module.exports = {
  isMock,
  getAuthUrl,
  handleCallback,
  getProperties,
  getPageViews,
  getTopPages,
  getTrafficSources,
  getDeviceBreakdown,
  getGeography,
  getRealtime,
  getPageSpecificStats,
};
