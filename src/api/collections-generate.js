'use strict';

const express = require('express');
const router  = express.Router();

// POST /api/collections/generate — AI-generate a collection schema from a prompt
// No auth required (stateless Claude call)
router.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: '`prompt` is required' });
    }

    // If no API key, return a sensible mock
    if (!process.env.ANTHROPIC_API_KEY) {
      const slug = String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'collection';
      return res.json({
        name: 'My Collection',
        slug,
        fields: [
          { key: 'name',        type: 'text',   label: 'Name',        required: true },
          { key: 'description', type: 'text',   label: 'Description', required: false },
          { key: 'order',       type: 'number', label: 'Order',       required: false, default: 0 },
        ],
      });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are generating a structured content collection definition for a website builder.

Given the user's description, return a JSON object with:
- name: human-readable collection name
- slug: url-safe lowercase hyphenated identifier
- fields: array of field definitions, each with:
  - key: snake_case field identifier
  - type: one of: text, richtext, image, email, url, number, boolean, date, select
  - label: human-readable field label
  - required: boolean (true for the primary identifying field, false for others)
  - default: optional default value
  - options: array of strings (only for type "select")

Always include an "order" field (type: number, default: 0) for sortable collections.
Return ONLY valid JSON, no markdown, no explanation.`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: String(prompt).trim() }],
    });

    const raw = msg.content[0]?.text || '{}';
    // Strip markdown code fences if present
    const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const schema = JSON.parse(clean);

    // Validate minimal shape
    if (!schema.name || !schema.slug || !Array.isArray(schema.fields)) {
      throw new Error('Claude returned invalid schema structure');
    }

    res.json({ name: schema.name, slug: schema.slug, fields: schema.fields });
  } catch (err) {
    console.error('[collections/generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collections/generate-entries — AI-generate sample entries for a collection
// No auth required (stateless Claude call — actual entry creation is done client-side)
router.post('/generate-entries', async (req, res) => {
  try {
    const { collectionSlug, fields, prompt, count = 3 } = req.body || {};
    if (!collectionSlug || !Array.isArray(fields) || !prompt) {
      return res.status(400).json({ error: '`collectionSlug`, `fields`, and `prompt` are required' });
    }
    const n = Math.min(Math.max(parseInt(count, 10) || 3, 1), 10);

    // Mock fallback
    if (!process.env.ANTHROPIC_API_KEY) {
      const mockEntries = Array.from({ length: n }, (_, i) => ({
        data: Object.fromEntries(fields.map(f => [
          f.key,
          f.type === 'number' ? i + 1
          : f.type === 'boolean' ? true
          : f.type === 'select' ? (f.options?.[0] || '')
          : f.type === 'image' ? 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=400'
          : `Sample ${f.label} ${i + 1}`,
        ])),
      }));
      return res.json({ entries: mockEntries });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are generating sample content entries for a website.

Collection: ${collectionSlug}
Fields schema: ${JSON.stringify(fields)}
Business context: ${String(prompt).trim()}
Count: ${n}

Return a JSON array of ${n} entry objects. Each object has a "data" key containing field values matching the schema.
For image fields, use real Unsplash URLs: https://images.unsplash.com/photo-[ID]?w=400 (use varied real photo IDs).
For richtext fields, write 2-3 sentences of realistic copy.
For select fields, pick from the available options array.
For number fields, use realistic values.
For boolean fields, use true or false.
Make each entry distinct and realistic for the business described.
Return ONLY a valid JSON array, no markdown, no explanation.`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Generate ${n} ${collectionSlug} entries for: ${String(prompt).trim()}` }],
    });

    const raw = msg.content[0]?.text || '[]';
    const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const entries = JSON.parse(clean);

    if (!Array.isArray(entries)) throw new Error('Claude returned non-array');

    res.json({ entries: entries.slice(0, n) });
  } catch (err) {
    console.error('[collections/generate-entries]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
