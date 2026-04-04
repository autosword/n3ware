'use strict';

/**
 * AI page generation using Claude.
 * Generates full HTML page bodies from a text description + optional images.
 */

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Generate a page body using Claude (or fall back to mock if no API key).
 *
 * @param {string}   description  Natural-language prompt for the page
 * @param {object[]} components   Component library (from components.json)
 * @param {string[]} imageUrls    Optional uploaded image URLs to incorporate
 * @param {string}   pageName     Human-readable page title
 * @returns {Promise<string>}     HTML body content (no <html>/<head>/<body> tags)
 */
async function generatePageWithAI(description, components, imageUrls, pageName) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Summarise the component library (first 40 entries to stay within context)
  const componentList = (components || []).slice(0, 40).map(c =>
    `- ${c.id}: ${c.name} (${c.category})${c.description ? ' — ' + c.description : ''}`
  ).join('\n');

  const imageInstructions = imageUrls && imageUrls.length
    ? `Use these uploaded images in the page:\n${imageUrls.map((url, i) => `- Image ${i + 1}: ${url}`).join('\n')}`
    : 'Use relevant placeholder images from Unsplash (https://images.unsplash.com/...) where appropriate.';

  const systemPrompt = `You are a web page generator for n3ware, a visual website editor. Generate a complete HTML page body (no <html>, <head>, or <body> tags — only the content that goes inside <main>).

Use Tailwind CSS utility classes for all styling. The page should look professional and polished for a small business website.

Available component patterns you can draw inspiration from (adapt freely, don't copy verbatim):
${componentList}

${imageInstructions}

Requirements:
- Return ONLY the HTML content (no markdown, no code fences, no explanation, no preamble)
- Use semantic HTML5 elements (section, article, header, h1–h3, p, ul, etc.)
- Include realistic, relevant content based on the description
- Mobile-responsive layout using Tailwind responsive prefixes (sm:, md:, lg:)
- Professional typography and generous whitespace
- At least one clear call-to-action section
- Where images are used, add descriptive alt text`;

  const userPrompt = `Create a page called "${pageName}" with this description:\n${description}`;

  if (!anthropicKey) {
    console.warn('[page-generator] ANTHROPIC_API_KEY not set — using mock page');
    return generateMockPage(pageName, description, imageUrls);
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const text = message.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Claude');
    return text;
  } catch (err) {
    console.error('[page-generator] Claude API error:', err.message);
    return generateMockPage(pageName, description, imageUrls);
  }
}

/**
 * Fallback mock page used when no API key is configured.
 */
function generateMockPage(name, description, imageUrls) {
  const img = imageUrls?.[0] || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80';
  const safe = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<section class="py-20 bg-white">
  <div class="max-w-4xl mx-auto px-6 text-center">
    <h1 class="text-5xl font-bold text-gray-900 mb-6">${safe(name)}</h1>
    <p class="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">${safe(description)}</p>
    <img src="${safe(img)}" alt="${safe(name)}" class="w-full rounded-2xl shadow-xl mb-10 object-cover max-h-96">
    <a href="#contact" class="inline-block bg-blue-600 text-white font-bold px-8 py-4 rounded-xl shadow-lg hover:bg-blue-700 transition text-lg">Get In Touch</a>
  </div>
</section>
<section class="py-16 bg-gray-50">
  <div class="max-w-4xl mx-auto px-6">
    <h2 class="text-3xl font-bold text-gray-900 mb-8 text-center">About This Page</h2>
    <p class="text-gray-600 text-lg leading-relaxed text-center">Content for <strong>${safe(name)}</strong> will go here. This page was generated based on your description. Click any text to edit it in n3ware.</p>
  </div>
</section>`;
}

/**
 * Insert a new navigation link into existing nav HTML.
 * Handles <ul>/<li> and bare <a> patterns.
 *
 * @param {string} navHtml  Current nav component HTML
 * @param {string} slug     URL slug for the new page
 * @param {string} name     Display name for the nav link
 * @returns {string}        Updated nav HTML
 */
function addPageToNav(navHtml, slug, name) {
  if (!navHtml || !navHtml.trim()) {
    return `<nav class="flex gap-6 px-6 py-4">\n  <a href="/${slug}" class="text-gray-300 hover:text-white transition">${name}</a>\n</nav>`;
  }

  const linkHtml = `<a href="/${slug}" class="text-gray-300 hover:text-white transition">${name}</a>`;
  const liHtml   = `  <li><a href="/${slug}" class="text-gray-300 hover:text-white transition">${name}</a></li>`;

  // Prefer inserting as <li> if the nav uses a list
  if (navHtml.includes('</ul>')) {
    return navHtml.replace('</ul>', `${liHtml}\n</ul>`);
  }
  if (navHtml.includes('</nav>')) {
    return navHtml.replace('</nav>', `  ${linkHtml}\n</nav>`);
  }
  // Fallback: append
  return navHtml + `\n${linkHtml}`;
}

module.exports = { generatePageWithAI, generateMockPage, addPageToNav };
