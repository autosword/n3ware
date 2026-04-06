/**
 * n3ware-content-render.js — Client-side template renderer.
 * Mirrors the assembler's Go template logic in JavaScript for live editor preview.
 * Registers: window._n3wareModules.N3ContentRender
 */
(function () { 'use strict';
  window._n3wareModules = window._n3wareModules || {};

  class N3ContentRender {
    /**
     * Render a Handlebars-like template string with real entry data.
     * Supports:
     *   {{#each slug limit=N sort="field:dir"}}...{{/each}}
     *   {{#if field}}...{{else}}...{{/if}}
     *   {{this.field}}  — HTML escaped
     *   {{{this.field}}} — unescaped
     *   {{site.name}}  — from window._n3wareSiteManifest
     *   {{slug.count}} — length of collectionsData[slug]
     *
     * @param {string} html
     * @param {Object} collectionsData  { slug: [entry, ...] }
     * @returns {string}
     */
    static renderTemplate(html, collectionsData) {
      collectionsData = collectionsData || {};

      // Process {{#each slug ...}}...{{/each}} blocks
      html = N3ContentRender._processEach(html, collectionsData);

      // Process remaining {{site.*}} and {{slug.count}} tokens
      html = N3ContentRender._processTokens(html, {}, collectionsData);

      return html;
    }

    /**
     * Process all {{#each ...}}...{{/each}} blocks recursively.
     * @private
     */
    static _processEach(html, collectionsData) {
      // Match the outermost #each blocks (non-greedy inner content)
      const eachRe = /\{\{#each\s+(\w+)([^}]*)\}\}([\s\S]*?)\{\{\/each\}\}/g;
      return html.replace(eachRe, (match, slug, paramsStr, innerTemplate) => {
        let entries = (collectionsData[slug] || []).slice(); // copy

        // Parse limit= and sort= params
        const limitMatch = paramsStr.match(/limit\s*=\s*(\d+)/);
        const sortMatch  = paramsStr.match(/sort\s*=\s*["']([^"']+)["']/);

        if (sortMatch) {
          const [sortField, sortDir] = sortMatch[1].split(':');
          const dir = (sortDir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
          entries.sort((a, b) => {
            const av = a[sortField] ?? '';
            const bv = b[sortField] ?? '';
            if (av < bv) return -1 * dir;
            if (av > bv) return  1 * dir;
            return 0;
          });
        }

        if (limitMatch) {
          entries = entries.slice(0, parseInt(limitMatch[1], 10));
        }

        if (!entries.length) return '';

        return entries.map(entry => {
          // Render inner template for this entry context
          let inner = innerTemplate;
          // Recurse to handle nested #each (with the same collectionsData)
          inner = N3ContentRender._processEach(inner, collectionsData);
          // Process {{#if field}}...{{/if}} inside this entry context
          inner = N3ContentRender._processIf(inner, entry, collectionsData);
          // Process tokens in entry context
          inner = N3ContentRender._processTokens(inner, entry, collectionsData);
          return inner;
        }).join('');
      });
    }

    /**
     * Process {{#if field}}...{{else}}...{{/if}} blocks.
     * @private
     */
    static _processIf(html, context, collectionsData) {
      const ifRe = /\{\{#if\s+(\S+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
      return html.replace(ifRe, (match, path, truePart, falsePart) => {
        const val = N3ContentRender.resolve(path, context, collectionsData);
        const truthy = val !== '' && val !== false && val !== null && val !== undefined && val !== 0 && val !== '0';
        let result = truthy ? truePart : (falsePart || '');
        // Recurse into the chosen branch
        result = N3ContentRender._processIf(result, context, collectionsData);
        result = N3ContentRender._processTokens(result, context, collectionsData);
        return result;
      });
    }

    /**
     * Replace all {{...}} and {{{...}}} tokens in a string.
     * @private
     */
    static _processTokens(html, context, collectionsData) {
      // Unescaped triple-stache first
      html = html.replace(/\{\{\{([\s\S]+?)\}\}\}/g, (match, path) => {
        path = path.trim();
        const val = N3ContentRender.resolve(path, context, collectionsData);
        return val === '' ? '' : String(val);
      });

      // Escaped double-stache
      html = html.replace(/\{\{([^#/!>][^}]*)\}\}/g, (match, path) => {
        path = path.trim();
        // Skip block helpers that weren't consumed
        if (path.startsWith('#') || path.startsWith('/')) return match;
        const val = N3ContentRender.resolve(path, context, collectionsData);
        return val === '' ? '' : N3ContentRender.esc(val);
      });

      return html;
    }

    /**
     * Find all collection slugs referenced in HTML via {{#each slug}}.
     * @param {string} html
     * @returns {string[]}
     */
    static findSlugs(html) {
      const matches = [];
      const re = /\{\{#each\s+(\w+)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (!matches.includes(m[1])) matches.push(m[1]);
      }
      return matches;
    }

    /**
     * HTML-escape a value.
     * @param {*} s
     * @returns {string}
     */
    static esc(s) {
      return String(s)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
    }

    /**
     * Resolve a template path against the current context / collections.
     * @param {string} path          e.g. "this.name", "site.name", "posts.count"
     * @param {Object} context       current entry object
     * @param {Object} collectionsData
     * @returns {string|number}
     */
    static resolve(path, context, collectionsData) {
      path = (path || '').trim();

      if (path.startsWith('this.')) {
        return context[path.slice(5)] ?? '';
      }

      if (path.startsWith('site.')) {
        const parts = path.slice(5).split('.');
        let val = window._n3wareSiteManifest || {};
        for (const k of parts) val = (val && typeof val === 'object') ? val[k] : '';
        return val ?? '';
      }

      const countMatch = path.match(/^(\w+)\.count$/);
      if (countMatch) {
        return (collectionsData[countMatch[1]] || []).length;
      }

      // Bare field name — look in context
      if (context && Object.prototype.hasOwnProperty.call(context, path)) {
        return context[path] ?? '';
      }

      return '';
    }
  }

  window._n3wareModules.N3ContentRender = N3ContentRender;

})();
