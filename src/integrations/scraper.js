'use strict';

/**
 * Page scraper — fetches a URL and extracts content.
 * Uses built-in fetch (Node 18+) and cheerio for HTML parsing.
 *
 * Functions:
 *   scrapeUrl(url)                → { html, title, description, favicon, images, styles, links, baseUrl, finalUrl }
 *   downloadImages(images, siteId) → [{ originalSrc, newSrc }]
 */

const { URL }  = require('url');
const storageCloud = require('./storage-cloud');

const FETCH_TIMEOUT_MS  = 15000;
const IMAGE_TIMEOUT_MS  = 10000;
const MAX_IMAGES        = 20;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _getCheerio() { return require('cheerio'); }

function _resolveUrl(href, baseUrl, finalUrl) {
  if (!href || href.startsWith('data:') || href.startsWith('javascript:')) return null;
  try {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return baseUrl + href;
    return new URL(href, finalUrl).href;
  } catch { return null; }
}

function _extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-z]{2,5})(?:\?|$)/i);
    if (m) return m[1].toLowerCase();
  } catch { /* ignore */ }
  return 'jpg';
}

async function _fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; n3ware-scraper/1.0)',
        'Accept':     'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { html, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function _fetchBinary(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; n3ware-scraper/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    return { buffer: Buffer.from(buf), contentType: ct.split(';')[0].trim() };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scrape a URL and return structured data.
 * @param {string} rawUrl
 * @returns {Promise<{html, title, description, favicon, images, styles, links, baseUrl, finalUrl}>}
 */
async function scrapeUrl(rawUrl) {
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;

  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { throw new Error(`Invalid URL: ${rawUrl}`); }
  const baseUrl = `${parsed.protocol}//${parsed.host}`;

  const { html, finalUrl } = await _fetchText(rawUrl);
  const $ = _getCheerio().load(html);

  // Meta
  const title = ($('title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    parsed.hostname).slice(0, 120);

  const description = (
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') || ''
  ).slice(0, 300);

  const faviconHref = $('link[rel="icon"], link[rel="shortcut icon"]').first().attr('href') || '/favicon.ico';
  const favicon     = _resolveUrl(faviconHref, baseUrl, finalUrl);

  // Images — collect, resolve, dedupe
  const imgMap = new Map();

  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (!src) return;
    const resolved = _resolveUrl(src, baseUrl, finalUrl);
    if (!resolved || imgMap.has(resolved)) return;
    imgMap.set(resolved, {
      src:    resolved,
      alt:    $(el).attr('alt') || '',
      width:  $(el).attr('width') || '',
      height: $(el).attr('height') || '',
    });
  });

  // og:image often higher quality
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const resolved = _resolveUrl(ogImage, baseUrl, finalUrl);
    if (resolved && !imgMap.has(resolved)) {
      imgMap.set(resolved, { src: resolved, alt: 'Featured image', width: '', height: '' });
    }
  }

  const images = [...imgMap.values()].slice(0, MAX_IMAGES);

  // External stylesheets
  const styles = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = _resolveUrl($(el).attr('href') || '', baseUrl, finalUrl);
    if (href) styles.push(href);
  });

  // Internal links (anchors only)
  const linkSet = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.startsWith('/') || href.startsWith('#')) linkSet.add(href);
  });

  return {
    html,
    title,
    description,
    favicon,
    images,
    styles:   styles.slice(0, 10),
    links:    [...linkSet].slice(0, 20),
    baseUrl,
    finalUrl,
  };
}

/**
 * Download images and store them via storageCloud.
 * Returns a mapping of old src → new hosted URL.
 * @param {Array<{src, alt}>} images
 * @param {string} siteId
 * @returns {Promise<Array<{originalSrc, newSrc}>>}
 */
async function downloadImages(images, siteId) {
  const results = [];

  for (const img of images) {
    try {
      const fetched = await _fetchBinary(img.src);
      if (!fetched || !fetched.buffer || fetched.buffer.length === 0) continue;

      const ext  = _extFromUrl(img.src) || 'jpg';
      const name = `imported-${Date.now()}-${results.length}.${ext}`;

      const uploaded = await storageCloud.uploadFile(siteId, name, fetched.buffer, fetched.contentType);
      results.push({ originalSrc: img.src, newSrc: uploaded.url });
    } catch { /* skip failed images silently */ }
  }

  return results;
}

module.exports = { scrapeUrl, downloadImages };
