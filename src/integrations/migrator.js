'use strict';

/**
 * AI-powered HTML migration using Claude API.
 *
 * Mock mode (ANTHROPIC_API_KEY unset):
 *   - Basic cheerio cleanup: strip scripts/ads/CMS bloat
 *   - Rebuild as simple semantic sections with Tailwind
 *   - Returns a mock migration report
 *
 * Real mode:
 *   - Sends scraped HTML to Claude with a structured system prompt
 *   - Claude returns JSON: { html, sections, report }
 *
 * Functions:
 *   migrateHtml(scrapedData, imageMap) → { cleanHtml, sections, report }
 */

const isMock = !process.env.ANTHROPIC_API_KEY;
const MODEL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// ── Claude system prompt ──────────────────────────────────────────────────────

const MIGRATION_SYSTEM_PROMPT = `You are an expert web developer specializing in HTML migration and modernization.

You will receive raw HTML scraped from a small business website. Your job is to transform it into clean, modern HTML that:

1. Uses Tailwind CSS utility classes for all styling (include the Tailwind CDN script tag in <head>)
2. Is organized into clearly named semantic sections: <header> (nav/logo), <section id="hero">, named content sections, <footer>
3. Is stripped of all: WordPress/Squarespace/Wix wrappers and class names, tracking pixels, analytics scripts, cookie banners, ads, comments, empty divs, inline JavaScript event handlers, plugin markup
4. Preserves: all meaningful text content, image references (replace old src with new src from the remapping table if provided), phone numbers, addresses, business hours, service names and prices
5. Works well with contentEditable — avoid deeply nested structures, keep each section as a direct child of <body>
6. Includes the Tailwind CDN: <script src="https://cdn.tailwindcss.com"></script>
7. Uses simple, clean markup — max 3 levels of nesting per section

You MUST respond with ONLY a valid JSON object in exactly this format (no markdown, no code fences, no extra text before or after):
{
  "html": "<!DOCTYPE html>...",
  "sections": ["header", "hero", "services", "about", "contact", "footer"],
  "report": {
    "sectionsFound": 5,
    "imagesProcessed": 3,
    "linesRemoved": 847,
    "warnings": []
  }
}`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Migrate scraped HTML into clean Tailwind-based HTML.
 * @param {{html, title, description, images, baseUrl, finalUrl}} scrapedData
 * @param {Array<{originalSrc, newSrc}>} [imageMap]
 * @returns {Promise<{cleanHtml, sections, report}>}
 */
async function migrateHtml(scrapedData, imageMap = []) {
  if (isMock) return _mockMigrate(scrapedData, imageMap);
  return _claudeMigrate(scrapedData, imageMap);
}

// ── Real mode — Claude API ────────────────────────────────────────────────────

async function _claudeMigrate(scrapedData, imageMap) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const remapSection = imageMap.length
    ? '\n\nImage URL remapping (replace original src with new src in your output):\n' +
      imageMap.map(m => `  ${m.originalSrc}  →  ${m.newSrc}`).join('\n')
    : '';

  const htmlSnippet = scrapedData.html.slice(0, 100000);

  const userMessage =
    `Website title: ${scrapedData.title}\n` +
    `Source URL: ${scrapedData.finalUrl || scrapedData.baseUrl}` +
    `${remapSection}\n\nRaw HTML to migrate:\n${htmlSnippet}`;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 8192,
    system:     MIGRATION_SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0]?.text || '';

  // Strip markdown code fences if Claude wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      cleanHtml: parsed.html    || '',
      sections:  parsed.sections || [],
      report:    parsed.report   || _emptyReport(),
    };
  } catch {
    return {
      cleanHtml: raw,
      sections:  [],
      report: { ..._emptyReport(), warnings: ['Claude response was not valid JSON — used raw output'] },
    };
  }
}

// ── Mock mode — cheerio-based cleanup ─────────────────────────────────────────

async function _mockMigrate(scrapedData, imageMap) {
  const $ = require('cheerio').load(scrapedData.html || '');
  let linesRemoved = 0;

  // Strip noise elements
  const noiseSelectors = [
    'script', 'noscript', 'style', 'link[rel="stylesheet"]',
    'iframe', 'object', 'embed', 'form',
    '[class*="cookie"]', '[class*="gdpr"]', '[class*="popup"]',
    '[class*="modal"]', '[class*="overlay"]', '[class*="ad-"]',
    '[class*="-ad"]', '[id*="cookie"]', '[id*="popup"]',
    '[id*="wpadminbar"]', '[class*="wp-"]', '[class*="elementor"]',
  ];
  for (const sel of noiseSelectors) {
    const n = $(sel).length;
    linesRemoved += n;
    $(sel).remove();
  }

  // Remove empty containers
  $('div, span, section, aside').each((_, el) => {
    if (!$(el).text().trim() && !$(el).find('img').length) {
      linesRemoved++;
      $(el).remove();
    }
  });

  // Apply image URL remapping
  if (imageMap.length) {
    const remapSrc = new Map(imageMap.map(m => [m.originalSrc, m.newSrc]));
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && remapSrc.has(src)) $(el).attr('src', remapSrc.get(src));
    });
  }

  const title = scrapedData.title || $('title').text().trim() || 'Imported Site';

  // Collect nav anchor links
  const navLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (text && href.startsWith('#') && navLinks.length < 6) navLinks.push({ href, text });
  });

  // Collect headings + surrounding text as content sections
  const contentSections = [];
  $('h1, h2, h3').each((_, el) => {
    const heading = $(el).text().trim();
    if (!heading || heading.length < 3 || contentSections.length >= 5) return;
    const body = $(el).nextAll('p').first().text().trim().slice(0, 300);
    contentSections.push({ heading, body });
  });

  // Collect images (up to 6, skip data URIs)
  const imgs = [];
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (!src.startsWith('data:') && imgs.length < 6) {
      imgs.push({ src, alt: $(el).attr('alt') || '' });
    }
  });

  // Build nav HTML
  const navHtml = navLinks
    .map(l => `<a href="${_esc(l.href)}" class="text-sm font-medium text-slate-300 hover:text-white transition">${_esc(l.text)}</a>`)
    .join('');

  // Build content section HTML
  const sectionsHtml = contentSections.map((s, i) => {
    const imgTag = imgs[i + 1]
      ? `<img src="${_esc(imgs[i + 1].src)}" alt="${_esc(imgs[i + 1].alt)}" class="rounded-2xl w-full object-cover h-64 mb-6">`
      : '';
    return `
  <section id="section-${i + 1}" class="py-16 px-6">
    <div class="max-w-4xl mx-auto">
      ${imgTag}
      <h2 class="text-3xl font-bold text-slate-900 mb-4">${_esc(s.heading)}</h2>
      ${s.body ? `<p class="text-lg text-slate-600 leading-relaxed">${_esc(s.body)}</p>` : ''}
    </div>
  </section>`;
  }).join('\n');

  const heroHeading = $('h1').first().text().trim() || title;
  const heroSub     = scrapedData.description || $('h2').first().text().trim() || '';
  const heroImgSrc  = imgs[0] ? imgs[0].src : '';

  const sections = [
    ...(navLinks.length ? ['header'] : []),
    'hero',
    ...contentSections.map((_, i) => `section-${i + 1}`),
    'footer',
  ];

  const cleanHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_esc(title)}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="bg-white text-slate-900 font-sans">

  <header class="border-b border-slate-200 px-6 py-4 sticky top-0 bg-white/95 backdrop-blur z-10">
    <div class="max-w-5xl mx-auto flex items-center justify-between">
      <span class="text-xl font-bold text-slate-900">${_esc(title)}</span>
      ${navHtml ? `<nav class="hidden sm:flex items-center gap-6">${navHtml}</nav>` : ''}
    </div>
  </header>

  <section id="hero" class="py-24 px-6 text-center bg-gradient-to-b from-slate-50 to-white">
    <div class="max-w-3xl mx-auto">
      ${heroImgSrc ? `<img src="${_esc(heroImgSrc)}" alt="" class="rounded-2xl w-full max-w-2xl mx-auto object-cover h-80 mb-10">` : ''}
      <h1 class="text-5xl font-extrabold text-slate-900 mb-4">${_esc(heroHeading)}</h1>
      ${heroSub ? `<p class="text-xl text-slate-500 mb-8 leading-relaxed">${_esc(heroSub)}</p>` : ''}
      <a href="#section-1" class="inline-block bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-xl transition text-lg">Learn More</a>
    </div>
  </section>

  ${sectionsHtml}

  <footer class="bg-slate-900 text-slate-400 py-12 px-6 text-center">
    <p class="text-lg font-bold text-white mb-2">${_esc(title)}</p>
    <p class="text-sm">Powered by <a href="/" class="text-blue-400 hover:text-blue-300">n3ware</a></p>
  </footer>

</body>
</html>`;

  return {
    cleanHtml,
    sections,
    report: {
      sectionsFound:    contentSections.length,
      imagesProcessed:  imgs.length,
      linesRemoved,
      warnings: ['Running in mock mode — set ANTHROPIC_API_KEY for AI-powered migration'],
    },
  };
}

function _emptyReport() {
  return { sectionsFound: 0, imagesProcessed: 0, linesRemoved: 0, warnings: [] };
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { migrateHtml, MIGRATION_SYSTEM_PROMPT, isMock };
