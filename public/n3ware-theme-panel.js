/**
 * n3ware-theme-panel.js — Theme panel DOM: build, wire, refresh.
 * Attaches: window._n3wareTheme.{buildPanel, wirePanel, refreshInputs}
 */
(function () { 'use strict';
  window._n3wareTheme = window._n3wareTheme || {};

  const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  const SIZE_KEYS   = ['h1','h2','h3','h4','h5','h6','body'];
  const SIZE_RANGES = {
    h1:[32,96], h2:[24,72], h3:[20,56], h4:[18,40], h5:[16,32], h6:[14,28], body:[12,24],
  };

  /** Build the theme panel, insert into <body>, set inst._panel. */
  window._n3wareTheme.buildPanel = function buildPanel(inst) {
    if (inst._panel) return;
    const el = document.createElement('div');
    el.className = 'n3-theme-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Theme panel');
    el.innerHTML = _panelHtml(inst._theme);
    document.body.appendChild(el);
    inst._panel = el;
    window._n3wareTheme.wirePanel(inst);
  };

  /** Wire all interactive controls to update inst._theme and call applyAll. */
  window._n3wareTheme.wirePanel = function wirePanel(inst) {
    const p = inst._panel;
    if (!p) return;

    p.querySelector('.n3-theme-close-btn').addEventListener('click', () => inst.close());

    // Color swatch + hex text pairs
    ['primary','secondary','accent'].forEach(key => {
      const swatch = p.querySelector(`.n3-color-swatch[data-key="${key}"]`);
      const input  = p.querySelector(`.n3-color-text[data-key="${key}"]`);
      if (!swatch || !input) return;
      swatch.addEventListener('input', e => {
        inst._theme.colors[key] = e.target.value;
        input.value = e.target.value;
        window._n3wareTheme.applyAll(inst);
      });
      input.addEventListener('change', e => {
        const v = e.target.value.trim();
        if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
          inst._theme.colors[key] = v;
          swatch.value = v;
          window._n3wareTheme.applyAll(inst);
        }
      });
    });

    // Logo upload
    const logoFile = p.querySelector('.n3-logo-file');
    if (logoFile) {
      logoFile.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          inst._theme.logoUrl = ev.target.result;
          const preview = p.querySelector('.n3-logo-preview');
          if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
          window._n3wareTheme.applyAll(inst);
        };
        reader.readAsDataURL(file);
      });
    }

    // Favicon upload
    const faviconFile = p.querySelector('.n3-favicon-file');
    if (faviconFile) {
      faviconFile.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          inst._theme.faviconUrl = ev.target.result;
          const preview = p.querySelector('.n3-favicon-preview');
          if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
          window._n3wareTheme.applyAll(inst);
        };
        reader.readAsDataURL(file);
      });
    }

    // Font selects
    ['heading','body'].forEach(key => {
      const sel = p.querySelector(`.n3-font-select[data-key="${key}"]`);
      if (!sel) return;
      sel.addEventListener('change', e => {
        inst._theme.fonts[key] = e.target.value;
        window._n3wareTheme.applyAll(inst);
      });
    });

    // Size sliders
    SIZE_KEYS.forEach(key => {
      const slider = p.querySelector(`.n3-size-slider[data-key="${key}"]`);
      const valEl  = p.querySelector(`.n3-size-val[data-key="${key}"]`);
      if (!slider) return;
      slider.addEventListener('input', e => {
        const v = parseInt(e.target.value, 10);
        inst._theme.sizes[key] = v;
        if (valEl) valEl.textContent = v + 'px';
        window._n3wareTheme.applyAll(inst);
      });
    });

    p.querySelector('.n3-theme-save-btn').addEventListener('click', () => window._n3wareTheme.save(inst));
    p.querySelector('.n3-theme-reset-btn').addEventListener('click', () => {
      inst._theme = window._n3wareTheme.cloneDefaults();
      window._n3wareTheme.refreshInputs(inst);
      window._n3wareTheme.applyAll(inst);
    });
  };

  /** Sync all panel inputs to current inst._theme. Called by open(). */
  window._n3wareTheme.refreshInputs = function refreshInputs(inst) {
    const p = inst._panel;
    if (!p) return;
    const t = inst._theme;

    ['primary','secondary','accent'].forEach(key => {
      const swatch = p.querySelector(`.n3-color-swatch[data-key="${key}"]`);
      const input  = p.querySelector(`.n3-color-text[data-key="${key}"]`);
      const val = t.colors[key] || '';
      if (swatch) swatch.value = val;
      if (input)  input.value  = val;
    });

    const logoPrev = p.querySelector('.n3-logo-preview');
    if (logoPrev) { logoPrev.src = t.logoUrl || ''; logoPrev.style.display = t.logoUrl ? 'block' : 'none'; }

    const favPrev = p.querySelector('.n3-favicon-preview');
    if (favPrev) { favPrev.src = t.faviconUrl || ''; favPrev.style.display = t.faviconUrl ? 'block' : 'none'; }

    ['heading','body'].forEach(key => {
      const sel = p.querySelector(`.n3-font-select[data-key="${key}"]`);
      if (sel) sel.value = t.fonts[key] || 'system';
    });

    SIZE_KEYS.forEach(key => {
      const slider = p.querySelector(`.n3-size-slider[data-key="${key}"]`);
      const valEl  = p.querySelector(`.n3-size-val[data-key="${key}"]`);
      const v = t.sizes[key] || window._n3wareTheme.DEFAULTS.sizes[key];
      if (slider) slider.value = v;
      if (valEl)  valEl.textContent = v + 'px';
    });
  };

  // ── Private ─────────────────────────────────────────────────────────────────

  function _panelHtml(theme) {
    const fonts = window._n3wareTheme.FONTS || [];

    const colorRows = ['primary','secondary','accent'].map(key => {
      const val = theme.colors[key] || '#000000';
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      return (
        '<div class="n3-theme-color-row">' +
        `<span class="n3-theme-color-label">${label}</span>` +
        `<input type="color" class="n3-theme-color-swatch n3-color-swatch" data-key="${key}" value="${_esc(val)}">` +
        `<input type="text"  class="n3-theme-color-input n3-color-text"   data-key="${key}" value="${_esc(val)}" maxlength="9">` +
        '</div>'
      );
    }).join('');

    const fontRows = [['heading','Heading'],['body','Body']].map(([key, label]) => (
      '<div class="n3-theme-select-row">' +
      `<span class="n3-theme-select-label">${label}</span>` +
      `<select class="n3-theme-select n3-font-select" data-key="${key}">` +
      fonts.map(f => `<option value="${_esc(f.value)}"${f.value === theme.fonts[key] ? ' selected' : ''}>${_esc(f.label)}</option>`).join('') +
      '</select></div>'
    )).join('');

    const sizeRows = SIZE_KEYS.map(key => {
      const [min, max] = SIZE_RANGES[key];
      const val = theme.sizes[key] || (window._n3wareTheme.DEFAULTS || {sizes:{}}).sizes[key] || 16;
      return (
        '<div class="n3-theme-slider-row">' +
        `<span class="n3-theme-slider-tag">${key.toUpperCase()}</span>` +
        `<input type="range" class="n3-theme-slider n3-size-slider" data-key="${key}" min="${min}" max="${max}" value="${val}">` +
        `<span class="n3-theme-slider-val n3-size-val" data-key="${key}">${val}px</span>` +
        '</div>'
      );
    }).join('');

    const logoSrc    = theme.logoUrl    ? ` src="${_esc(theme.logoUrl)}" style="display:block"`    : ' style="display:none"';
    const faviconSrc = theme.faviconUrl ? ` src="${_esc(theme.faviconUrl)}" style="display:block"` : ' style="display:none"';

    return (
      '<div class="n3-theme-header">' +
      '<span class="n3-theme-title">Theme</span>' +
      `<button class="n3-theme-close-btn" aria-label="Close">${CLOSE_SVG}</button>` +
      '</div>' +

      '<div class="n3-theme-body">' +
        '<div class="n3-theme-section"><h3>Colors</h3>' + colorRows + '</div>' +

        '<div class="n3-theme-section"><h3>Branding</h3>' +
          '<div style="margin-bottom:8px"><div style="font-size:11px;color:#888;margin-bottom:6px">Logo</div>' +
          '<div class="n3-theme-upload-slot">' +
          `<img class="n3-theme-upload-preview n3-logo-preview"${logoSrc} alt="Logo">` +
          '<span class="n3-theme-upload-label">Click to upload logo</span>' +
          '<input type="file" class="n3-logo-file" accept="image/*">' +
          '</div></div>' +
          '<div><div style="font-size:11px;color:#888;margin-bottom:6px">Favicon</div>' +
          '<div class="n3-theme-upload-slot">' +
          `<img class="n3-theme-upload-preview n3-favicon-preview"${faviconSrc} alt="Favicon">` +
          '<span class="n3-theme-upload-label">Click to upload favicon</span>' +
          '<input type="file" class="n3-favicon-file" accept="image/*">' +
          '</div></div>' +
        '</div>' +

        '<div class="n3-theme-section"><h3>Fonts</h3>' + fontRows + '</div>' +
        '<div class="n3-theme-section"><h3>Sizes</h3>' + sizeRows + '</div>' +
      '</div>' +

      '<div class="n3-theme-footer">' +
      '<button class="n3-theme-reset-btn">Reset</button>' +
      '<button class="n3-theme-save-btn">Save Theme</button>' +
      '</div>'
    );
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
