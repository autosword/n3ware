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
  // General
  { name: 'blank',      category: 'General',       label: 'Blank',       description: 'Clean HTML5 boilerplate — start from scratch.' },
  { name: 'portfolio',  category: 'Creative',      label: 'Portfolio',   description: 'Creative portfolio with project grid and about section.' },
  { name: 'business',   category: 'Professional',  label: 'Business',    description: 'Professional business page with services and CTA.' },
  // Food & Drink
  { name: 'restaurant', category: 'Food & Drink',  label: 'Restaurant',  description: 'Upscale restaurant with full menu, reservations, and gallery.' },
  // Real Estate
  { name: 'realtor',    category: 'Real Estate',   label: 'Real Estate', description: 'Real estate agent page with listings, bio, and market stats.' },
  // Home Services
  { name: 'lawncare',   category: 'Home Services', label: 'Lawn Care',   description: 'Lawn & landscaping with pricing plans and before/after gallery.' },
  { name: 'handyman',   category: 'Home Services', label: 'Handyman',    description: 'Plumber/electrician/handyman with emergency banner and quote form.' },
  // Beauty
  { name: 'salon',      category: 'Beauty',        label: 'Hair Salon',  description: 'Salon with services, pricing, stylists, and booking form.' },
  // Pets
  { name: 'petcare',    category: 'Pets',          label: 'Pet Care',    description: 'Pet grooming & walking with packages and team bios.' },
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
