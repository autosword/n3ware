/**
 * n3ware-content.js — Content manager orchestrator.
 * Coordinates CSS injection, panel, renderer, and live preview.
 * Registers: window._n3wareModules.N3ContentManager
 */
(function () { 'use strict';
  window._n3wareModules = window._n3wareModules || {};

  class N3ContentManager {
    constructor() {
      this._panel    = null;
      this._renderer = null;
      this._open     = false;
      this._siteId   = null;
      this._apiKey   = null;
      // WeakMap: element → original template HTML (base64)
      this._templateMap = new WeakMap();
    }

    /**
     * Initialise the content system.
     * Called from N3Editor.init() after modules are loaded.
     *
     * @param {string} siteId
     * @param {string} apiKey
     * @param {Object} allModules  { editor, ... }
     */
    init(siteId, apiKey, allModules) {
      this._siteId = siteId;
      this._apiKey = apiKey;

      // Inject CSS
      const M = window._n3wareModules;
      if (M.injectContentCSS) M.injectContentCSS();

      // Create panel controller
      if (M.N3ContentPanel) {
        this._panel = new M.N3ContentPanel(siteId, apiKey, allModules);
      }

      // Renderer reference (static class)
      this._renderer = M.N3ContentRender || null;

      // Run live preview once the DOM is fully ready
      if (this._renderer) {
        this._renderLivePreview();
      }

      // Re-render after component inserts
      document.addEventListener('n3:insert-html', () => {
        setTimeout(() => this._renderLivePreview(), 100);
      });
    }

    // ── Panel open/close/toggle ──────────────────────────────────────────────

    open() {
      if (!this._panel) return;
      this._panel.open();
      this._open = true;
    }

    close() {
      if (!this._panel) return;
      this._panel.close();
      this._open = false;
    }

    toggle() {
      this._open ? this.close() : this.open();
    }

    isOpen() {
      return this._open;
    }

    // ── Collections access ───────────────────────────────────────────────────

    async getCollections() {
      if (this._panel) return this._panel._collections;
      return [];
    }

    /** For component picker: return collection templates */
    getCollectionTemplates() {
      if (!this._panel) return [];
      return (this._panel._collections || []).map(col => ({
        id:         `collection:${col.slug}`,
        name:       col.name,
        category:   'dynamic',
        entryCount: col.entryCount ?? 0,
        collection: col,
      }));
    }

    /**
     * Generate default template HTML for a collection and dispatch
     * an insert event so the editor can place it on the page.
     * @param {Object} collection
     */
    async insertCollectionBlock(collection) {
      if (!this._panel) return;
      const html = this._panel._generateDefaultTemplate(collection);
      document.dispatchEvent(new CustomEvent('n3:insert-html', { detail: { html } }));
    }

    // ── Live preview rendering ───────────────────────────────────────────────

    /**
     * Walk the page for elements containing {{#each slug}} template text,
     * fetch entries for each referenced slug, and render real data in place.
     * The original template is stored in dataset.n3Template (base64) so it
     * can be restored before saving.
     */
    async _renderLivePreview() {
      if (!this._renderer || !this._siteId) return;

      // Find all collection block elements (by data attribute OR template markers)
      const blockEls = Array.from(document.querySelectorAll('[data-n3-collection]'));

      // Also scan all elements for {{#each}} text nodes (for inline templates)
      document.querySelectorAll('*').forEach(el => {
        if (el.hasAttribute('data-n3-ui')) return; // skip editor UI
        if (this._renderer.findSlugs(el.innerHTML).length > 0 &&
            !el.hasAttribute('data-n3-collection') &&
            !blockEls.includes(el)) {
          blockEls.push(el);
        }
      });

      if (!blockEls.length) return;

      // Collect unique slugs
      const allSlugs = new Set();
      blockEls.forEach(el => {
        const src = el.dataset.n3Template
          ? atob(el.dataset.n3Template)
          : el.outerHTML;
        this._renderer.findSlugs(src).forEach(s => allSlugs.add(s));
      });

      if (!allSlugs.size) return;

      // Fetch entries for each slug in parallel
      const collectionsData = {};
      await Promise.all(Array.from(allSlugs).map(async slug => {
        try {
          const headers = this._apiKey ? { 'X-Api-Key': this._apiKey } : {};
          const r = await fetch(`/api/sites/${this._siteId}/collections/${slug}/entries`, { headers });
          if (!r.ok) return;
          const d = await r.json();
          collectionsData[slug] = d.entries || [];
        } catch (_) {}
      }));

      // Render each element
      blockEls.forEach(el => {
        // Save original template if not already saved
        if (!el.dataset.n3Template) {
          el.dataset.n3Template = btoa(unescape(encodeURIComponent(el.innerHTML)));
        }
        const template = decodeURIComponent(escape(atob(el.dataset.n3Template)));
        try {
          el.innerHTML = this._renderer.renderTemplate(template, collectionsData);
        } catch (e) {
          console.warn('[n3-content] render failed for element:', e.message);
        }
      });
    }

    /**
     * Before extracting page HTML to save, restore collection block elements
     * to their raw template HTML (removing rendered entry data).
     * Call this before the save extraction, then call restoreAfterSave() after.
     */
    prepareForSave() {
      document.querySelectorAll('[data-n3-template]').forEach(el => {
        try {
          el.innerHTML = decodeURIComponent(escape(atob(el.dataset.n3Template)));
        } catch (_) {}
      });
    }

    /**
     * After save extraction is complete, re-render live preview.
     */
    restoreAfterSave() {
      this._renderLivePreview();
    }
  }

  window._n3wareModules.N3ContentManager = N3ContentManager;

})();
