/**
 * n3ware-theme-persist.js — Theme state: defaults, load, save, legacy migration.
 * Attaches: window._n3wareTheme.{DEFAULTS, FONTS, loadState, saveToStorage, save}
 */
(function () { 'use strict';
  window._n3wareTheme = window._n3wareTheme || {};

  window._n3wareTheme.FONTS = [
    { value: 'system',           label: 'System' },
    { value: 'Inter',            label: 'Inter' },
    { value: 'Roboto',           label: 'Roboto' },
    { value: 'Poppins',          label: 'Poppins' },
    { value: 'Playfair Display', label: 'Playfair Display' },
  ];

  window._n3wareTheme.DEFAULTS = {
    colors:    { primary: '#3B82F6', secondary: '#8B5CF6', accent: '#F59E0B' },
    logoUrl:   null,
    faviconUrl: null,
    fonts:     { heading: 'system', body: 'system' },
    sizes:     { h1: 60, h2: 48, h3: 36, h4: 28, h5: 22, h6: 18, body: 16 },
  };

  /** Deep clone the DEFAULTS object so mutations never bleed into the source. */
  window._n3wareTheme.cloneDefaults = function cloneDefaults() {
    return JSON.parse(JSON.stringify(window._n3wareTheme.DEFAULTS));
  };

  /** Load theme from localStorage; fall back to reading :root CSS vars on cloud sites. */
  window._n3wareTheme.loadState = function loadState(inst) {
    try {
      const raw = localStorage.getItem('n3_theme');
      if (raw) {
        const saved = JSON.parse(raw);
        const D = window._n3wareTheme.DEFAULTS;
        inst._theme = {
          colors:     { ...D.colors,    ...(saved.colors    || {}) },
          logoUrl:    saved.logoUrl    !== undefined ? saved.logoUrl    : null,
          faviconUrl: saved.faviconUrl !== undefined ? saved.faviconUrl : null,
          fonts:      { ...D.fonts,     ...(saved.fonts     || {}) },
          sizes:      { ...D.sizes,     ...(saved.sizes     || {}) },
        };
        return;
      }
    } catch (_) {}

    // No localStorage — read CSS vars injected by the assembler for cloud sites
    if (inst._cloudCfg) {
      try {
        const s    = getComputedStyle(document.documentElement);
        const read = (v) => s.getPropertyValue(v).trim();
        if (read('--n3-primary'))   inst._theme.colors.primary   = read('--n3-primary');
        if (read('--n3-secondary')) inst._theme.colors.secondary = read('--n3-secondary');
        if (read('--n3-accent'))    inst._theme.colors.accent    = read('--n3-accent');
      } catch (_) {}
    }
  };

  /** Persist current theme to localStorage. */
  window._n3wareTheme.saveToStorage = function saveToStorage(inst) {
    try {
      localStorage.setItem('n3_theme', JSON.stringify(inst._theme));
    } catch (_) {}
  };

  /** Save to localStorage + optionally push to cloud API. */
  window._n3wareTheme.save = async function save(inst) {
    const { N3UI } = window._n3wareModules;
    window._n3wareTheme.applyAll(inst);
    window._n3wareTheme.saveToStorage(inst);

    const saveBtn = inst._panel && inst._panel.querySelector('.n3-theme-save-btn');

    if (inst._cloudCfg) {
      const { site, key } = inst._cloudCfg;
      const headers = { 'Content-Type': 'application/json' };
      const jwt = document.cookie.match(/n3_token=([^;]+)/)?.[1]
               || sessionStorage.getItem('n3_auth');
      if (jwt)      headers['Authorization'] = 'Bearer ' + jwt;
      else if (key) headers['X-API-Key']     = key;

      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
      try {
        const res = await fetch(`${inst._apiBase}/sites/${site}/theme`, {
          method:  'PUT',
          headers,
          body:    JSON.stringify({ theme: inst._theme }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        N3UI.toast('Theme saved!', 'success');
      } catch (err) {
        N3UI.toast('Theme save failed: ' + err.message, 'error', 4000);
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Theme'; }
      }
    } else {
      N3UI.toast('Theme saved!', 'success');
    }
  };

})();
