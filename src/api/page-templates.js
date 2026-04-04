'use strict';

/**
 * Page template routes.
 *
 * GET /api/page-templates      — list all templates (metadata only, no html/aiInstructions)
 * GET /api/page-templates/:id  — get full template including html
 */

const express = require('express');
const router  = express.Router();

const TEMPLATES = require('../../public/templates/pages/page-templates.json');

// Strip html + aiInstructions from list response to keep payload small
const META = TEMPLATES.map(({ html, aiInstructions, ...rest }) => rest);

router.get('/', (req, res) => {
  res.json({ templates: META });
});

router.get('/:id', (req, res) => {
  const t = TEMPLATES.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: t });
});

module.exports = router;
