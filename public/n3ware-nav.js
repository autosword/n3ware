/**
 * n3ware-nav — Nav editor panel shell.
 * Delegates to window._n3wareNav sub-modules:
 *   n3ware-nav-persist.js  loadState / saveState
 *   n3ware-nav-render.js   parseNav / renderedHtml / render
 *   n3ware-nav-panel.js    injectStyles / buildPanel / refreshPanel /
 *                          refreshLogoPreview / refreshItemsList / wirePanel
 *
 * Data model:
 *   {
 *     brand: { text, logoUrl, href },
 *     items: [{ id, label, href, type: 'link'|'button' }, ...],
 *     cta:   { label, href, enabled }
 *   }
 */
(function () { 'use strict';

  class N3NavEditor {
    /**
     * @param {object}      events    N3Events instance
     * @param {object|null} cloudCfg  { api, site, key } or null
     */
    constructor(events, cloudCfg) {
      this._events   = events;
      this._cloud    = cloudCfg || null;
      this._panel    = null;
      this._open     = false;
      this._navEl    = null;
      this._data     = null;
      this._dragIdx  = null;
    }

    /** Inject styles, ensure <nav> has data-n3-block, load state, wire events. */
    mount() {
      window._n3wareNav.injectStyles();

      const navEl = document.querySelector('nav');
      if (navEl && !navEl.hasAttribute('data-n3-block')) {
        navEl.setAttribute('data-n3-block', '1');
      }
      window._n3wareNav.loadState(this, navEl);

      // Listen for "Edit Nav" button emitted by N3ElementControls
      if (this._events) {
        this._events.on('controls:edit-nav', el => {
          this._navEl = el || document.querySelector('nav');
          window._n3wareNav.loadState(this, this._navEl);
          this.open();
        });
      }
    }

    toggle() { this._open ? this.close() : this.open(); }

    open() {
      if (this._open) return;
      if (!this._panel) window._n3wareNav.buildPanel(this);
      window._n3wareNav.refreshPanel(this);
      this._open = true;
      this._panel.classList.remove('n3-nav-open');
      this._panel.style.removeProperty('transform');
      void this._panel.offsetHeight; // reflow — commits translateX(-100%) from CSS
      setTimeout(() => {
        if (!this._panel) return;
        this._panel.classList.add('n3-nav-open');
      }, 20);
    }

    close() {
      if (!this._open) return;
      this._open = false;
      if (this._panel) {
        this._panel.classList.remove('n3-nav-open');
        this._panel.style.removeProperty('transform');
      }
    }

    isOpen() { return this._open; }
  }

  window._n3wareModules.N3NavEditor = N3NavEditor;

})();
