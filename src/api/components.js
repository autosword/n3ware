'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const router = express.Router();

const COMPONENTS_FILE = path.join(__dirname, '../../public/components/components.json');

/** Load and cache components from disk. */
let _cache = null;
function loadComponents() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(COMPONENTS_FILE, 'utf8'));
  } catch {
    _cache = [];
  }
  return _cache;
}

// GET /api/components  [?category=Heroes]
router.get('/', (req, res) => {
  let components = loadComponents();
  const { category, q } = req.query;

  if (category) {
    components = components.filter(c =>
      c.category.toLowerCase() === category.toLowerCase()
    );
  }

  if (q) {
    const lq = q.toLowerCase();
    components = components.filter(c =>
      c.name.toLowerCase().includes(lq) ||
      (c.description || '').toLowerCase().includes(lq) ||
      (c.tags || []).some(t => t.toLowerCase().includes(lq))
    );
  }

  res.json(components);
});

// GET /api/components/categories  — unique category list with counts
router.get('/categories', (req, res) => {
  const components = loadComponents();
  const counts = {};
  components.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
  res.json(Object.entries(counts).map(([name, count]) => ({ name, count })));
});

// GET /api/components/:id
router.get('/:id', (req, res) => {
  const components = loadComponents();
  const comp = components.find(c => c.id === req.params.id);
  if (!comp) return res.status(404).json({ error: 'Component not found' });
  res.json(comp);
});

module.exports = router;
