/**
 * n3ware-content-panel.js — Content panel DOM and state machine.
 * Three states: list → detail → entry
 * Registers: window._n3wareModules.N3ContentPanel
 */
(function () { 'use strict';
  window._n3wareModules = window._n3wareModules || {};

  // SVG icons
  const ICON_X     = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_BACK  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const ICON_GEAR  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

  const FIELD_TYPES = ['text', 'email', 'url', 'number', 'date', 'richtext', 'boolean', 'select', 'image'];

  class N3ContentPanel {
    /**
     * @param {string} siteId
     * @param {string} apiKey
     * @param {Object} modules   { editor, ... }
     */
    constructor(siteId, apiKey, modules) {
      this._siteId     = siteId;
      this._apiKey     = apiKey;
      this._modules    = modules || {};
      this._collections = [];
      this._panel      = null;
      this._state      = 'list';
      this._currentCollection = null;
      this._currentEntry      = null;
    }

    // ── Panel lifecycle ──────────────────────────────────────────────────────

    buildPanel() {
      if (this._panel) return this._panel;
      const panel = document.createElement('div');
      panel.className = 'n3-content-panel';
      panel.id = 'n3-content-panel';
      panel.setAttribute('data-n3-ui', '1');
      document.body.appendChild(panel);
      this._panel = panel;
      this._renderList();
      return panel;
    }

    open() {
      const panel = this.buildPanel();
      this._loadCollections().then(() => this._renderList());
      // CRITICAL: setTimeout(0), NOT requestAnimationFrame
      panel.classList.remove('n3-panel-open');
      panel.style.removeProperty('transform');
      void panel.offsetHeight;
      setTimeout(() => {
        panel.classList.add('n3-panel-open');
        panel.style.setProperty('transform', 'translateX(0)', 'important');
      }, 0);
    }

    close() {
      if (!this._panel) return;
      this._panel.classList.remove('n3-panel-open');
      this._panel.style.removeProperty('transform');
    }

    // ── API helpers ──────────────────────────────────────────────────────────

    _headers() {
      const h = { 'Content-Type': 'application/json' };
      if (this._apiKey) h['X-Api-Key'] = this._apiKey;
      return h;
    }

    async _loadCollections() {
      try {
        const r = await fetch(`/api/sites/${this._siteId}/collections`, {
          headers: this._apiKey ? { 'X-Api-Key': this._apiKey } : {}
        });
        if (r.status === 402) { this._handle402(); return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        this._collections = d.collections || [];
      } catch (e) {
        console.warn('[n3-content] load collections failed:', e.message);
      }
    }

    async _loadEntries(slug) {
      try {
        const r = await fetch(`/api/sites/${this._siteId}/collections/${slug}/entries`, {
          headers: this._apiKey ? { 'X-Api-Key': this._apiKey } : {}
        });
        if (r.status === 402) { this._handle402(); return []; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        return d.entries || [];
      } catch (e) {
        console.warn('[n3-content] load entries failed:', e.message);
        return [];
      }
    }

    _handle402() {
      if (window.n3ware && window.n3ware._modules && window.n3ware._modules.showUpgradeModal) {
        window.n3ware._modules.showUpgradeModal({ message: 'Upgrade to use Collections', siteId: this._siteId });
      } else {
        document.dispatchEvent(new CustomEvent('n3:upgrade-required', { detail: { siteId: this._siteId } }));
      }
    }

    // ── State A — collection list ────────────────────────────────────────────

    _renderList() {
      this._state = 'list';
      this._currentCollection = null;
      this._currentEntry = null;
      if (!this._panel) return;

      const count = this._collections.length;
      let bodyHtml;
      if (!count) {
        bodyHtml = `<div class="n3-empty">No collections yet.<br>Create one to add dynamic content to your pages.</div>`;
      } else {
        bodyHtml = this._collections.map(col => {
          const meta = (col.entryCount != null ? col.entryCount : '?') + ' entries · ' +
                       (col.fields ? col.fields.length : 0) + ' fields';
          return `<div class="n3-collection-card" data-slug="${this._esc(col.slug)}">
            <div class="n3-collection-card-name">${this._esc(col.name)}</div>
            <div class="n3-collection-card-meta">${this._esc(meta)}</div>
          </div>`;
        }).join('');
      }

      this._panel.innerHTML = `
        <div class="n3-content-header">
          <h2>Content</h2>
          <span class="n3-badge">${count} collection${count !== 1 ? 's' : ''}</span>
          <button class="n3-content-btn n3-content-close-btn" title="Close">${ICON_X}</button>
        </div>
        <div class="n3-content-body">${bodyHtml}</div>
        <div class="n3-content-actions">
          <button class="n3-btn-primary n3-create-collection-btn">+ New Collection</button>
        </div>`;

      this._panel.querySelector('.n3-content-close-btn')
        .addEventListener('click', () => this.close());

      this._panel.querySelector('.n3-create-collection-btn')
        .addEventListener('click', () => this._showCreateModal());

      this._panel.querySelectorAll('.n3-collection-card').forEach(card => {
        card.addEventListener('click', () => {
          const col = this._collections.find(c => c.slug === card.dataset.slug);
          if (col) this._renderDetail(col);
        });
      });
    }

    // ── State B — entry list for one collection ──────────────────────────────

    async _renderDetail(collection) {
      this._state = 'detail';
      this._currentCollection = collection;
      this._currentEntry = null;
      if (!this._panel) return;

      // Loading placeholder
      this._panel.innerHTML = `
        <div class="n3-content-header">
          <button class="n3-content-btn n3-back-btn" title="Back">${ICON_BACK}</button>
          <h2>${this._esc(collection.name)}</h2>
          <button class="n3-content-btn n3-settings-btn" title="Settings">${ICON_GEAR}</button>
          <button class="n3-content-btn n3-content-close-btn" title="Close">${ICON_X}</button>
        </div>
        <div class="n3-content-body"><div class="n3-empty">Loading…</div></div>
        <div class="n3-content-actions">
          <button class="n3-btn-primary n3-add-entry-btn">+ Add Entry</button>
        </div>`;

      this._wireDetailButtons(collection);

      const entries = await this._loadEntries(collection.slug);

      const bodyEl = this._panel.querySelector('.n3-content-body');
      if (!entries.length) {
        bodyEl.innerHTML = `<div class="n3-empty">No entries yet.<br>Add the first entry.</div>`;
      } else {
        const firstTextField = this._firstTextField(collection);
        bodyEl.innerHTML = entries.map(entry => {
          const label = firstTextField ? this._esc(String(entry[firstTextField] || '(untitled)')) : '(entry)';
          const imageField = (collection.fields || []).find(f => f.type === 'image');
          const thumbHtml = imageField && entry[imageField.key]
            ? `<img src="${this._esc(entry[imageField.key])}" alt="">`
            : '📄';
          return `<div class="n3-entry-row" data-entry-id="${this._esc(entry.id || '')}">
            <div class="n3-entry-thumb">${thumbHtml}</div>
            <div style="flex:1;min-width:0">
              <div class="n3-entry-label">${label}</div>
            </div>
          </div>`;
        }).join('');

        bodyEl.querySelectorAll('.n3-entry-row').forEach((row, i) => {
          row.addEventListener('click', () => this._renderEntry(collection, entries[i]));
        });
      }
    }

    _wireDetailButtons(collection) {
      this._panel.querySelector('.n3-back-btn')
        .addEventListener('click', () => this._renderList());

      this._panel.querySelector('.n3-content-close-btn')
        .addEventListener('click', () => this.close());

      this._panel.querySelector('.n3-settings-btn')
        .addEventListener('click', e => this._showCollectionSettings(e, collection));

      this._panel.querySelector('.n3-add-entry-btn')
        .addEventListener('click', () => this._renderEntry(collection, null));
    }

    // ── State C — entry form ─────────────────────────────────────────────────

    _renderEntry(collection, entry) {
      this._state = 'entry';
      this._currentCollection = collection;
      this._currentEntry = entry;
      if (!this._panel) return;

      const title = entry ? this._entryTitle(collection, entry) : 'New Entry';

      const formFields = (collection.fields || []).map(field => {
        return this._buildFieldHtml(field, entry ? entry[field.key] : undefined);
      }).join('');

      const deleteBtn = entry
        ? `<button class="n3-btn-danger n3-delete-entry-btn" title="Delete entry">Delete</button>`
        : '';

      this._panel.innerHTML = `
        <div class="n3-content-header">
          <button class="n3-content-btn n3-back-btn" title="Back">${ICON_BACK}</button>
          <h2 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._esc(title)}</h2>
          <button class="n3-content-btn n3-content-close-btn" title="Close">${ICON_X}</button>
        </div>
        <div class="n3-content-body">
          <form class="n3-entry-form" autocomplete="off">${formFields || '<div class="n3-empty">This collection has no fields defined.</div>'}</form>
        </div>
        <div class="n3-content-actions">
          <button class="n3-btn-primary n3-save-entry-btn">Save</button>
          ${deleteBtn}
        </div>`;

      // Wire toggles
      this._panel.querySelectorAll('.n3-toggle-track').forEach(track => {
        track.addEventListener('click', () => {
          track.classList.toggle('on');
        });
      });

      this._panel.querySelector('.n3-back-btn')
        .addEventListener('click', () => this._renderDetail(collection));

      this._panel.querySelector('.n3-content-close-btn')
        .addEventListener('click', () => this.close());

      this._panel.querySelector('.n3-save-entry-btn')
        .addEventListener('click', () => this._submitEntry(collection, entry));

      const delBtn = this._panel.querySelector('.n3-delete-entry-btn');
      if (delBtn) {
        delBtn.addEventListener('click', () => this._deleteEntry(collection, entry));
      }
    }

    _buildFieldHtml(field, value) {
      const label = `<label class="n3-field-label">${this._esc(field.label || field.key)}${field.required ? ' <span class="n3-field-required">*</span>' : ''}</label>`;
      const v = value != null ? value : '';

      switch (field.type) {
        case 'richtext':
          return `<div class="n3-field-row">${label}<textarea class="n3-field-input n3-field-textarea" name="${this._esc(field.key)}">${this._esc(String(v))}</textarea></div>`;

        case 'boolean': {
          const on = v === true || v === 'true' || v === 1 || v === '1';
          return `<div class="n3-field-row">${label}
            <label class="n3-field-toggle">
              <div class="n3-toggle-track${on ? ' on'  : ''}" data-field="${this._esc(field.key)}">
                <div class="n3-toggle-thumb"></div>
              </div>
              <span style="font-size:13px">${on ? 'Yes' : 'No'}</span>
            </label></div>`;
        }

        case 'select': {
          const opts = (field.options || []).map(opt =>
            `<option value="${this._esc(opt)}"${String(v) === String(opt) ? ' selected' : ''}>${this._esc(opt)}</option>`
          ).join('');
          return `<div class="n3-field-row">${label}<select class="n3-field-input" name="${this._esc(field.key)}">${opts}</select></div>`;
        }

        case 'image': {
          const preview = v ? `<img src="${this._esc(String(v))}" alt="" style="margin-top:6px;max-height:80px;border-radius:4px;max-width:100%">` : '';
          return `<div class="n3-field-row">${label}<input type="url" class="n3-field-input" name="${this._esc(field.key)}" value="${this._esc(String(v))}" placeholder="https://">${preview}</div>`;
        }

        case 'number':
          return `<div class="n3-field-row">${label}<input type="number" class="n3-field-input" name="${this._esc(field.key)}" value="${this._esc(String(v))}"></div>`;

        case 'date':
          return `<div class="n3-field-row">${label}<input type="date" class="n3-field-input" name="${this._esc(field.key)}" value="${this._esc(String(v))}"></div>`;

        case 'email':
          return `<div class="n3-field-row">${label}<input type="email" class="n3-field-input" name="${this._esc(field.key)}" value="${this._esc(String(v))}"></div>`;

        case 'url':
          return `<div class="n3-field-row">${label}<input type="url" class="n3-field-input" name="${this._esc(field.key)}" value="${this._esc(String(v))}" placeholder="https://"></div>`;

        default: // text
          return `<div class="n3-field-row">${label}<input type="text" class="n3-field-input" name="${this._esc(field.key)}" value="${this._esc(String(v))}"></div>`;
      }
    }

    async _submitEntry(collection, entry) {
      const form = this._panel.querySelector('.n3-entry-form');
      if (!form) return;

      const data = {};
      (collection.fields || []).forEach(field => {
        if (field.type === 'boolean') {
          const track = form.querySelector(`.n3-toggle-track[data-field="${field.key}"]`);
          data[field.key] = track ? track.classList.contains('on') : false;
        } else {
          const el = form.querySelector(`[name="${field.key}"]`);
          if (el) {
            data[field.key] = field.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
          }
        }
      });

      const saveBtn = this._panel.querySelector('.n3-save-entry-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

      try {
        if (entry && entry.id) {
          await this._updateEntry(collection, entry.id, data);
        } else {
          await this._createEntry(collection, data);
        }
        // Refresh detail view
        await this._renderDetail(collection);
      } catch (e) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        console.error('[n3-content] save entry failed:', e.message);
        if (window._n3wareModules && window._n3wareModules.N3UI) {
          window._n3wareModules.N3UI.toast('Save failed: ' + e.message, 'error');
        }
      }
    }

    async _createEntry(collection, data) {
      const r = await fetch(`/api/sites/${this._siteId}/collections/${collection.slug}/entries`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(data),
      });
      if (r.status === 402) { this._handle402(); return; }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    }

    async _updateEntry(collection, entryId, data) {
      const r = await fetch(`/api/sites/${this._siteId}/collections/${collection.slug}/entries/${entryId}`, {
        method: 'PUT',
        headers: this._headers(),
        body: JSON.stringify(data),
      });
      if (r.status === 402) { this._handle402(); return; }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    }

    async _deleteEntry(collection, entry) {
      if (!entry || !entry.id) return;
      const confirmed = await this._confirm('Delete entry?', 'This cannot be undone.');
      if (!confirmed) return;
      try {
        const r = await fetch(`/api/sites/${this._siteId}/collections/${collection.slug}/entries/${entry.id}`, {
          method: 'DELETE',
          headers: this._apiKey ? { 'X-Api-Key': this._apiKey } : {},
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await this._renderDetail(collection);
      } catch (e) {
        console.error('[n3-content] delete entry failed:', e.message);
      }
    }

    async _deleteCollection(collection) {
      const confirmed = await this._confirm(`Delete "${collection.name}"?`, 'All entries will be deleted. This cannot be undone.');
      if (!confirmed) return;
      try {
        const r = await fetch(`/api/sites/${this._siteId}/collections/${collection.slug}`, {
          method: 'DELETE',
          headers: this._apiKey ? { 'X-Api-Key': this._apiKey } : {},
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await this._loadCollections();
        this._renderList();
      } catch (e) {
        console.error('[n3-content] delete collection failed:', e.message);
      }
    }

    // ── Collection settings popover ─────────────────────────────────────────

    _showCollectionSettings(e, collection) {
      // Remove any existing popover
      const existing = document.getElementById('n3-col-settings-popover');
      if (existing) { existing.remove(); return; }

      const pop = document.createElement('div');
      pop.id = 'n3-col-settings-popover';
      pop.setAttribute('data-n3-ui', '1');
      pop.style.cssText = 'position:fixed;background:#111;border:1px solid #2A2A2A;border-radius:10px;padding:6px;z-index:2147483647;min-width:160px;box-shadow:0 4px 24px rgba(0,0,0,.5)';

      const btn = e.currentTarget || e.target;
      const rect = btn.getBoundingClientRect();
      pop.style.top  = (rect.bottom + 4) + 'px';
      pop.style.right = (window.innerWidth - rect.right) + 'px';

      const deleteBtn = document.createElement('button');
      deleteBtn.style.cssText = 'display:flex;align-items:center;gap:8px;background:none;border:none;color:#E31337;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;width:100%;text-align:left';
      deleteBtn.textContent = 'Delete Collection';
      deleteBtn.addEventListener('click', () => {
        pop.remove();
        this._deleteCollection(collection);
      });
      pop.appendChild(deleteBtn);
      document.body.appendChild(pop);

      // Close on outside click
      const close = ev => {
        if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close, true); }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    }

    // ── Create collection modal ──────────────────────────────────────────────

    _showCreateModal() {
      const overlay = document.createElement('div');
      overlay.className = 'n3-modal-overlay';
      overlay.setAttribute('data-n3-ui', '1');

      // Default fields
      const defaultFields = [
        { label: 'Title', type: 'text', required: true },
        { label: 'Description', type: 'richtext', required: false },
        { label: 'Image', type: 'image', required: false },
      ];

      const renderFieldRows = (fields) => fields.map((f, i) => `
        <div class="n3-field-builder-row" data-idx="${i}">
          <input type="text" placeholder="Field label" value="${this._esc(f.label)}" class="n3-fb-label">
          <select class="n3-fb-type">
            ${FIELD_TYPES.map(t => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
          <button class="n3-remove-field" data-idx="${i}" title="Remove field">×</button>
        </div>`).join('');

      overlay.innerHTML = `
        <div class="n3-modal">
          <h3>New Collection</h3>
          <div class="n3-field-row">
            <label class="n3-field-label">Name</label>
            <input type="text" class="n3-field-input n3-col-name" placeholder="Blog Posts">
          </div>
          <div class="n3-field-row">
            <label class="n3-field-label">Slug <span style="color:#888;font-weight:400;text-transform:none">(auto)</span></label>
            <input type="text" class="n3-field-input n3-col-slug" placeholder="blog-posts">
          </div>
          <div style="margin-bottom:10px">
            <label class="n3-field-label" style="margin-bottom:8px">Fields</label>
            <div class="n3-fb-rows">${renderFieldRows(defaultFields)}</div>
            <button style="background:none;border:1px dashed #2A2A2A;color:#888;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;width:100%;margin-top:6px" class="n3-add-field-btn">+ Add Field</button>
          </div>
          <div style="display:flex;gap:8px;margin-top:16px">
            <button class="n3-btn-primary n3-modal-create-btn">Create Collection</button>
            <button class="n3-btn-danger n3-modal-cancel-btn">Cancel</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const fields = defaultFields.map(f => Object.assign({}, f));
      const nameInput = overlay.querySelector('.n3-col-name');
      const slugInput = overlay.querySelector('.n3-col-slug');

      // Auto-derive slug from name
      nameInput.addEventListener('input', () => {
        slugInput.value = nameInput.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      });

      const fbRows = overlay.querySelector('.n3-fb-rows');

      // Remove field
      fbRows.addEventListener('click', e => {
        const rmBtn = e.target.closest('.n3-remove-field');
        if (!rmBtn) return;
        const idx = parseInt(rmBtn.dataset.idx, 10);
        fields.splice(idx, 1);
        fbRows.innerHTML = renderFieldRows(fields);
      });

      // Add field
      overlay.querySelector('.n3-add-field-btn').addEventListener('click', () => {
        fields.push({ label: '', type: 'text', required: false });
        fbRows.innerHTML = renderFieldRows(fields);
      });

      // Create
      overlay.querySelector('.n3-modal-create-btn').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const slug = slugInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        if (!slug) { slugInput.focus(); return; }

        // Read current field values from DOM
        const liveFields = [];
        fbRows.querySelectorAll('.n3-field-builder-row').forEach(row => {
          const label = row.querySelector('.n3-fb-label').value.trim();
          const type  = row.querySelector('.n3-fb-type').value;
          if (label) {
            liveFields.push({
              label,
              key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
              type,
              required: false,
            });
          }
        });

        try {
          await this._createCollection(name, slug, liveFields);
          overlay.remove();
          await this._loadCollections();
          this._renderList();
        } catch (e) {
          console.error('[n3-content] create collection failed:', e.message);
        }
      });

      overlay.querySelector('.n3-modal-cancel-btn').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

      // Focus name input
      setTimeout(() => nameInput.focus(), 50);
    }

    async _createCollection(name, slug, fields) {
      const r = await fetch(`/api/sites/${this._siteId}/collections`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ name, slug, fields }),
      });
      if (r.status === 402) { this._handle402(); return; }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    }

    // ── Template generation ──────────────────────────────────────────────────

    /**
     * Generate default HTML template for a collection.
     * Picks a layout based on field types present.
     */
    _generateDefaultTemplate(collection) {
      const fields  = collection.fields || [];
      const slug    = collection.slug;
      const hasImg  = fields.find(f => f.type === 'image');
      const hasDate = fields.find(f => f.type === 'date');
      const textF   = fields.find(f => f.type === 'text' || f.type === 'email' || f.type === 'url');
      const bodyF   = fields.find(f => f.type === 'richtext');
      const titleKey  = textF ? textF.key : (fields[0] ? fields[0].key : 'title');
      const bodyKey   = bodyF ? bodyF.key : null;
      const imgKey    = hasImg ? hasImg.key : null;
      const dateKey   = hasDate ? hasDate.key : null;

      if (hasImg && textF) {
        // Card grid layout
        const imgLine  = imgKey  ? `<img src="{{this.${imgKey}}}" alt="{{this.${titleKey}}}" style="width:100%;aspect-ratio:16/9;object-fit:cover">` : '';
        const dateLine = dateKey ? `<p style="font-size:12px;color:#888;margin:0 0 4px">{{this.${dateKey}}}</p>` : '';
        const bodyLine = bodyKey ? `<p style="font-size:14px;color:#666;margin:8px 0 0;line-height:1.5">{{this.${bodyKey}}}</p>` : '';
        return `<section data-n3-collection="${slug}" style="padding:48px 24px">
  <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px">
    {{#each ${slug}}}
    <div style="border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.08)">
      ${imgLine}
      <div style="padding:16px">
        ${dateLine}
        <h3 style="margin:0 0 8px;font-size:18px">{{this.${titleKey}}}</h3>
        ${bodyLine}
      </div>
    </div>
    {{/each}}
  </div>
</section>`;
      }

      if (hasDate && textF) {
        // Blog list layout
        const dateLine = dateKey ? `<span style="font-size:12px;color:#888">{{this.${dateKey}}}</span>` : '';
        const bodyLine = bodyKey ? `<p style="font-size:14px;color:#555;margin:8px 0 0;line-height:1.6">{{this.${bodyKey}}}</p>` : '';
        return `<section data-n3-collection="${slug}" style="padding:48px 24px">
  <div style="max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:32px">
    {{#each ${slug}}}
    <article style="border-bottom:1px solid #eee;padding-bottom:32px">
      ${dateLine}
      <h2 style="margin:4px 0 8px;font-size:22px">{{this.${titleKey}}}</h2>
      ${bodyLine}
    </article>
    {{/each}}
  </div>
</section>`;
      }

      // Generic grid with all text fields
      const fieldLines = fields
        .filter(f => f.type !== 'boolean' && f.type !== 'image')
        .map(f => `<p style="margin:4px 0;font-size:14px"><strong>${this._esc(f.label || f.key)}:</strong> {{this.${f.key}}}</p>`)
        .join('\n      ');

      return `<section data-n3-collection="${slug}" style="padding:48px 24px">
  <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px">
    {{#each ${slug}}}
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px">
      ${fieldLines || '<p>{{this.id}}</p>'}
    </div>
    {{/each}}
  </div>
</section>`;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _firstTextField(collection) {
      const f = (collection.fields || []).find(f =>
        f.type === 'text' || f.type === 'email' || f.type === 'url'
      );
      return f ? f.key : (collection.fields && collection.fields[0] ? collection.fields[0].key : null);
    }

    _entryTitle(collection, entry) {
      const key = this._firstTextField(collection);
      if (key && entry[key]) return String(entry[key]);
      return 'Entry';
    }

    _esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    _confirm(title, msg) {
      // Use N3UI.confirm if available, otherwise native confirm
      if (window._n3wareModules && window._n3wareModules.N3UI) {
        return window._n3wareModules.N3UI.confirm(title, msg);
      }
      return Promise.resolve(window.confirm(title + '\n' + msg));
    }
  }

  window._n3wareModules.N3ContentPanel = N3ContentPanel;

})();
