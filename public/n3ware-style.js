/**
 * n3ware-style — Style panel, toolbar, and HTML export utilities.
 * N3StylePanel, N3Toolbar, N3Export
 * Registers on window._n3wareModules.
 */
(function() { 'use strict';
  const { T, SEL, _esc, _fmtDate, _fmtNum, _fmtDur, _svgArc, N3UI } = window._n3wareModules;

  class N3StylePanel {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
      /** @type {HTMLElement|null} */
      this._panel  = null;
      /** @type {HTMLElement|null} */
      this._target = null;
    }

    /** Build and append the panel to <body>. */
    mount() {
      this._panel = this._build();
      document.body.appendChild(this._panel);
    }

    /** Remove panel from DOM. */
    unmount() { if (this._panel) { this._panel.remove(); this._panel = null; } }

    /**
     * Open the panel and sync controls to `el`.
     * @param {HTMLElement} el
     */
    open(el) {
      this._target = el;
      if (this._panel) { this._panel.classList.add('n3-panel-open'); this._sync(el); }
    }

    /** Close panel and clear target. */
    close() { this._target = null; if (this._panel) this._panel.classList.remove('n3-panel-open'); }

    /** @returns {boolean} */
    isOpen() { return !!(this._panel && this._panel.classList.contains('n3-panel-open')); }

    // ── Private ──────────────────────────────────────────────────────────────

    _build() {
      const _ic = (n, s) => { const f = (window._n3wareModules||{}).icon; return f ? f(n, {size: s||18}) : ''; };
      const p = document.createElement('div');
      p.className = 'n3-style-panel';
      p.setAttribute('data-n3-ui', '1');
      p.innerHTML = `
        <div class="n3-panel-header">
          <div><div class="n3-panel-title">Style</div></div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="n3-panel-tag" id="n3-sel-tag">—</span>
            <button class="n3-panel-close" id="n3-panel-close" style="display:inline-flex;align-items:center;justify-content:center">${_ic('x', 18)}</button>
          </div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">Colors</div>
          <div class="n3-field"><div class="n3-field-label">Background</div><input type="color" id="n3-bg-color" class="n3-panel-color"></div>
          <div class="n3-field"><div class="n3-field-label">Text Color</div><input type="color" id="n3-text-color" class="n3-panel-color"></div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">Spacing</div>
          <div class="n3-field"><div class="n3-field-label">Padding <span class="n3-field-value" id="n3-pad-val">0px</span></div><input type="range" class="n3-slider" id="n3-padding" min="0" max="80" value="0"></div>
          <div class="n3-field"><div class="n3-field-label">Margin <span class="n3-field-value" id="n3-mar-val">0px</span></div><input type="range" class="n3-slider" id="n3-margin" min="0" max="80" value="0"></div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">Appearance</div>
          <div class="n3-field"><div class="n3-field-label">Border Radius <span class="n3-field-value" id="n3-rad-val">0px</span></div><input type="range" class="n3-slider" id="n3-radius" min="0" max="50" value="0"></div>
          <div class="n3-field"><div class="n3-field-label">Opacity <span class="n3-field-value" id="n3-opa-val">100%</span></div><input type="range" class="n3-slider" id="n3-opacity" min="0" max="100" value="100"></div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">CSS Classes</div>
          <div class="n3-field"><input type="text" class="n3-class-input" id="n3-classes" placeholder="container hero flex"></div>
        </div>`;

      const panelCloseBtn = p.querySelector('#n3-panel-close');
      panelCloseBtn.onclick = () => this._events.emit('panel:close');
      panelCloseBtn.addEventListener('touchend', e => { e.preventDefault(); this._events.emit('panel:close'); });
      this._wireColor(p, '#n3-bg-color',   v => this._apply('backgroundColor', v));
      this._wireColor(p, '#n3-text-color', v => this._apply('color', v));
      this._wireSlider(p, '#n3-padding', '#n3-pad-val', 'padding',      'px');
      this._wireSlider(p, '#n3-margin',  '#n3-mar-val', 'margin',       'px');
      this._wireSlider(p, '#n3-radius',  '#n3-rad-val', 'borderRadius', 'px');
      p.querySelector('#n3-opacity').oninput = e => {
        p.querySelector('#n3-opa-val').textContent = e.target.value + '%';
        if (this._target) { this._target.style.opacity = e.target.value / 100; this._events.emit('style:change'); }
      };
      p.querySelector('#n3-classes').oninput = e => {
        if (!this._target) return;
        const kept = Array.from(this._target.classList).filter(c => c.startsWith('n3-'));
        this._target.className = '';
        kept.forEach(c => this._target.classList.add(c));
        e.target.value.trim().split(/\s+/).filter(Boolean).forEach(c => this._target.classList.add(c));
        this._events.emit('style:change');
      };
      return p;
    }

    _wireColor(p, sel, setter) {
      p.querySelector(sel).oninput = e => { setter(e.target.value); this._events.emit('style:change'); };
    }

    _wireSlider(p, sliderId, valId, prop, unit) {
      p.querySelector(sliderId).oninput = e => {
        p.querySelector(valId).textContent = e.target.value + unit;
        if (this._target) { this._target.style[prop] = e.target.value + unit; this._events.emit('style:change'); }
      };
    }

    _apply(prop, val) { if (this._target) this._target.style[prop] = val; }

    _sync(el) {
      if (!this._panel) return;
      const cs = window.getComputedStyle(el);
      const tag = this._panel.querySelector('#n3-sel-tag');
      if (tag) tag.textContent = el.tagName.toLowerCase();

      const toHex = c => {
        if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return '#ffffff';
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const ctx = cv.getContext('2d'); ctx.fillStyle = c; ctx.fillRect(0,0,1,1);
        const d = ctx.getImageData(0,0,1,1).data;
        return '#' + [d[0],d[1],d[2]].map(x => x.toString(16).padStart(2,'0')).join('');
      };

      const sv = (id, v) => { const e = this._panel.querySelector(id); if (e) e.value = v; };
      const st = (id, v) => { const e = this._panel.querySelector(id); if (e) e.textContent = v; };

      sv('#n3-bg-color',   toHex(cs.backgroundColor));
      sv('#n3-text-color', toHex(cs.color));
      const pad = parseInt(cs.paddingTop)   || 0;
      const mar = parseInt(cs.marginTop)    || 0;
      const rad = parseInt(cs.borderRadius) || 0;
      const opa = Math.round((parseFloat(cs.opacity) || 1) * 100);
      sv('#n3-padding', pad); st('#n3-pad-val', pad + 'px');
      sv('#n3-margin',  mar); st('#n3-mar-val', mar + 'px');
      sv('#n3-radius',  rad); st('#n3-rad-val', rad + 'px');
      sv('#n3-opacity', opa); st('#n3-opa-val', opa + '%');
      const ci = this._panel.querySelector('#n3-classes');
      if (ci) ci.value = Array.from(el.classList).filter(c => !c.startsWith('n3-')).join(' ');
    }
  }

  class N3Toolbar {
    /**
     * @param {N3Events} events
     * @param {{cloud:boolean}} [opts]
     */
    constructor(events, opts) {
      this._events = events;
      this._cloud  = !!(opts && opts.cloud);
      /** @type {HTMLElement|null} */
      this._el = null;
      /** @type {string|null} original body paddingTop before toolbar shown */
      this._origBodyPad = null;
    }

    /** Build and append toolbar to <body>. */
    mount() {
      this._el = document.createElement('div');
      this._el.className = 'n3-toolbar';
      this._el.setAttribute('data-n3-ui', '1');
      const _ic = (n, s) => { const f = (window._n3wareModules||{}).icon; return f ? f(n, {size: s||18}) : ''; };
      const desktopBtns = this._cloud
        ? `<button class="n3-toolbar-btn n3-cloud-btn n3-mob-hide" data-action="cloud-save" title="Publish to cloud">☁ Publish</button>
           <button class="n3-toolbar-btn n3-mob-hide" data-action="cloud-revisions" title="Revision history">↺ History</button>
           <button class="n3-toolbar-btn n3-mob-hide" data-action="save-html" title="Download HTML backup">⬇ Download</button>`
        : `<button class="n3-toolbar-btn n3-mob-hide" data-action="save-html">⬇ Download</button>`;
      const mobMenuItems = this._cloud
        ? `<button class="n3-mob-dd-btn" data-action="cloud-save">☁ Publish</button>
           <button class="n3-mob-dd-btn" data-action="cloud-revisions">↺ History</button>
           <button class="n3-mob-dd-btn" data-action="save-html">⬇ Download</button>
           <button class="n3-mob-dd-btn" data-action="copy-html">⎘ Copy HTML</button>
           <button class="n3-mob-dd-btn" data-action="json-diff">{ } Diff</button>`
        : `<button class="n3-mob-dd-btn" data-action="save-html">⬇ Download</button>
           <button class="n3-mob-dd-btn" data-action="copy-html">⎘ Copy HTML</button>
           <button class="n3-mob-dd-btn" data-action="json-diff">{ } Diff</button>`;
      this._el.innerHTML = `
        <span class="n3-toolbar-logo">n3ware</span>
        <div class="n3-toolbar-sep"></div>
        <button class="n3-toolbar-btn" data-action="undo" title="Undo (Ctrl+Z)">↩ Undo</button>
        <button class="n3-toolbar-btn" data-action="redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
        <span class="n3-history-count">1/1</span>
        <div class="n3-toolbar-sep"></div>
        ${desktopBtns}
        <button class="n3-toolbar-btn n3-mob-hide" data-action="copy-html">⎘ Copy HTML</button>
        <button class="n3-toolbar-btn n3-mob-hide" data-action="json-diff">{ } Diff</button>
        <button class="n3-toolbar-btn n3-mob-show" data-action="mob-menu" title="More options" style="display:inline-flex;align-items:center;justify-content:center;min-width:36px">${_ic('menu', 20)}</button>
        <div class="n3-toolbar-spacer"></div>
        <button class="n3-toolbar-btn n3-danger" data-action="exit-edit" style="display:inline-flex;align-items:center;gap:4px">${_ic('x', 16)} Exit</button>
        <div class="n3-mob-dropdown" id="n3-mob-dropdown">${mobMenuItems}</div>`;
      this._el.addEventListener('click', e => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const dd = this._el.querySelector('#n3-mob-dropdown');
        if (b.dataset.action === 'mob-menu') {
          if (dd) dd.classList.toggle('n3-mob-open');
          return;
        }
        if (dd) dd.classList.remove('n3-mob-open');
        this._events.emit('toolbar:action', b.dataset.action);
      });
      // Close mob dropdown when clicking outside toolbar
      document.addEventListener('click', e => {
        if (!this._el) return;
        const dd = this._el.querySelector('#n3-mob-dropdown');
        if (dd && dd.classList.contains('n3-mob-open') && !this._el.contains(e.target)) {
          dd.classList.remove('n3-mob-open');
        }
      }, true);
      document.body.appendChild(this._el);
    }

    /** Remove toolbar from DOM. */
    unmount() { if (this._el) { this._el.remove(); this._el = null; } }

    /** Slide toolbar into view and push body content down by 48 px. */
    show() {
      if (this._el) this._el.classList.add('n3-visible');
      if (this._origBodyPad === null) {
        this._origBodyPad = document.body.style.paddingTop;
        const cur = parseInt(getComputedStyle(document.body).paddingTop) || 0;
        // Save scroll position before padding change to prevent jump.
        const scrollY = window.scrollY;
        document.body.style.paddingTop = (cur + 48) + 'px';
        window.scrollTo({ top: scrollY + 48, behavior: 'instant' });
      }
    }

    /** Slide toolbar out of view and restore original body padding. */
    hide() {
      if (this._el) this._el.classList.remove('n3-visible');
      if (this._origBodyPad !== null) {
        const scrollY = window.scrollY;
        document.body.style.paddingTop = this._origBodyPad;
        // Restore scroll, compensating for the 48px padding we removed.
        window.scrollTo({ top: Math.max(0, scrollY - 48), behavior: 'instant' });
        this._origBodyPad = null;
      }
    }

    /**
     * Update the undo/redo counter badge.
     * @param {{index:number, total:number}} state
     */
    updateHistory(state) {
      const el = this._el && this._el.querySelector('.n3-history-count');
      if (el) el.textContent = `${state.index + 1}/${state.total}`;
    }
  }

  class N3Export {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
    }

    /**
     * Clone the full document and strip all editor artifacts.
     * @returns {string} clean HTML string suitable for saving/copying
     */
    cleanHTML() {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-n3-ui]').forEach(e => e.remove());
      clone.querySelectorAll('#n3ware-styles').forEach(e => e.remove());
      clone.querySelectorAll('.n3-controls,.n3-format-bar,.n3-drop-line,.n3-toast').forEach(e => e.remove());
      clone.querySelectorAll('[data-n3-editable]').forEach(e => {
        e.removeAttribute('data-n3-editable');
        e.removeAttribute('contenteditable');
        e.removeAttribute('spellcheck');
      });
      clone.querySelectorAll('[data-n3-block]').forEach(e => e.removeAttribute('data-n3-block'));
      ['n3-hovered','n3-selected','n3-dragging'].forEach(c =>
        clone.querySelectorAll(`.${c}`).forEach(e => e.classList.remove(c))
      );
      clone.querySelector('body').classList.remove('n3-editing');
      return '<!DOCTYPE html>\n' + clone.outerHTML;
    }

    /**
     * Trigger a file download of the clean HTML.
     * @param {string} [filename]
     */
    downloadHTML(filename) {
      const html = this.cleanHTML();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = filename || (document.title || 'page') + '-edited.html';
      a.click();
      N3UI.toast('Downloaded!', 'success');
      this._events.emit('export:download');
    }

    /** Copy clean HTML to clipboard. */
    async copyHTML() {
      try {
        await navigator.clipboard.writeText(this.cleanHTML());
        N3UI.toast('HTML copied to clipboard', 'success');
        this._events.emit('export:copy');
      } catch (_) {
        N3UI.toast('Copy failed — try downloading instead', 'error');
      }
    }

    /**
     * Compute a structural diff between two HTML strings.
     * @param {string} before
     * @param {string} after
     * @returns {Array<{index:number,tag:string,before:string,after:string,styleChanged:boolean}>}
     */
    diff(before, after) {
      const parse = html => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('*');
      const bEls = parse(before), aEls = parse(after);
      const changes = [];
      for (let i = 0, len = Math.min(bEls.length, aEls.length); i < len; i++) {
        if (bEls[i].outerHTML !== aEls[i].outerHTML) {
          changes.push({
            index:        i,
            tag:          aEls[i].tagName.toLowerCase(),
            before:       bEls[i].textContent.trim().slice(0, 80),
            after:        aEls[i].textContent.trim().slice(0, 80),
            styleChanged: bEls[i].getAttribute('style') !== aEls[i].getAttribute('style'),
          });
        }
      }
      return changes;
    }

    /**
     * Download a JSON diff between `initialHTML` and current DOM.
     * @param {string} initialHTML
     */
    downloadDiff(initialHTML) {
      const changes = this.diff(initialHTML, this.cleanHTML());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(changes, null, 2)], { type: 'application/json' }));
      a.download = 'n3ware-diff.json';
      a.click();
      N3UI.toast(`${changes.length} change(s) exported`, 'info');
      this._events.emit('export:diff', changes);
    }
  }

  Object.assign(window._n3wareModules, { N3StylePanel, N3Toolbar, N3Export });
})();
