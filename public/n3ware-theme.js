/**
 * n3ware-theme — Theme panel: colors, typography, border radius, brand assets.
 * N3Theme
 * Registers on window._n3wareModules.
 */
(function () { 'use strict';
  const { T, N3UI } = window._n3wareModules;

  const FONTS = [
    { value: 'system',            label: 'System' },
    { value: 'Inter',             label: 'Inter' },
    { value: 'Roboto',            label: 'Roboto' },
    { value: 'Poppins',           label: 'Poppins' },
    { value: 'Playfair Display',  label: 'Playfair Display' },
  ];

  const DEFAULTS = {
    primary:     '#3B82F6',
    secondary:   '#8B5CF6',
    accent:      '#F59E0B',
    bg:          '#FFFFFF',
    fg:          '#111827',
    font:        'system',
    headingFont: 'system',
    radius:      '8',
  };

  // ── Self-contained CSS injection ─────────────────────────────────────────────
  // Keeps panel styles alive regardless of which n3ware.js version the browser
  // has cached — companion modules must not depend on the parent's stylesheet.

  function _injectStyles() {
    if (document.getElementById('n3-theme-styles')) return;
    const T = window._n3wareModules.T;
    const s = document.createElement('style');
    s.id = 'n3-theme-styles';
    s.textContent = [
      `.n3-theme-panel{position:fixed;top:0;left:0;bottom:0;z-index:999995;background:#0B1120;border-right:1px solid ${T.border};width:264px;transform:translateX(-100%);transition:transform .25s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;font:13px/1.5 system-ui,sans-serif;color:${T.text};box-shadow:4px 0 24px rgba(0,0,0,.4);overflow:hidden}`,
      `.n3-theme-panel.n3-theme-open{transform:translateX(0)!important}`,
      `.n3-theme-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 12px;border-bottom:1px solid ${T.border};background:#0B1120;position:sticky;top:0;z-index:1;flex-shrink:0}`,
      `.n3-theme-title{font:700 13px/1 system-ui;color:${T.text};display:flex;align-items:center;gap:7px}`,
      `.n3-theme-close{background:transparent;border:none;color:${T.muted};cursor:pointer;font-size:15px;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;transition:all .12s}`,
      `.n3-theme-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
      `.n3-theme-body{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:${T.border} transparent}`,
      `.n3-theme-section{padding:12px 14px;border-bottom:1px solid ${T.border}}`,
      `.n3-theme-section-title{font:700 10px/1 system-ui;text-transform:uppercase;letter-spacing:.07em;color:${T.muted};margin-bottom:10px}`,
      `.n3-theme-field{margin-bottom:8px}`,
      `.n3-theme-label{display:block;font-size:11px;color:${T.muted};margin-bottom:5px}`,
      `.n3-theme-hint{font-size:10px;color:#555;margin-left:4px}`,
      `.n3-theme-color-row .n3-theme-label{margin-bottom:4px}`,
      `.n3-theme-color-wrap{display:flex;align-items:center;gap:8px}`,
      `.n3-theme-swatch{position:relative;width:28px;height:28px;border-radius:5px;border:1px solid ${T.border};flex-shrink:0;overflow:hidden;cursor:pointer}`,
      `.n3-theme-cpick{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;padding:0;border:none}`,
      `.n3-theme-hex{flex:1;background:rgba(255,255,255,.05);border:1px solid ${T.border};color:${T.text};border-radius:5px;padding:5px 8px;font:12px/1 monospace;outline:none;box-sizing:border-box;transition:border-color .12s}`,
      `.n3-theme-hex:focus{border-color:${T.accent}}`,
      `.n3-theme-select{width:100%;background:rgba(255,255,255,.06);border:1px solid ${T.border};color:${T.text};border-radius:6px;padding:6px 8px;font:12px/1 system-ui,sans-serif;outline:none;cursor:pointer;transition:border-color .12s}`,
      `.n3-theme-select:hover{border-color:${T.accent}}`,
      `.n3-theme-slider{width:100%;height:4px;-webkit-appearance:none;background:${T.border};border-radius:2px;outline:none;cursor:pointer;margin-top:4px}`,
      `.n3-theme-slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:${T.accent};border-radius:50%;cursor:pointer}`,
      `.n3-theme-rval{color:${T.text};font-weight:600;float:right}`,
      `.n3-theme-asset{border:1px dashed ${T.border};border-radius:6px;padding:9px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:border-color .12s,background .12s;min-height:38px}`,
      `.n3-theme-asset:hover,.n3-theme-drag-over{border-color:${T.accent};background:rgba(227,19,55,.05)}`,
      `.n3-theme-aprev{width:28px;height:28px;object-fit:contain;border-radius:4px;flex-shrink:0}`,
      `.n3-theme-adrop-label{flex:1;font-size:11px;color:${T.muted}}`,
      `.n3-theme-arm{background:rgba(239,68,68,.15);border:none;color:#F87171;width:18px;height:18px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;transition:background .12s}`,
      `.n3-theme-arm:hover{background:rgba(239,68,68,.35)}`,
      `.n3-theme-footer{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid ${T.border};flex-shrink:0;background:#0B1120}`,
      `.n3-theme-reset-btn{background:rgba(255,255,255,.07);border:1px solid ${T.border};color:${T.text};padding:7px 14px;border-radius:6px;cursor:pointer;font:600 12px/1 system-ui,sans-serif;transition:all .12s}`,
      `.n3-theme-reset-btn:hover{background:rgba(255,255,255,.14)}`,
      `.n3-theme-save-btn{background:${T.accent};border:1px solid ${T.accent};color:#fff;padding:7px 14px;border-radius:6px;cursor:pointer;font:600 12px/1 system-ui,sans-serif;transition:all .12s}`,
      `.n3-theme-save-btn:hover{background:${T.accentDark};border-color:${T.accentDark}}`,
      `.n3-theme-save-btn:disabled{opacity:.5;cursor:not-allowed}`,
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _ic(name, size) {
    const fn = (window._n3wareModules || {}).icon;
    return fn ? fn(name, { size: size || 16 }) : '';
  }

  function _isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(v); }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Theme
  // ═══════════════════════════════════════════════════════════════════════════

  class N3Theme {
    /**
     * @param {import('./n3ware').N3Events} events
     * @param {{ api: string, site: string, key: string }|null} cloudCfg
     */
    constructor(events, cloudCfg) {
      this._events   = events;
      this._cloudCfg = cloudCfg;
      this._panel    = null;
      this._open     = false;
      this._theme    = { ...DEFAULTS };
      // assets: { favicon: dataUrl|null, navLogo: dataUrl|null, footerLogo: dataUrl|null }
      this._assets   = { favicon: null, navLogo: null, footerLogo: null };
      this._apiBase  = cloudCfg ? cloudCfg.api.replace(/\/$/, '') : '/api';

      this._loadState();
    }

    /** Insert panel DOM and apply stored theme. */
    mount() {
      _injectStyles();
      if (!this._panel) this._buildPanel();
      this._applyTheme();
      this._applyStoredAssets();
    }

    toggle() { this._open ? this.close() : this.open(); }

    open() {
      if (this._open) return;
      if (!this._panel) this._buildPanel();
      this._refreshInputs();
      // Force the browser to commit the closed (translateX(-100%)) state before
      // adding the open class, so the transition actually fires on first call.
      this._panel.classList.remove('n3-theme-open');
      void this._panel.offsetHeight; // reflow
      requestAnimationFrame(() => {
        this._panel.classList.add('n3-theme-open');
        this._open = true;
      });
    }

    close() {
      if (!this._open) return;
      this._open = false;
      if (this._panel) this._panel.classList.remove('n3-theme-open');
    }

    isOpen() { return this._open; }

    // ── Private ──────────────────────────────────────────────────────────────

    /** Load theme from localStorage; fall back to reading :root CSS vars on cloud sites. */
    _loadState() {
      try {
        const raw = localStorage.getItem('n3_theme');
        if (raw) {
          const parsed = JSON.parse(raw);
          this._theme  = { ...DEFAULTS, ...parsed.theme  };
          this._assets = { favicon: null, navLogo: null, footerLogo: null, ...parsed.assets };
          return;
        }
      } catch (_) {}

      // No localStorage — read vars from :root (injected by assembler for cloud sites)
      if (this._cloudCfg) {
        try {
          const s = getComputedStyle(document.documentElement);
          const read = (v) => s.getPropertyValue(v).trim();
          if (read('--n3-primary')) this._theme.primary     = read('--n3-primary');
          if (read('--n3-secondary')) this._theme.secondary = read('--n3-secondary');
          if (read('--n3-accent'))  this._theme.accent      = read('--n3-accent');
          if (read('--n3-bg'))      this._theme.bg          = read('--n3-bg');
          if (read('--n3-fg'))      this._theme.fg          = read('--n3-fg');
          if (read('--n3-radius')) {
            const r = read('--n3-radius').replace('px', '');
            if (!isNaN(r)) this._theme.radius = r;
          }
        } catch (_) {}
      }
    }

    _saveToStorage() {
      try {
        localStorage.setItem('n3_theme', JSON.stringify({
          theme:  this._theme,
          assets: this._assets,
        }));
      } catch (_) {}
    }

    /** Write CSS vars to :root and push Tailwind config extension. */
    _applyTheme() {
      const t = this._theme;

      // 1. CSS custom properties
      let styleEl = document.getElementById('n3-theme-vars');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'n3-theme-vars';
        document.head.appendChild(styleEl);
      }
      const fontCss        = t.font        === 'system' ? 'system-ui,-apple-system,sans-serif' : `'${t.font}',sans-serif`;
      const headingFontCss = t.headingFont === 'system' ? 'system-ui,-apple-system,sans-serif' : `'${t.headingFont}',sans-serif`;
      styleEl.textContent = [
        ':root{',
        `--n3-primary:${t.primary};`,
        `--n3-secondary:${t.secondary};`,
        `--n3-accent:${t.accent};`,
        `--n3-bg:${t.bg};`,
        `--n3-fg:${t.fg};`,
        `--n3-font:${fontCss};`,
        `--n3-heading-font:${headingFontCss};`,
        `--n3-radius:${t.radius}px;`,
        '}',
      ].join('');

      // 2. Tailwind config extension (CDN play version supports tailwind.config + tailwind.refresh)
      if (window.tailwind) {
        try {
          window.tailwind.config = {
            theme: {
              extend: {
                colors: {
                  primary:   'var(--n3-primary)',
                  secondary: 'var(--n3-secondary)',
                  accent:    'var(--n3-accent)',
                },
                borderRadius: { base: 'var(--n3-radius)' },
              },
            },
          };
          if (typeof window.tailwind.refresh === 'function') window.tailwind.refresh();
        } catch (_) {}
      }

      // 3. Google Fonts
      const toLoad = new Set();
      if (t.font        !== 'system') toLoad.add(t.font);
      if (t.headingFont !== 'system') toLoad.add(t.headingFont);
      for (const font of toLoad) {
        const id = 'n3-gf-' + font.replace(/\s+/g, '-').toLowerCase();
        if (!document.getElementById(id)) {
          const link = document.createElement('link');
          link.id   = id;
          link.rel  = 'stylesheet';
          link.href = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@400;600;700&display=swap`;
          document.head.appendChild(link);
        }
      }
    }

    /** Apply brand assets stored in this._assets to live DOM (called on Save). */
    _applyAssets() {
      // Favicon
      const { favicon, navLogo, footerLogo } = this._assets;
      if (favicon) {
        let link = document.querySelector('link[rel="icon"]');
        if (!link) {
          link     = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = favicon;
      }

      // Nav logo
      if (navLogo) {
        const nav = document.querySelector('nav');
        if (nav) {
          const img = nav.querySelector('img');
          if (img) {
            img.src = navLogo;
          } else {
            const anchor = nav.querySelector('a');
            if (anchor) {
              const newImg = document.createElement('img');
              newImg.src = navLogo;
              newImg.alt = 'Logo';
              Object.assign(newImg.style, { height: '32px', width: 'auto', display: 'inline-block' });
              anchor.insertBefore(newImg, anchor.firstChild);
            }
          }
        }
      }

      // Footer logo
      if (footerLogo) {
        const footer = document.querySelector('footer');
        if (footer) {
          const img = footer.querySelector('img');
          if (img) {
            img.src = footerLogo;
          } else {
            const anchor = footer.querySelector('a');
            if (anchor) {
              const newImg = document.createElement('img');
              newImg.src = footerLogo;
              newImg.alt = 'Logo';
              Object.assign(newImg.style, { height: '40px', width: 'auto', display: 'inline-block' });
              anchor.insertBefore(newImg, anchor.firstChild);
            }
          }
        }
      }
    }

    /** Apply only previously-stored asset data URLs (called from mount, non-destructive). */
    _applyStoredAssets() {
      // Only apply if data URLs are present — don't swap DOM unless we have something
      if (this._assets.favicon || this._assets.navLogo || this._assets.footerLogo) {
        this._applyAssets();
      }
    }

    // ── Panel build ──────────────────────────────────────────────────────────

    _buildPanel() {
      const panel = document.createElement('div');
      panel.className = 'n3-theme-panel';
      panel.setAttribute('data-n3-ui', '1');

      panel.innerHTML = `
        <div class="n3-theme-hdr">
          <div class="n3-theme-title">
            <span style="display:inline-flex;align-items:center">${_ic('palette', 16)}</span> Theme
          </div>
          <button class="n3-theme-close" title="Close" style="display:flex;align-items:center">${_ic('x', 14)}</button>
        </div>
        <div class="n3-theme-body">

          <div class="n3-theme-section">
            <div class="n3-theme-section-title">Colors</div>
            ${this._colorRow('primary',   'Primary')}
            ${this._colorRow('secondary', 'Secondary')}
            ${this._colorRow('accent',    'Accent')}
            ${this._colorRow('bg',        'Background')}
            ${this._colorRow('fg',        'Text')}
          </div>

          <div class="n3-theme-section">
            <div class="n3-theme-section-title">Typography</div>
            <div class="n3-theme-field">
              <label class="n3-theme-label">Body font</label>
              <select class="n3-theme-select" data-key="font">
                ${FONTS.map(f => `<option value="${f.value}"${this._theme.font === f.value ? ' selected' : ''}>${f.label}</option>`).join('')}
              </select>
            </div>
            <div class="n3-theme-field">
              <label class="n3-theme-label">Heading font</label>
              <select class="n3-theme-select" data-key="headingFont">
                ${FONTS.map(f => `<option value="${f.value}"${this._theme.headingFont === f.value ? ' selected' : ''}>${f.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="n3-theme-section">
            <div class="n3-theme-section-title">Shape</div>
            <div class="n3-theme-field">
              <label class="n3-theme-label">Border radius <span class="n3-theme-rval">${this._theme.radius}px</span></label>
              <input type="range" class="n3-theme-slider" data-key="radius" min="0" max="24" value="${this._theme.radius}">
            </div>
          </div>

          <div class="n3-theme-section">
            <div class="n3-theme-section-title">Brand Assets</div>
            ${this._assetRow('favicon',    'Favicon',      '32×32 PNG/ICO')}
            ${this._assetRow('navLogo',    'Nav Logo',     'PNG/SVG')}
            ${this._assetRow('footerLogo', 'Footer Logo',  'PNG/SVG')}
          </div>

        </div>
        <div class="n3-theme-footer">
          <button class="n3-theme-reset-btn">Reset</button>
          <div style="flex:1"></div>
          <button class="n3-theme-save-btn">Save Theme</button>
        </div>
      `;

      this._panel = panel;
      document.body.appendChild(panel);
      this._wirePanel();
    }

    _colorRow(key, label) {
      const v = this._theme[key];
      return `
        <div class="n3-theme-field n3-theme-color-row">
          <label class="n3-theme-label">${label}</label>
          <div class="n3-theme-color-wrap">
            <div class="n3-theme-swatch" style="background:${v}">
              <input type="color" class="n3-theme-cpick" data-key="${key}" value="${v}">
            </div>
            <input type="text" class="n3-theme-hex" data-key="${key}" value="${v}" maxlength="7" spellcheck="false">
          </div>
        </div>`;
    }

    _assetRow(key, label, hint) {
      return `
        <div class="n3-theme-field">
          <label class="n3-theme-label">${label} <span class="n3-theme-hint">${hint}</span></label>
          <div class="n3-theme-asset" data-key="${key}">
            <input type="file" class="n3-theme-afile" data-key="${key}" accept="image/*" style="display:none">
            <img class="n3-theme-aprev" data-key="${key}" alt="" style="display:none">
            <span class="n3-theme-adrop-label">Drop or click to upload</span>
            <button class="n3-theme-arm" data-key="${key}" style="display:none" title="Remove">${_ic('x', 11)}</button>
          </div>
        </div>`;
    }

    _wirePanel() {
      const p = this._panel;

      p.querySelector('.n3-theme-close').addEventListener('click', () => this.close());

      // Color pickers → live update
      p.querySelectorAll('.n3-theme-cpick').forEach(inp => {
        inp.addEventListener('input', () => {
          const k = inp.dataset.key;
          p.querySelector(`.n3-theme-hex[data-key="${k}"]`).value = inp.value;
          p.querySelector(`.n3-theme-swatch[data-key]`)?.setAttribute('style', `background:${inp.value}`);
          inp.closest('.n3-theme-swatch').style.background = inp.value;
          this._theme[k] = inp.value;
          this._applyTheme();
        });
      });

      // Hex inputs → live update
      p.querySelectorAll('.n3-theme-hex').forEach(inp => {
        inp.addEventListener('input', () => {
          const k = inp.dataset.key;
          const v = inp.value.trim();
          if (_isHex(v)) {
            p.querySelector(`.n3-theme-cpick[data-key="${k}"]`).value = v;
            inp.closest('.n3-theme-color-row').querySelector('.n3-theme-swatch').style.background = v;
            this._theme[k] = v;
            this._applyTheme();
          }
        });
      });

      // Selects
      p.querySelectorAll('.n3-theme-select').forEach(sel => {
        sel.addEventListener('change', () => {
          this._theme[sel.dataset.key] = sel.value;
          this._applyTheme();
        });
      });

      // Radius slider
      p.querySelectorAll('.n3-theme-slider').forEach(sl => {
        sl.addEventListener('input', () => {
          this._theme[sl.dataset.key] = sl.value;
          const rv = p.querySelector('.n3-theme-rval');
          if (rv) rv.textContent = sl.value + 'px';
          this._applyTheme();
        });
      });

      // Asset upload areas
      ['favicon', 'navLogo', 'footerLogo'].forEach(key => {
        const zone    = p.querySelector(`.n3-theme-asset[data-key="${key}"]`);
        const fileInp = p.querySelector(`.n3-theme-afile[data-key="${key}"]`);
        const prev    = p.querySelector(`.n3-theme-aprev[data-key="${key}"]`);
        const rmBtn   = p.querySelector(`.n3-theme-arm[data-key="${key}"]`);

        const readFile = file => {
          if (!file || !file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = e => {
            const url = e.target.result;
            this._assets[key] = url;
            prev.src           = url;
            prev.style.display = 'block';
            rmBtn.style.display = 'flex';
          };
          reader.readAsDataURL(file);
        };

        // Restore previously-loaded asset preview
        if (this._assets[key]) {
          prev.src           = this._assets[key];
          prev.style.display = 'block';
          rmBtn.style.display = 'flex';
        }

        zone.addEventListener('click', e => {
          if (rmBtn.contains(e.target)) return;
          fileInp.click();
        });
        fileInp.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });
        zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('n3-theme-drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('n3-theme-drag-over'));
        zone.addEventListener('drop', e => {
          e.preventDefault();
          zone.classList.remove('n3-theme-drag-over');
          if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
        });
        rmBtn.addEventListener('click', e => {
          e.stopPropagation();
          this._assets[key]  = null;
          prev.style.display = 'none';
          rmBtn.style.display = 'none';
          fileInp.value      = '';
        });
      });

      // Reset
      p.querySelector('.n3-theme-reset-btn').addEventListener('click', () => {
        this._theme  = { ...DEFAULTS };
        this._assets = { favicon: null, navLogo: null, footerLogo: null };
        this._refreshInputs();
        this._applyTheme();
        this._saveToStorage();
        N3UI.toast('Theme reset', 'info');
      });

      // Save
      p.querySelector('.n3-theme-save-btn').addEventListener('click', () => this._save());
    }

    /** Sync panel UI controls to current this._theme state. */
    _refreshInputs() {
      if (!this._panel) return;
      const p = this._panel;
      const t = this._theme;

      ['primary', 'secondary', 'accent', 'bg', 'fg'].forEach(k => {
        const picker = p.querySelector(`.n3-theme-cpick[data-key="${k}"]`);
        const hex    = p.querySelector(`.n3-theme-hex[data-key="${k}"]`);
        const swatch = picker && picker.closest('.n3-theme-swatch');
        if (picker) picker.value        = t[k];
        if (hex)    hex.value           = t[k];
        if (swatch) swatch.style.background = t[k];
      });
      ['font', 'headingFont'].forEach(k => {
        const sel = p.querySelector(`.n3-theme-select[data-key="${k}"]`);
        if (sel) sel.value = t[k];
      });
      const sl = p.querySelector('.n3-theme-slider');
      if (sl) {
        sl.value = t.radius;
        const rv = p.querySelector('.n3-theme-rval');
        if (rv) rv.textContent = t.radius + 'px';
      }
      // Asset previews
      ['favicon', 'navLogo', 'footerLogo'].forEach(key => {
        const prev  = p.querySelector(`.n3-theme-aprev[data-key="${key}"]`);
        const rmBtn = p.querySelector(`.n3-theme-arm[data-key="${key}"]`);
        if (this._assets[key]) {
          if (prev)  { prev.src = this._assets[key]; prev.style.display = 'block'; }
          if (rmBtn) rmBtn.style.display = 'flex';
        } else {
          if (prev)  prev.style.display = 'none';
          if (rmBtn) rmBtn.style.display = 'none';
        }
      });
    }

    // ── Save ─────────────────────────────────────────────────────────────────

    async _save() {
      this._applyTheme();
      this._applyAssets();
      this._saveToStorage();

      const saveBtn = this._panel && this._panel.querySelector('.n3-theme-save-btn');

      if (this._cloudCfg) {
        const { api, site, key } = this._cloudCfg;
        const headers = { 'Content-Type': 'application/json' };
        const jwt = document.cookie.match(/n3_token=([^;]+)/)?.[1]
                 || sessionStorage.getItem('n3_auth');
        if (jwt)       headers['Authorization'] = 'Bearer ' + jwt;
        else if (key)  headers['X-API-Key']     = key;

        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
        try {
          const res = await fetch(`${this._apiBase}/sites/${site}/theme`, {
            method:  'PUT',
            headers,
            body:    JSON.stringify({ theme: this._theme }),
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
    }
  }

  // Register
  window._n3wareModules.N3Theme = N3Theme;

})();
