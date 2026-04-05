'use strict';

/**
 * POST /api/components/customize
 *
 * Customizes a component's HTML with Claude based on a user prompt +
 * optional reference images.  Falls back to returning the template
 * unchanged when ANTHROPIC_API_KEY is not set.
 *
 * Body: { componentId, componentHtml, prompt, images: [{mediaType, data}] }
 * Response: { html }
 */

const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

const SYSTEM_PROMPT = `You are customizing a pre-built website component's HTML template.

Given:
- The component's full HTML template
- A user description of what the site/component should say
- Optional reference images attached inline (use them as replacement sources for <img> tags)

Your task: return ONLY the updated HTML with:
- Text content (headings, paragraphs, button labels, alt text) replaced to match the user's description
- <img> src attributes: if reference images were provided, describe them as alt text and keep placeholder src (browser cannot serve base64 in static HTML); otherwise keep existing src values
- ALL class names, IDs, data attributes, layout structure, and Tailwind classes preserved exactly
- NO markdown, code fences, explanations, or preamble — raw HTML only

Do not add or remove HTML elements. Do not change inline styles or class lists. Only change text nodes and src/alt attributes.`;

router.post('/customize', async (req, res) => {
  const { componentId, componentHtml, prompt, images } = req.body;

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

  const hasImages = Array.isArray(images) && images.length > 0;
  const imageNote = hasImages
    ? `\n${images.length} reference image(s) attached — use them for <img> src attributes where appropriate.`
    : '';

  const textBlock = {
    type: 'text',
    text: `Component ID: ${componentId || 'unknown'}\n\n` +
          `User description: ${prompt.trim()}${imageNote}\n\n` +
          `Component HTML to customize:\n${componentHtml}`,
  };

  const contentBlocks = hasImages
    ? [
        textBlock,
        ...images.map(img => ({
          type:   'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        })),
      ]
    : [textBlock];

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: contentBlocks }],
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
