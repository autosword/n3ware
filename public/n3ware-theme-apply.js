/**
 * n3ware-theme-apply.js — Theme application: CSS vars, Tailwind, fonts, typography, logo, favicon.
 * Attaches: window._n3wareTheme.{applyCssVars, applyTailwindColors, applyFonts,
 *           applyTypography, applyLogo, applyFavicon, applyAll}
 */
(function () { 'use strict';
  window._n3wareTheme = window._n3wareTheme || {};

  /** Write CSS custom properties to :root. */
  window._n3wareTheme.applyCssVars = function applyCssVars(inst) {
    const { colors, fonts, sizes } = inst._theme;
    const bodyFontCss    = fonts.body    === 'system' ? 'system-ui,-apple-system,sans-serif' : `'${fonts.body}',sans-serif`;
    const headingFontCss = fonts.heading === 'system' ? 'system-ui,-apple-system,sans-serif' : `'${fonts.heading}',sans-serif`;

    let el = document.getElementById('n3-theme-vars');
    if (!el) {
      el    = document.createElement('style');
      el.id = 'n3-theme-vars';
      document.head.appendChild(el);
    }
    el.textContent = [
      ':root{',
      `--n3-primary:${colors.primary};`,
      `--n3-secondary:${colors.secondary};`,
      `--n3-accent:${colors.accent};`,
      `--n3-font-body:${bodyFontCss};`,
      `--n3-font-heading:${headingFontCss};`,
      `--n3-h1:${sizes.h1}px;`,
      `--n3-h2:${sizes.h2}px;`,
      `--n3-h3:${sizes.h3}px;`,
      `--n3-h4:${sizes.h4}px;`,
      `--n3-h5:${sizes.h5}px;`,
      `--n3-h6:${sizes.h6}px;`,
      `--n3-body:${sizes.body}px;`,
      '}',
    ].join('');
  };

  /** Extend Tailwind CDN config with brand colors. */
  window._n3wareTheme.applyTailwindColors = function applyTailwindColors(inst) {
    if (!window.tailwind) return;
    // Defer one tick so any in-flight CDN rebuild completes before we touch config.
    setTimeout(function () {
      try {
        // Deep-merge: preserve every existing key; only add/update brand colors.
        var cur    = window.tailwind.config || {};
        var theme  = cur.theme   || {};
        var extend = theme.extend || {};
        window.tailwind.config = Object.assign({}, cur, {
          theme: Object.assign({}, theme, {
            extend: Object.assign({}, extend, {
              colors: Object.assign({}, extend.colors || {}, {
                primary:   'var(--n3-primary)',
                secondary: 'var(--n3-secondary)',
                accent:    'var(--n3-accent)',
              }),
            }),
          }),
        });
        // Do NOT also call tailwind.refresh() — the config= setter already
        // schedules a rebuild internally. A second immediate refresh races it
        // and can produce an empty stylesheet.
      } catch (e) {
        console.warn('[n3-theme] tailwind config error:', e);
      }
    }, 0);
  };

  /** Dynamically load Google Fonts for any non-system font choices. */
  window._n3wareTheme.applyFonts = function applyFonts(inst) {
    const { body, heading } = inst._theme.fonts;
    const toLoad = new Set();
    if (body    !== 'system') toLoad.add(body);
    if (heading !== 'system') toLoad.add(heading);
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
  };

  /** Inject heading/paragraph font-size rules via a dedicated style element. */
  window._n3wareTheme.applyTypography = function applyTypography(inst) {
    let el = document.getElementById('n3-theme-typography');
    if (!el) {
      el    = document.createElement('style');
      el.id = 'n3-theme-typography';
      document.head.appendChild(el);
    }
    el.textContent = [
      'h1{font-size:var(--n3-h1)!important;}',
      'h2{font-size:var(--n3-h2)!important;}',
      'h3{font-size:var(--n3-h3)!important;}',
      'h4{font-size:var(--n3-h4)!important;}',
      'h5{font-size:var(--n3-h5)!important;}',
      'h6{font-size:var(--n3-h6)!important;}',
      'p{font-size:var(--n3-body)!important;}',
    ].join('');
  };

  /** Swap the first <img> inside <nav> and <footer> with the stored logo URL. */
  window._n3wareTheme.applyLogo = function applyLogo(inst) {
    const url = inst._theme.logoUrl;
    if (!url) return;
    [['nav', '32px'], ['footer', '40px']].forEach(([tag, h]) => {
      const container = document.querySelector(tag);
      if (!container) return;
      const img = container.querySelector('img');
      if (img) {
        img.src = url;
      } else {
        const anchor = container.querySelector('a');
        if (anchor) {
          const newImg = document.createElement('img');
          newImg.src = url;
          newImg.alt = 'Logo';
          Object.assign(newImg.style, { height: h, width: 'auto', display: 'inline-block' });
          anchor.insertBefore(newImg, anchor.firstChild);
        }
      }
    });
  };

  /** Update <link rel="icon"> in <head> with the stored favicon URL. */
  window._n3wareTheme.applyFavicon = function applyFavicon(inst) {
    const url = inst._theme.faviconUrl;
    if (!url) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link     = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
  };

  /** Apply every aspect of the current theme to the live page. */
  window._n3wareTheme.applyAll = function applyAll(inst) {
    window._n3wareTheme.applyCssVars(inst);
    window._n3wareTheme.applyTailwindColors(inst);
    window._n3wareTheme.applyFonts(inst);
    window._n3wareTheme.applyTypography(inst);
    if (inst._theme.logoUrl)    window._n3wareTheme.applyLogo(inst);
    if (inst._theme.faviconUrl) window._n3wareTheme.applyFavicon(inst);
  };

})();
