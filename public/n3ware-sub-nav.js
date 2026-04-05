/**
 * n3ware-sub-nav.js — Sticky sub-nav scroll-spy with IntersectionObserver.
 *
 * Usage: add data-n3-sub-nav to any <nav> with anchor links to section IDs.
 * Active link gets class `n3-sub-nav-active`.
 *
 * The observer is paused when the editor enters edit-mode to avoid
 * interfering with drag-and-drop.
 */
(function () { 'use strict';

  // Inject active-link indicator CSS once
  (function injectSubNavCss() {
    if (document.getElementById('n3-sub-nav-css')) return;
    const s = document.createElement('style');
    s.id = 'n3-sub-nav-css';
    s.textContent = `
      [data-n3-sub-nav] a { border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }
      [data-n3-sub-nav] a.n3-sub-nav-active { color: var(--n3-primary,#3B82F6); border-bottom-color: var(--n3-primary,#3B82F6); }
    `;
    document.head.appendChild(s);
  })();

  class N3SubNav {
    /** @param {object} events  N3Events instance */
    constructor(events) {
      this._events   = events;
      this._observer = null;
      this._editing  = false;
    }

    mount() {
      this._observe();
      if (this._events) {
        this._events.on('editor:modeChange', isEditing => {
          this._editing = isEditing;
          if (isEditing) {
            this._disconnect();
          } else {
            this._observe();
          }
        });
      }
    }

    _observe() {
      this._disconnect();
      const subNavs = Array.from(document.querySelectorAll('[data-n3-sub-nav]'));
      if (!subNavs.length) return;

      // Collect all anchors → section mappings
      const entries = [];
      subNavs.forEach(nav => {
        nav.querySelectorAll('a[href^="#"]').forEach(a => {
          const id = a.getAttribute('href').slice(1);
          const target = id ? document.getElementById(id) : null;
          if (target) entries.push({ a, target, nav });
        });
      });
      if (!entries.length) return;

      // One observer for all sections — fires when section enters the sweet spot
      this._observer = new IntersectionObserver(
        (records) => {
          if (this._editing) return;
          records.forEach(rec => {
            const matched = entries.filter(e => e.target === rec.target);
            matched.forEach(({ a }) => {
              if (rec.isIntersecting) {
                // Deactivate all peers in the same sub-nav first
                const peerNav = entries.find(e => e.a === a)?.nav;
                if (peerNav) {
                  peerNav.querySelectorAll('a').forEach(peer => {
                    peer.classList.remove('n3-sub-nav-active');
                  });
                }
                a.classList.add('n3-sub-nav-active');
              }
            });
          });
        },
        { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
      );

      entries.forEach(({ target }) => this._observer.observe(target));
    }

    _disconnect() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    }
  }

  window._n3wareModules.N3SubNav = N3SubNav;

})();
