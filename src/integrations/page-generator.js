'use strict';

/**
 * AI page generation using Claude.
 * Generates full HTML page bodies from a text description + optional images.
 */

const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');

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
 * Load a page template by id.
 * @param {string} templateId
 * @returns {object|null}
 */
function loadPageTemplate(templateId) {
  try {
    const templates = require('../../public/templates/pages/page-templates.json');
    return templates.find(t => t.id === templateId) || null;
  } catch (err) {
    console.error('[page-generator] Failed to load templates:', err.message);
    return null;
  }
}

/**
 * Customize a template using Claude — swap placeholder content for the user's
 * actual business info while keeping the structural layout intact.
 *
 * @param {object}   template     Full template object (from loadPageTemplate)
 * @param {string}   description  User's description / business context
 * @param {string[]} imageUrls    Optional uploaded images to weave in
 * @param {string}   pageName     Final page title chosen by the user
 * @returns {Promise<string>}     Customized HTML body
 */
async function customizeTemplateWithAI(template, description, imageUrls, pageName) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    console.warn('[page-generator] ANTHROPIC_API_KEY not set — using template html as-is');
    return template.html;
  }

  const imageInstructions = imageUrls && imageUrls.length
    ? `Replace placeholder images with these uploaded images where suitable:\n${imageUrls.map((url, i) => `- Image ${i + 1}: ${url}`).join('\n')}`
    : '';

  const systemPrompt = `You are a web page customizer for n3ware. You receive a pre-built HTML template and must customize its content (text, images, links) to match the user's business while preserving the visual structure and Tailwind CSS classes exactly.

Rules:
- Keep all Tailwind utility classes, HTML structure, and layout intact
- Replace placeholder text and dummy content with realistic content based on the user's description
- Replace placeholder images with real ones from Unsplash or the user's uploaded images
- Update headings, body copy, CTAs, and labels to match the business context
- Return ONLY the HTML (no markdown, no code fences, no explanation)
${template.aiInstructions ? '\nTemplate-specific guidance:\n' + template.aiInstructions : ''}`;

  const userPrompt = `Page name: "${pageName}"

Business/page description:
${description}
${imageInstructions ? '\n' + imageInstructions : ''}

HTML template to customize:
${template.html}`;

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
    console.error('[page-generator] customizeTemplateWithAI error:', err.message);
    // Fall back to the raw template html
    return template.html;
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

module.exports = { generatePageWithAI, generateMockPage, addPageToNav, loadPageTemplate, customizeTemplateWithAI };
