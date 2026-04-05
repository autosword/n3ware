'use strict';

/**
 * POST /api/components/customize
 *
 * Customizes a component's HTML with Claude based on a user prompt +
 * optional reference images.  Falls back to returning the template
 * unchanged when ANTHROPIC_API_KEY is not set.
 *
 * Body: { componentId, componentHtml, prompt, imageUrls: [] }
 * Response: { html }
 */

const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const { authOrApiKey } = require('./auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are customizing a pre-built website component's HTML template.

Given:
- The component's full HTML template
- A user description of what the site/component should say
- Optional reference image URLs to use in place of placeholder images

Your task: return ONLY the updated HTML with:
- Text content (headings, paragraphs, button labels, alt text) replaced to match the user's description
- <img> src attributes replaced with the provided image URLs when available; otherwise keep existing src values
- ALL class names, IDs, data attributes, layout structure, and Tailwind classes preserved exactly
- NO markdown, code fences, explanations, or preamble — raw HTML only

Do not add or remove HTML elements. Do not change inline styles or class lists. Only change text nodes and src/alt attributes.`;

router.post('/customize', authOrApiKey, async (req, res) => {
  const { componentId, componentHtml, prompt, imageUrls } = req.body;

  if (!componentHtml || typeof componentHtml !== 'string') {
    return res.status(400).json({ error: 'componentHtml is required' });
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    console.warn('[component-customize] ANTHROPIC_API_KEY not set — returning template unchanged');
    return res.json({ html: componentHtml, mock: true });
  }

  const imageSection = (imageUrls && imageUrls.length)
    ? `\nReference images to use for <img> src attributes (in order):\n${imageUrls.map((u, i) => `  Image ${i + 1}: ${u}`).join('\n')}`
    : '';

  const userPrompt =
    `Component ID: ${componentId || 'unknown'}\n\n` +
    `User description: ${prompt.trim()}${imageSection}\n\n` +
    `Component HTML to customize:\n${componentHtml}`;

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    let html = message.content[0]?.text || componentHtml;
    // Strip accidental code fences
    html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/, '').trim();

    res.json({ html });
  } catch (err) {
    console.error('[component-customize] Claude error:', err.message);
    res.status(502).json({ error: 'AI customization failed: ' + err.message });
  }
});

module.exports = router;
