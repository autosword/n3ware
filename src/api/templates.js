'use strict';

/**
 * Template routes.
 *
 * GET /api/templates        — list available templates
 * GET /api/templates/:name  — return template HTML
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router    = express.Router();
const TMPL_DIR  = path.join(__dirname, '../../public/templates');

const TEMPLATES = [
  { name: 'blank',      label: 'Blank',      description: 'Clean HTML5 boilerplate — start from scratch.' },
  { name: 'restaurant', label: 'Restaurant', description: 'Modern restaurant page with hero, menu, and contact.' },
  { name: 'portfolio',  label: 'Portfolio',  description: 'Creative portfolio with project grid and about section.' },
  { name: 'business',   label: 'Business',   description: 'Professional business page with services and CTA.' },
];

// ── List templates ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({ templates: TEMPLATES });
});

// ── Get template HTML ─────────────────────────────────────────────────────────
router.get('/:name', (req, res) => {
  const { name } = req.params;
  const valid = TEMPLATES.find(t => t.name === name);
  if (!valid) return res.status(404).json({ error: 'Template not found' });

  const filePath = path.join(TMPL_DIR, `${name}.html`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Template file not found' });
  }

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(fs.readFileSync(filePath, 'utf8'));
});

module.exports = router;
