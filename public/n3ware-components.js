/**
 * n3ware-components — Component library, cloud save, and revision history.
 * N3Components, N3Cloud, N3RevisionsPanel (alias: N3RevPanel)
 * Registers on window._n3wareModules.
 */
(function() { 'use strict';
  const { T, SEL, _esc, _fmtDate, _fmtNum, _fmtDur, _svgArc, N3UI } = window._n3wareModules;

  class N3Cloud {
    /**
     * @param {string} apiBase   e.g. 'https://n3ware.onrender.com/api'
     * @param {string} siteId    site identifier
     * @param {string} apiKey    site API key
     */
    constructor(apiBase, siteId, apiKey) {
      this._api    = apiBase.replace(/\/$/, '');
      this._site   = siteId;
      this._key    = apiKey;
    }

    /**
     * POST clean HTML to the save endpoint.
     * @param {string} html
     * @param {string} [message]
     * @returns {Promise<{site:object}>}
     */
    async save(html, message = '') {
      const res = await fetch(`${this._api}/sites/${this._site}/save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this._key },
        body:    JSON.stringify({ html, message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    }

    /**
     * GET revision list.
     * @returns {Promise<object[]>}
     */
    async listRevisions() {
      const res = await fetch(`${this._api}/sites/${this._site}/revisions`, {
        headers: { 'X-API-Key': this._key },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.revisions || [];
    }

    /**
     * POST rollback to a revision.
     * @param {string} revId
     * @returns {Promise<object>}
     */
    async rollback(revId) {
      const res = await fetch(
        `${this._api}/sites/${this._site}/revisions/${revId}/rollback`,
        { method: 'POST', headers: { 'X-API-Key': this._key } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    }
  }

  class N3RevPanel {
    /**
     * @param {N3Events} events
     * @param {N3Cloud}  cloud
     */
    constructor(events, cloud) {
      this._events = events;
      this._cloud  = cloud;
      this._el     = null;
      this._open   = false;
    }

    /** Inject the revisions panel into the DOM. */
    mount() {
      const _ic = (n, s) => { const f = (window._n3wareModules||{}).icon; return f ? f(n, {size: s||18}) : ''; };
      this._el = document.createElement('div');
      this._el.className = 'n3-rev-panel';
      this._el.setAttribute('data-n3-ui', '1');
      this._el.innerHTML = `
        <div class="n3-rev-header">
          <span>Revision History</span>
          <button class="n3-rev-close" title="Close" style="display:inline-flex;align-items:center;justify-content:center">${_ic('x', 18)}</button>
        </div>
        <div class="n3-rev-list"><p class="n3-rev-empty">Loading…</p></div>`;
      this._el.querySelector('.n3-rev-close').addEventListener('click', () => this.close());
      document.body.appendChild(this._el);
    }

    /** Remove the panel from DOM. */
    unmount() { if (this._el) { this._el.remove(); this._el = null; } }

    /** Open the panel and load revisions. */
    async open() {
      if (!this._el) return;
      this._el.classList.add('n3-rev-visible');
      this._open = true;
      await this._load();
    }

    /** Close the panel. */
    close() {
      if (this._el) this._el.classList.remove('n3-rev-visible');
      this._open = false;
    }

    /** Toggle open/closed state. */
    toggle() { this._open ? this.close() : this.open(); }

    /** @private */
    async _load() {
      const list = this._el.querySelector('.n3-rev-list');
      list.innerHTML = '<p class="n3-rev-empty">Loading…</p>';
      try {
        const revisions = await this._cloud.listRevisions();
        if (!revisions.length) {
          list.innerHTML = '<p class="n3-rev-empty">No revisions yet.</p>';
          return;
        }
        const revHtml = revisions.map(r => `
          <div class="n3-rev-item" data-rev-id="${_esc(r.id)}">
            <div class="n3-rev-meta">
              <span class="n3-rev-ts">${_fmtDate(r.createdAt)}</span>
              <span class="n3-rev-msg">${_esc(r.message || 'Saved')}</span>
            </div>
            <button class="n3-toolbar-btn n3-rev-rollback-btn" data-rev-id="${_esc(r.id)}">↺ Restore</button>
          </div>`).join('');
        list.innerHTML = revHtml;
        list.querySelectorAll('.n3-rev-rollback-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Restore this revision? The page will reload.')) return;
            btn.textContent = '…';
            btn.disabled = true;
            try {
              await this._cloud.rollback(btn.dataset.revId);
              N3UI.toast('Restored! Reloading…', 'success', 2000);
              setTimeout(() => location.reload(), 1500);
            } catch (e) {
              N3UI.toast('Rollback failed: ' + e.message, 'error');
              btn.textContent = '↺ Restore';
              btn.disabled = false;
            }
          });
        });
      } catch (e) {
        list.innerHTML = `<p class="n3-rev-empty">Error: ${_esc(e.message)}</p>`;
      }
    }
  }

  class N3Components {
    /**
     * @param {N3Events} events
     * @param {{ api: string, site: string, key: string }|null} cloudCfg
     */
    constructor(events, cloudCfg) {
      this._events       = events;
      this._apiBase      = cloudCfg ? cloudCfg.api.replace(/\/$/, '') : '/api';
      this._el           = null;
      this._open         = false;
      this._components   = [];
      this._loaded       = false;
      this._filter       = '';
      this._category     = 'all';
      this._dragging     = null;   // html string while dragging
      this._dropTarget   = null;   // highlighted block element
      // Customize modal state
      this._custModal    = null;   // backdrop element while modal is open
      this._custImages   = [];     // [{file, objectUrl}] pending uploads
      // Placement mode state
      this._placing      = null;   // { comp, html } while in placement mode
      this._placeCursor  = null;   // floating cursor element
      this._placeZones   = [];     // [{el, y, ref, before}] drop zone descriptors
      this._placeZoneEls = [];     // zone bar DOM elements
      this._activeZone   = -1;     // index of currently highlighted zone
      this._onPlaceMove  = null;
      this._onPlaceClick = null;
      this._onPlaceKey   = null;
    }

    /** Append the panel to the document body. */
    mount() {
      this._el = document.createElement('div');
      this._el.className = 'n3-comp-panel';
      this._el.setAttribute('data-n3-ui', '1');
      const compSkel = this._skeleton();
      this._el.innerHTML = compSkel;

      this._el.querySelector('.n3-comp-close')
        .addEventListener('click', () => this.close());

      this._el.querySelector('.n3-comp-search')
        .addEventListener('input', e => {
          this._filter = e.target.value.toLowerCase();
          this._renderList();
        });

      this._el.querySelector('.n3-comp-cats')
        .addEventListener('click', e => {
          const btn = e.target.closest('.n3-comp-cat-btn');
          if (!btn) return;
          this._category = btn.dataset.cat;
          this._el.querySelectorAll('.n3-comp-cat-btn').forEach(b =>
            b.classList.toggle('n3-comp-cat-on', b.dataset.cat === this._category)
          );
          this._renderList();
        });

      document.body.appendChild(this._el);

      // Global drag-over / drop handlers for inserting components onto the page
      document.addEventListener('dragover', this._onDragOver = e => {
        if (!this._dragging) return;
        const block = e.target.closest('[data-n3-block]');
        if (block && !N3UI.isEditorEl(block)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (block !== this._dropTarget) {
            if (this._dropTarget) this._dropTarget.classList.remove('n3-comp-drop-target');
            block.classList.add('n3-comp-drop-target');
            this._dropTarget = block;
          }
        }
      });

      document.addEventListener('drop', this._onDrop = e => {
        const html = e.dataTransfer && e.dataTransfer.getData('application/n3-component');
        if (!html) return;
        e.preventDefault();
        const target = this._dropTarget || e.target.closest('[data-n3-block]') || null;
        if (this._dropTarget) { this._dropTarget.classList.remove('n3-comp-drop-target'); this._dropTarget = null; }
        this._insert(html, target);
        N3UI.toast('Component added', 'success', 2000);
        this._dragging = null;
      });
    }

    /** Toggle open/closed state. */
    toggle() { this._open ? this.close() : this.open(); }

    /** Open the component panel and load components if not yet loaded. */
    open() {
      if (!this._el) return;
      // Force browser to commit closed state before adding open class so transition fires on first call.
      this._el.classList.remove('n3-comp-open');
      void this._el.offsetHeight; // reflow — commits closed state
      setTimeout(() => {
        this._el.classList.add('n3-comp-open');
        this._open = true;
        if (!this._loaded) this._load();
      }, 0);
    }

    /** Close the component panel. */
    close() {
      if (!this._el) return;
      this._el.classList.remove('n3-comp-open');
      this._open = false;
    }

    /** @returns {boolean} */
    isOpen() { return this._open; }

    // ── Private ────────────────────────────────────────────────────────────────

    _skeleton() {
      const _ic = (n, s) => { const f = (window._n3wareModules||{}).icon; return f ? f(n, {size: s||18}) : ''; };
      return [
        `<div class="n3-comp-hdr">`,
        `  <div class="n3-comp-title" style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex">${_ic('puzzle', 18)}</span> Components</div>`,
        `  <button class="n3-comp-close" title="Close" style="display:inline-flex;align-items:center;justify-content:center">${_ic('x', 18)}</button>`,
        `</div>`,
        `<div class="n3-comp-search-wrap">`,
        `  <input class="n3-comp-search" type="text" placeholder="Search…" autocomplete="off">`,
        `</div>`,
        `<div class="n3-comp-cats"></div>`,
        `<div class="n3-comp-list"><div class="n3-comp-empty">Loading components…</div></div>`,
      ].join('');
    }

    async _load() {
      try {
        const res = await fetch(`${this._apiBase}/components`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this._components = await res.json();
        this._loaded     = true;
        this._renderCats();
        this._renderList();
      } catch (err) {
        const listEl = this._el.querySelector('.n3-comp-list');
        listEl.innerHTML = `<div class="n3-comp-empty">Could not load components.<br><small>${err.message}</small></div>`;
      }
    }

    _renderCats() {
      const cats = ['all', ...new Set(this._components.map(c => c.category))];
      const catsEl = this._el.querySelector('.n3-comp-cats');
      const catsHtml = cats.map(c =>
        `<button class="n3-comp-cat-btn${c === this._category ? ' n3-comp-cat-on' : ''}" data-cat="${c}">${c === 'all' ? 'All' : c}</button>`
      ).join('');
      catsEl.innerHTML = catsHtml;
    }

    _renderList() {
      const filtered = this._components.filter(c => {
        const inCat    = this._category === 'all' || c.category === this._category;
        const inSearch = !this._filter ||
          c.name.toLowerCase().includes(this._filter) ||
          (c.description || '').toLowerCase().includes(this._filter) ||
          (c.tags || []).some(t => t.includes(this._filter));
        return inCat && inSearch;
      });

      const listEl = this._el.querySelector('.n3-comp-list');
      if (!filtered.length) {
        const emptyHtml = '<div class="n3-comp-empty">No components match your search.</div>';
        listEl.innerHTML = emptyHtml;
        return;
      }

      // Group by category
      const groups = {};
      filtered.forEach(c => { (groups[c.category] = groups[c.category] || []).push(c); });

      const listHtml = Object.entries(groups).map(([cat, comps]) =>
        `<div>
          <div class="n3-comp-group-hdr">${cat}</div>
          ${comps.map(c => `<div class="n3-comp-item" data-comp-id="${c.id}" draggable="true">
            <span class="n3-comp-thumb" style="display:inline-flex;align-items:center">${((window._n3wareModules||{}).icon||function(){return''})(c.lucideIcon||'layout-grid',{size:16})}</span>
            <div class="n3-comp-info">
              <div class="n3-comp-name">${c.name}</div>
              <div class="n3-comp-badge">${c.description ? c.description.substring(0, 38) + (c.description.length > 38 ? '…' : '') : ''}</div>
            </div>
            <button class="n3-comp-add" data-comp-id="${c.id}" title="Insert component">+</button>
          </div>`).join('')}
        </div>`
      ).join('');
      listEl.innerHTML = listHtml;

      // Bind drag + click events
      listEl.querySelectorAll('.n3-comp-item[data-comp-id]').forEach(item => {
        const comp = this._components.find(c => c.id === item.dataset.compId);
        if (!comp) return;

        item.addEventListener('dragstart', e => {
          this._dragging = comp.html;
          e.dataTransfer.setData('application/n3-component', comp.html);
          e.dataTransfer.effectAllowed = 'copy';
          item.style.opacity = '0.45';
        });
        item.addEventListener('dragend', () => {
          item.style.opacity = '';
          this._dragging = null;
          if (this._dropTarget) { this._dropTarget.classList.remove('n3-comp-drop-target'); this._dropTarget = null; }
        });
      });

      listEl.querySelectorAll('.n3-comp-add').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const comp = this._components.find(c => c.id === btn.dataset.compId);
          if (!comp) return;
          this._enterPlacementMode(comp);
        });
      });
    }

    // ── Placement mode ────────────────────────────────────────────────────────

    /**
     * Enter placement mode for a component.
     * Shows a floating cursor glyph and drop-zone indicators between page blocks.
     */
    _enterPlacementMode(comp) {
      if (this._placing) this._exitPlacementMode(false);
      this._placing = comp;

      const iconFn = (window._n3wareModules||{}).icon;

      // Floating cursor glyph
      const cur = document.createElement('div');
      cur.className = 'n3-place-cursor';
      cur.setAttribute('data-n3-ui', '1');
      cur.innerHTML = (iconFn ? iconFn(comp.lucideIcon || 'layout-template', {size: 22}) : '') +
        '<div class="n3-place-cursor-badge">+</div>';
      cur.style.opacity = '0';
      document.body.appendChild(cur);
      this._placeCursor = cur;

      // Build drop zones
      this._buildDropZones();

      document.body.classList.add('n3-placing');

      // Mousemove: update cursor position + active zone
      document.addEventListener('mousemove', this._onPlaceMove = e => {
        cur.style.left = (e.clientX + 12) + 'px';
        cur.style.top  = (e.clientY + 12) + 'px';
        cur.style.opacity = '1';
        this._updateActiveZone(e.clientY + window.scrollY);
      });

      // Click: place at active zone (ignore clicks on editor UI)
      document.addEventListener('click', this._onPlaceClick = e => {
        if (N3UI.isEditorEl(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const zone = this._placeZones[this._activeZone];
        this._exitPlacementMode(false);
        if (zone) {
          const node = this._insertAtZone(comp.html, zone);
          this._showCustomizeModal(node, comp);
        }
      }, true); // capture so we beat other click handlers

      N3UI.toast('Click to place — Esc to cancel', 'info', 3000);
    }

    /**
     * Cancel placement mode.
     * @returns {boolean} true if was in placement mode (so caller knows to swallow the event)
     */
    cancelPlacement() {
      if (!this._placing) return false;
      this._exitPlacementMode(true);
      N3UI.toast('Placement cancelled', 'info', 1500);
      return true;
    }

    /** @private */
    _exitPlacementMode(cancelled) {
      this._placing = null;
      if (this._placeCursor) { this._placeCursor.remove(); this._placeCursor = null; }
      this._placeZoneEls.forEach(el => el.remove());
      this._placeZoneEls = [];
      this._placeZones = [];
      this._activeZone = -1;
      document.body.classList.remove('n3-placing');
      if (this._onPlaceMove)  { document.removeEventListener('mousemove', this._onPlaceMove); this._onPlaceMove = null; }
      if (this._onPlaceClick) { document.removeEventListener('click', this._onPlaceClick, true); this._onPlaceClick = null; }
    }

    /**
     * Find the top-level layout container and compute drop zones between its
     * direct block children, skipping all editor UI elements.
     * @private
     */
    _buildDropZones() {
      // Find the outermost content container: prefer <main>, else body
      const container = document.querySelector('main, [role="main"]') || document.body;
      const children = Array.from(container.children).filter(el =>
        !el.classList.contains('n3-toolbar')  &&
        !el.classList.contains('n3-fab')      &&
        !el.classList.contains('n3-comp-panel') &&
        !el.classList.contains('n3-rev-panel') &&
        !el.classList.contains('n3-style-panel') &&
        !el.classList.contains('n3-analytics-overlay') &&
        !el.classList.contains('n3-save-fab') &&
        !el.classList.contains('n3-demo-banner') &&
        !el.hasAttribute('data-n3-ui') &&
        getComputedStyle(el).display !== 'none'
      );

      const contRect = container.getBoundingClientRect();
      const scrollTop = window.scrollY;
      const zones = [];

      if (!children.length) {
        // Empty page: single zone at top
        zones.push({ y: contRect.top + scrollTop + 20, ref: null, before: true, container });
      } else {
        // Zone before first child
        const first = children[0].getBoundingClientRect();
        zones.push({ y: first.top + scrollTop, ref: children[0], before: true, container });

        // Zones between siblings
        for (let i = 0; i < children.length - 1; i++) {
          const r1 = children[i].getBoundingClientRect();
          const r2 = children[i + 1].getBoundingClientRect();
          const midY = scrollTop + (r1.bottom + r2.top) / 2;
          zones.push({ y: midY, ref: children[i + 1], before: true, container });
        }

        // Zone after last child
        const last = children[children.length - 1].getBoundingClientRect();
        zones.push({ y: last.bottom + scrollTop, ref: children[children.length - 1], before: false, container });
      }

      this._placeZones = zones;
      this._activeZone = -1;

      // Create visual zone bar elements
      const contLeft  = contRect.left;
      const contWidth = contRect.width;
      zones.forEach((zone, i) => {
        const bar = document.createElement('div');
        bar.className = 'n3-place-zone';
        bar.setAttribute('data-n3-ui', '1');
        bar.style.position  = 'absolute';
        bar.style.left      = contLeft + 'px';
        bar.style.width     = contWidth + 'px';
        bar.style.top       = (zone.y - 2) + 'px';
        document.body.appendChild(bar);
        this._placeZoneEls.push(bar);
      });
    }

    /**
     * Highlight the zone closest to the given absolute Y (pageY).
     * @private
     */
    _updateActiveZone(pageY) {
      if (!this._placeZones.length) return;
      let closest = 0;
      let minDist = Infinity;
      this._placeZones.forEach((z, i) => {
        const d = Math.abs(z.y - pageY);
        if (d < minDist) { minDist = d; closest = i; }
      });
      if (closest === this._activeZone) return;
      this._activeZone = closest;
      this._placeZoneEls.forEach((bar, i) =>
        bar.classList.toggle('n3-place-zone-active', i === closest)
      );
    }

    /**
     * Insert component HTML at the specified drop zone.
     * @param {string} html
     * @param {{ref: Element|null, before: boolean, container: Element}} zone
     * @private
     */
    _insertAtZone(html, zone) {
      if (zone.ref) {
        return this._insert(html, zone.before ? zone.ref : zone.ref, zone.before);
      } else {
        return this._insert(html, null, false);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Parse and insert the component HTML at/after (or before) a target block.
     * @param {string} html
     * @param {Element|null} target  — reference element
     * @param {boolean} [before=false] — insert before target instead of after
     */
    _insert(html, target, before = false) {
      // Ensure Tailwind CDN is present when inserting Tailwind components
      if (!document.querySelector('script[src*="tailwindcss"]')) {
        const tw  = document.createElement('script');
        tw.src    = 'https://cdn.tailwindcss.com';
        tw.async  = true;
        document.head.appendChild(tw);
      }

      const tmp      = document.createElement('div');
      const safeHtml = html.trim();
      tmp.innerHTML  = safeHtml;
      const node = tmp.firstElementChild || tmp;

      if (target) {
        if (before) {
          target.parentNode.insertBefore(node, target);
        } else {
          target.parentNode.insertBefore(node, target.nextSibling);
        }
      } else {
        const blocks = document.querySelectorAll('[data-n3-block]');
        if (blocks.length) {
          const last = blocks[blocks.length - 1];
          last.parentNode.insertBefore(node, last.nextSibling);
        } else {
          document.body.appendChild(node);
        }
      }

      // Mark for editing
      node.setAttribute('data-n3-block', '1');
      node.querySelectorAll(SEL.block).forEach(el => {
        if (!N3UI.isEditorEl(el)) el.setAttribute('data-n3-block', '1');
      });
      node.querySelectorAll(SEL.text).forEach(el => {
        if (!N3UI.isEditorEl(el)) {
          el.setAttribute('data-n3-editable', '1');
          el.setAttribute('contenteditable', 'true');
          el.setAttribute('spellcheck', 'false');
        }
      });

      this._events.emit('component:insert', node);
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return node;
    }

    // ── Customize modal ───────────────────────────────────────────────────────

    /**
     * Show the AI customization modal anchored after a freshly-inserted node.
     * @param {Element} componentEl  The inserted component element
     * @param {object}  comp         Component descriptor from the library
     */
    _showCustomizeModal(componentEl, comp) {
      if (this._custModal) return; // already open
      this._custImages = [];
      const iconFn = (window._n3wareModules||{}).icon;
      const ic = n => iconFn ? iconFn(n, {size: 16}) : '';

      // Backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'n3-cust-backdrop';
      backdrop.setAttribute('data-n3-ui', '1');

      const modal = document.createElement('div');
      modal.className = 'n3-cust-modal';
      modal.setAttribute('data-n3-ui', '1');
      modal.innerHTML = `
        <div class="n3-cust-header">
          <div class="n3-cust-icon">${iconFn ? iconFn(comp.lucideIcon || 'layout-template', {size: 16}) : ''}</div>
          <div class="n3-cust-title">Customize: ${comp.name}</div>
          <button class="n3-cust-close" title="Skip">${ic('x')}</button>
        </div>
        <div class="n3-cust-body">
          <div>
            <div class="n3-cust-label">What should this section say?</div>
            <textarea class="n3-cust-textarea" rows="4"
              placeholder="e.g. 'Wood-fired pizza restaurant called Ember & Oak in Wakefield RI. Family-owned since 2019. Emphasize local ingredients and a cozy vibe.'"></textarea>
          </div>
          <div>
            <div class="n3-cust-label">Reference images <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></div>
            <div class="n3-cust-dropzone" title="Click or drop images here">
              <div class="n3-cust-dropzone-label">${ic('image')} Drop images here or <span>browse</span></div>
              <input type="file" accept="image/*" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer">
            </div>
            <div class="n3-cust-thumbs"></div>
          </div>
          <div class="n3-cust-error" style="display:none"></div>
        </div>
        <div class="n3-cust-footer">
          <div class="n3-cust-spacer"></div>
          <button class="n3-cust-skip">Skip</button>
          <button class="n3-cust-generate">${ic('bot')} Generate with AI</button>
        </div>`;

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      this._custModal = backdrop;

      // Focus textarea
      setTimeout(() => modal.querySelector('.n3-cust-textarea').focus(), 80);

      const close = () => {
        this._custImages.forEach(img => URL.revokeObjectURL(img.objectUrl));
        this._custImages = [];
        backdrop.remove();
        this._custModal = null;
      };

      // Skip / close
      backdrop.querySelector('.n3-cust-close').addEventListener('click', () => {
        N3UI.toast(`Added: ${comp.name}`, 'success', 2000);
        close();
      });
      backdrop.querySelector('.n3-cust-skip').addEventListener('click', () => {
        N3UI.toast(`Added: ${comp.name}`, 'success', 2000);
        close();
      });
      // Clicking backdrop outside modal = skip
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) {
          N3UI.toast(`Added: ${comp.name}`, 'success', 2000);
          close();
        }
      });

      // Image upload
      const thumbsEl  = modal.querySelector('.n3-cust-thumbs');
      const dropzone  = modal.querySelector('.n3-cust-dropzone');
      const fileInput = modal.querySelector('input[type="file"]');

      const addFiles = files => {
        Array.from(files).forEach(file => {
          if (!file.type.startsWith('image/')) return;
          const objectUrl = URL.createObjectURL(file);
          this._custImages.push({ file, objectUrl });
          const thumb = document.createElement('div');
          thumb.className = 'n3-cust-thumb';
          const idx = this._custImages.length - 1;
          thumb.innerHTML = `<img src="${objectUrl}" alt=""><button class="n3-cust-thumb-rm" title="Remove">${ic('x')}</button>`;
          thumb.querySelector('.n3-cust-thumb-rm').addEventListener('click', () => {
            URL.revokeObjectURL(objectUrl);
            this._custImages.splice(idx, 1);
            thumb.remove();
          });
          thumbsEl.appendChild(thumb);
        });
      };

      fileInput.addEventListener('change', e => addFiles(e.target.files));
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('n3-cust-drag-over'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('n3-cust-drag-over'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('n3-cust-drag-over');
        addFiles(e.dataTransfer.files);
      });

      // Generate
      const genBtn   = modal.querySelector('.n3-cust-generate');
      const errorEl  = modal.querySelector('.n3-cust-error');
      const textarea = modal.querySelector('.n3-cust-textarea');

      genBtn.addEventListener('click', async () => {
        const prompt = textarea.value.trim();
        if (!prompt) { textarea.focus(); return; }

        genBtn.disabled = true;
        genBtn.innerHTML = `${ic('loader')} Generating…`;
        errorEl.style.display = 'none';

        try {
          // Encode images as base64 to send directly (no upload endpoint needed)
          const images = [];
          for (const img of this._custImages) {
            const b64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(img.file);
            });
            images.push({ mediaType: img.file.type, data: b64 });
          }

          // Call customize endpoint
          const res = await fetch(`${this._apiBase}/components/customize`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              componentId:   comp.id,
              componentHtml: componentEl.outerHTML,
              prompt,
              images,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
          }

          const { html } = await res.json();

          // Replace component in DOM with AI-generated HTML
          const tmp = document.createElement('div');
          tmp.innerHTML = html.trim();
          const newNode = tmp.firstElementChild || tmp;
          newNode.setAttribute('data-n3-block', '1');
          componentEl.replaceWith(newNode);

          // Emit so history captures the replacement
          this._events.emit('component:insert', newNode);

          close();
          N3UI.toast(`${comp.name} customized!`, 'success', 2500);
        } catch (err) {
          errorEl.textContent = 'Error: ' + err.message;
          errorEl.style.display = 'block';
          genBtn.disabled = false;
          genBtn.innerHTML = `${ic('bot')} Retry`;
        }
      });
    }
  }

  Object.assign(window._n3wareModules, { N3Components, N3Cloud, N3RevPanel, N3RevisionsPanel: N3RevPanel });
})();
