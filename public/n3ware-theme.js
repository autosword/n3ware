/**
 * n3ware-theme — Theme panel: colors, typography, font sizes, brand assets.
 * Shell class — delegates heavy lifting to window._n3wareTheme sub-modules:
 *   n3ware-theme-css.js     injectStyles
 *   n3ware-theme-persist.js loadState / saveToStorage / save
 *   n3ware-theme-apply.js   applyCssVars / applyTailwindColors / applyFonts /
 *                           applyTypography / applyLogo / applyFavicon / applyAll
 *   n3ware-theme-panel.js   buildPanel / wirePanel / refreshInputs
 *
 * Data model:
 *   {
 *     colors:    { primary, secondary, accent },
 *     logoUrl:   null | base64DataUrl,
 *     faviconUrl: null | base64DataUrl,
 *     fonts:     { heading: 'system'|fontName, body: 'system'|fontName },
 *     sizes:     { h1:60, h2:48, h3:36, h4:28, h5:22, h6:18, body:16 }  // px
 *   }
 */
(function () { 'use strict';

  class N3Theme {
    /**
     * @param {import('./n3ware').N3Events} events
     * @param {{ api:string, site:string, key:string }|null} cloudCfg
     */
    constructor(events, cloudCfg) {
      this._events   = events;
      this._cloudCfg = cloudCfg;
      this._panel    = null;
      this._open     = false;
      this._apiBase  = cloudCfg ? cloudCfg.api.replace(/\/$/, '') : '/api';

      this._theme = window._n3wareTheme.cloneDefaults();
      window._n3wareTheme.loadState(this);
    }

    /** Insert panel DOM and apply stored theme to the page. */
    mount() {
      window._n3wareTheme.injectStyles();
      if (!this._panel) window._n3wareTheme.buildPanel(this);
      window._n3wareTheme.applyAll(this);
    }

    toggle() { this._open ? this.close() : this.open(); }

    open() {
      if (this._open) return;
      if (!this._panel) window._n3wareTheme.buildPanel(this);
      window._n3wareTheme.refreshInputs(this);
      this._open = true;
      this._panel.classList.remove('n3-theme-open');
      this._panel.style.removeProperty('transform');
      void this._panel.offsetHeight; // reflow — commits translateX(-100%) from CSS
      setTimeout(() => {
        if (!this._panel) return;
        this._panel.classList.add('n3-theme-open');
      }, 20);
    }

    close() {
      if (!this._open) return;
      this._open = false;
      if (this._panel) {
        this._panel.classList.remove('n3-theme-open');
        this._panel.style.removeProperty('transform');
      }
    }

    isOpen() { return this._open; }
  }

  // Register
  window._n3wareModules.N3Theme = N3Theme;

})();
