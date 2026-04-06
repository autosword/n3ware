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

  const COLLECTION_PRESETS = [
    {
      name: 'Team Members', slug: 'team', icon: 'users',
      description: 'People on your team with bios and photos',
      fields: [
        { key: 'name',  type: 'text',     label: 'Full Name', required: true },
        { key: 'role',  type: 'text',     label: 'Job Title', required: false },
        { key: 'photo', type: 'image',    label: 'Headshot',  required: false },
        { key: 'bio',   type: 'richtext', label: 'Bio',       required: false },
        { key: 'email', type: 'email',    label: 'Email',     required: false },
        { key: 'order', type: 'number',   label: 'Order',     required: false, default: 0 },
      ],
    },
    {
      name: 'Blog Posts', slug: 'blog', icon: 'newspaper',
      description: 'Articles with date, cover image, and full body',
      fields: [
        { key: 'title',       type: 'text',     label: 'Title',       required: true },
        { key: 'date',        type: 'date',     label: 'Date',        required: false },
        { key: 'excerpt',     type: 'text',     label: 'Excerpt',     required: false },
        { key: 'body',        type: 'richtext', label: 'Body',        required: false },
        { key: 'cover_image', type: 'image',    label: 'Cover Image', required: false },
        { key: 'author',      type: 'text',     label: 'Author',      required: false },
      ],
    },
    {
      name: 'Menu Items', slug: 'menu', icon: 'utensils',
      description: 'Restaurant dishes with price and dietary info',
      fields: [
        { key: 'name',        type: 'text',   label: 'Dish Name',   required: true },
        { key: 'description', type: 'text',   label: 'Description', required: false },
        { key: 'price',       type: 'number', label: 'Price',       required: false },
        { key: 'photo',       type: 'image',  label: 'Photo',       required: false },
        { key: 'category',    type: 'select', label: 'Category',    required: false, options: ['Appetizer', 'Main', 'Dessert', 'Drink'] },
        { key: 'dietary',     type: 'select', label: 'Dietary',     required: false, options: ['None', 'Vegetarian', 'Vegan', 'Gluten-Free'] },
      ],
    },
    {
      name: 'Services', slug: 'services', icon: 'briefcase',
      description: 'What you offer with pricing and highlights',
      fields: [
        { key: 'name',        type: 'text',     label: 'Service Name', required: true },
        { key: 'description', type: 'richtext', label: 'Description',  required: false },
        { key: 'price',       type: 'text',     label: 'Price',        required: false },
        { key: 'icon',        type: 'image',    label: 'Icon/Image',   required: false },
        { key: 'featured',    type: 'boolean',  label: 'Featured',     required: false },
        { key: 'order',       type: 'number',   label: 'Order',        required: false, default: 0 },
      ],
    },
    {
      name: 'Testimonials', slug: 'testimonials', icon: 'message-square',
      description: 'Customer reviews with star ratings',
      fields: [
        { key: 'quote',   type: 'richtext', label: 'Quote',        required: true },
        { key: 'author',  type: 'text',     label: 'Author',       required: true },
        { key: 'company', type: 'text',     label: 'Company',      required: false },
        { key: 'photo',   type: 'image',    label: 'Photo',        required: false },
        { key: 'rating',  type: 'number',   label: 'Rating (1–5)', required: false },
        { key: 'order',   type: 'number',   label: 'Order',        required: false, default: 0 },
      ],
    },
    {
      name: 'Locations', slug: 'locations', icon: 'map-pin',
      description: 'Physical locations with address and hours',
      fields: [
        { key: 'name',    type: 'text',  label: 'Location Name', required: true },
        { key: 'address', type: 'text',  label: 'Address',       required: false },
        { key: 'phone',   type: 'text',  label: 'Phone',         required: false },
        { key: 'hours',   type: 'text',  label: 'Hours',         required: false },
        { key: 'map_url', type: 'url',   label: 'Map URL',       required: false },
        { key: 'photo',   type: 'image', label: 'Photo',         required: false },
      ],
    },
    {
      name: 'Portfolio', slug: 'portfolio', icon: 'image',
      description: 'Work samples with client and project details',
      fields: [
        { key: 'title',       type: 'text',     label: 'Project Title', required: true },
        { key: 'description', type: 'richtext', label: 'Description',   required: false },
        { key: 'image',       type: 'image',    label: 'Image',         required: false },
        { key: 'client',      type: 'text',     label: 'Client',        required: false },
        { key: 'date',        type: 'date',     label: 'Date',          required: false },
        { key: 'project_url', type: 'url',      label: 'Project URL',   required: false },
      ],
    },
    {
      name: 'FAQ', slug: 'faq', icon: 'help-circle',
      description: 'Frequently asked questions with answers',
      fields: [
        { key: 'question', type: 'text',     label: 'Question', required: true },
        { key: 'answer',   type: 'richtext', label: 'Answer',   required: true },
        { key: 'category', type: 'text',     label: 'Category', required: false },
        { key: 'order',    type: 'number',   label: 'Order',    required: false, default: 0 },
      ],
    },
    {
      name: 'Events', slug: 'events', icon: 'calendar',
      description: 'Upcoming events with date, time, and location',
      fields: [
        { key: 'title',       type: 'text',     label: 'Event Title', required: true },
        { key: 'date',        type: 'date',     label: 'Date',        required: true },
        { key: 'time',        type: 'text',     label: 'Time',        required: false },
        { key: 'location',    type: 'text',     label: 'Location',    required: false },
        { key: 'description', type: 'richtext', label: 'Description', required: false },
        { key: 'image',       type: 'image',    label: 'Image',       required: false },
      ],
    },
    {
      name: 'Products', slug: 'products', icon: 'shopping-bag',
      description: 'Items for sale with price and inventory',
      fields: [
        { key: 'name',        type: 'text',     label: 'Product Name', required: true },
        { key: 'price',       type: 'number',   label: 'Price',        required: true },
        { key: 'description', type: 'richtext', label: 'Description',  required: false },
        { key: 'photo',       type: 'image',    label: 'Photo',        required: false },
        { key: 'in_stock',    type: 'boolean',  label: 'In Stock',     required: false },
        { key: 'category',    type: 'select',   label: 'Category',     required: false, options: ['General'] },
      ],
    },
  ];

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
      // Remove any existing modal
      document.getElementById('n3-create-col-modal')?.remove();

      this._modalFields   = [];
      this._modalView     = 'tabs'; // 'tabs' | 'builder'
      this._modalTab      = 'describe'; // 'describe' | 'preset'
      this._modalColName  = '';
      this._modalColSlug  = '';

      const overlay = document.createElement('div');
      overlay.className = 'n3-modal-overlay';
      overlay.id = 'n3-create-col-modal';
      overlay.setAttribute('data-n3-ui', '1');
      overlay.innerHTML = this._modalHTML();
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      this._bindModalEvents(overlay);
    }

    _modalHTML() {
      return `<div class="n3-modal" style="width:520px;max-width:calc(100vw - 32px)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h3 style="margin:0;font-size:16px;font-weight:600">Create Collection</h3>
          <button id="n3-modal-close-btn" style="background:none;border:none;color:#888;cursor:pointer;padding:4px;line-height:1">${ICON_X}</button>
        </div>
        ${this._modalContentHTML()}
      </div>`;
    }

    _modalContentHTML() {
      if (this._modalView === 'builder') {
        return this._builderHTML();
      }
      // tabs view
      return `
        <div style="display:flex;gap:4px;margin-bottom:16px;background:#1a1a1a;border-radius:8px;padding:4px">
          <button class="n3-modal-tab${this._modalTab === 'describe' ? ' n3-modal-tab-active' : ''}" data-tab="describe"
            style="flex:1;padding:7px 12px;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;
                   background:${this._modalTab === 'describe' ? '#2a2a2a' : 'none'};
                   color:${this._modalTab === 'describe' ? '#e5e5e5' : '#888'}">
            Describe it
          </button>
          <button class="n3-modal-tab${this._modalTab === 'preset' ? ' n3-modal-tab-active' : ''}" data-tab="preset"
            style="flex:1;padding:7px 12px;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;
                   background:${this._modalTab === 'preset' ? '#2a2a2a' : 'none'};
                   color:${this._modalTab === 'preset' ? '#e5e5e5' : '#888'}">
            Pick a preset
          </button>
        </div>
        ${this._modalTab === 'describe' ? this._describeTabHTML() : this._presetTabHTML()}`;
    }

    _describeTabHTML() {
      return `
        <p style="font-size:13px;color:#888;margin:0 0 12px;line-height:1.5">
          Describe the content you need and AI will generate the collection schema for you.
        </p>
        <textarea id="n3-ai-prompt" class="n3-field-input n3-field-textarea"
          placeholder="What kind of content do you need? e.g., 'team members with name, role, headshot, and bio' or 'restaurant menu with dish name, price, description, photo, and dietary tags'"
          style="min-height:100px"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
          <button id="n3-ai-generate" class="n3-btn-primary">&#10022; Create with AI</button>
          <span style="color:#888;font-size:12px">or</span>
          <button id="n3-manual-create" style="background:none;border:1px solid #2a2a2a;color:#888;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer">
            Build manually
          </button>
        </div>`;
    }

    _presetTabHTML() {
      const cards = COLLECTION_PRESETS.map((p, i) => `
        <div class="n3-collection-card n3-preset-card" data-preset-idx="${i}"
          style="cursor:pointer;padding:12px;border-radius:10px;border:1px solid #2a2a2a;background:#111;transition:border-color .15s">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="color:#888;flex-shrink:0">${this._icon(p.icon, 14)}</span>
            <span class="n3-collection-card-name" style="font-size:13px;font-weight:600">${this._esc(p.name)}</span>
          </div>
          <div class="n3-collection-card-meta" style="font-size:11px;color:#888;line-height:1.4">
            ${this._esc(p.description)} &middot; ${p.fields.length} fields
          </div>
        </div>`).join('');
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:360px;overflow-y:auto">${cards}</div>`;
    }

    _builderHTML() {
      const fieldRows = this._modalFields.map((f, i) => `
        <div class="n3-field-builder-row" data-idx="${i}"
          style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
          <input type="text" class="n3-fld-label n3-field-input" data-idx="${i}"
            value="${this._esc(f.label)}" placeholder="Field label" style="flex:1">
          <select class="n3-fld-type n3-field-input" data-idx="${i}" style="width:110px">
            ${FIELD_TYPES.map(t => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
          <button class="n3-remove-field" data-idx="${i}"
            style="background:none;border:none;color:#888;cursor:pointer;font-size:18px;padding:0 4px;line-height:1"
            title="Remove field">&times;</button>
        </div>`).join('');

      return `
        <button id="n3-back-to-tabs"
          style="background:none;border:none;color:#888;font-size:12px;cursor:pointer;padding:0;margin-bottom:12px;display:flex;align-items:center;gap:4px">
          ${ICON_BACK} Back
        </button>
        <div class="n3-field-row">
          <label class="n3-field-label">Collection Name <span class="n3-field-required">*</span></label>
          <input id="n3-col-name" class="n3-field-input" value="${this._esc(this._modalColName)}" placeholder="Blog Posts">
        </div>
        <div class="n3-field-row">
          <label class="n3-field-label">Slug <span style="color:#888;font-weight:400;text-transform:none">(auto)</span></label>
          <input id="n3-col-slug" class="n3-field-input" value="${this._esc(this._modalColSlug)}" placeholder="blog-posts">
        </div>
        <div style="font:600 11px/1 system-ui;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Fields</div>
        <div id="n3-fields-list">${fieldRows}</div>
        <button id="n3-add-field"
          style="background:none;border:1px dashed #2a2a2a;color:#888;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;width:100%;margin-top:2px">
          + Add field
        </button>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button id="n3-cancel-modal" class="n3-btn-danger">Cancel</button>
          <button id="n3-create-col" class="n3-btn-primary">Create Collection</button>
        </div>`;
    }

    _renderModalContent(overlay) {
      const modal = overlay.querySelector('.n3-modal');
      // Preserve close button, re-render inner content
      modal.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h3 style="margin:0;font-size:16px;font-weight:600">Create Collection</h3>
          <button id="n3-modal-close-btn" style="background:none;border:none;color:#888;cursor:pointer;padding:4px;line-height:1">${ICON_X}</button>
        </div>
        ${this._modalContentHTML()}`;
      this._bindModalEvents(overlay);
    }

    _bindModalEvents(overlay) {
      // Close button
      overlay.querySelector('#n3-modal-close-btn')?.addEventListener('click', () => overlay.remove());

      // Tab switching
      overlay.querySelectorAll('.n3-modal-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          this._modalTab = btn.dataset.tab;
          this._renderModalContent(overlay);
        });
      });

      // Back to tabs
      overlay.querySelector('#n3-back-to-tabs')?.addEventListener('click', () => {
        this._modalView = 'tabs';
        this._renderModalContent(overlay);
      });

      // Describe tab: AI generate
      overlay.querySelector('#n3-ai-generate')?.addEventListener('click', async () => {
        const prompt = overlay.querySelector('#n3-ai-prompt')?.value?.trim();
        if (!prompt) { overlay.querySelector('#n3-ai-prompt')?.focus(); return; }
        const btn = overlay.querySelector('#n3-ai-generate');
        btn.textContent = 'Generating...';
        btn.disabled = true;
        try {
          const r = await fetch('/api/collections/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'AI generation failed');
          this._modalColName = d.name || '';
          this._modalColSlug = d.slug || '';
          this._modalFields  = (d.fields || []).map(f => Object.assign({}, f));
          this._modalView = 'builder';
          this._renderModalContent(overlay);
        } catch (e) {
          btn.textContent = '&#10022; Create with AI';
          btn.disabled = false;
          if (window._n3wareModules?.N3UI?.toast) {
            window._n3wareModules.N3UI.toast('AI generation failed: ' + e.message, 'error');
          }
        }
      });

      // Describe tab: build manually
      overlay.querySelector('#n3-manual-create')?.addEventListener('click', () => {
        this._modalColName = '';
        this._modalColSlug = '';
        this._modalFields = [
          { label: 'Title', key: 'title', type: 'text', required: true },
          { label: 'Description', key: 'description', type: 'richtext', required: false },
          { label: 'Image', key: 'image', type: 'image', required: false },
        ];
        this._modalView = 'builder';
        this._renderModalContent(overlay);
      });

      // Preset cards
      overlay.querySelectorAll('.n3-preset-card').forEach(card => {
        card.addEventListener('click', () => {
          const idx = parseInt(card.dataset.presetIdx, 10);
          const preset = COLLECTION_PRESETS[idx];
          if (!preset) return;
          this._modalColName = preset.name;
          this._modalColSlug = preset.slug;
          this._modalFields  = preset.fields.map(f => Object.assign({}, f));
          this._modalView = 'builder';
          this._renderModalContent(overlay);
        });
      });

      // Builder: name → slug auto-derive
      overlay.querySelector('#n3-col-name')?.addEventListener('input', e => {
        const slug = overlay.querySelector('#n3-col-slug');
        if (slug) {
          slug.value = e.target.value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        }
      });

      // Builder: field label changes
      overlay.querySelectorAll('.n3-fld-label').forEach(inp => {
        inp.addEventListener('input', e => {
          const idx = parseInt(e.target.dataset.idx, 10);
          if (this._modalFields[idx] !== undefined) {
            this._modalFields[idx].label = e.target.value;
            this._modalFields[idx].key = e.target.value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '');
          }
        });
      });

      // Builder: field type changes
      overlay.querySelectorAll('.n3-fld-type').forEach(sel => {
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.idx, 10);
          if (this._modalFields[idx] !== undefined) {
            this._modalFields[idx].type = e.target.value;
          }
        });
      });

      // Builder: remove field
      overlay.querySelector('#n3-fields-list')?.addEventListener('click', e => {
        const rmBtn = e.target.closest('.n3-remove-field');
        if (!rmBtn) return;
        const idx = parseInt(rmBtn.dataset.idx, 10);
        this._modalFields.splice(idx, 1);
        // Re-render just the fields list
        const list = overlay.querySelector('#n3-fields-list');
        if (list) {
          list.innerHTML = this._modalFields.map((f, i) => `
            <div class="n3-field-builder-row" data-idx="${i}"
              style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
              <input type="text" class="n3-fld-label n3-field-input" data-idx="${i}"
                value="${this._esc(f.label)}" placeholder="Field label" style="flex:1">
              <select class="n3-fld-type n3-field-input" data-idx="${i}" style="width:110px">
                ${FIELD_TYPES.map(t => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}
              </select>
              <button class="n3-remove-field" data-idx="${i}"
                style="background:none;border:none;color:#888;cursor:pointer;font-size:18px;padding:0 4px;line-height:1"
                title="Remove field">&times;</button>
            </div>`).join('');
          this._reBindFieldListEvents(overlay);
        }
      });

      // Builder: add field
      overlay.querySelector('#n3-add-field')?.addEventListener('click', () => {
        this._modalFields.push({ label: '', key: '', type: 'text', required: false });
        const list = overlay.querySelector('#n3-fields-list');
        if (list) {
          const i = this._modalFields.length - 1;
          const row = document.createElement('div');
          row.className = 'n3-field-builder-row';
          row.dataset.idx = i;
          row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
          row.innerHTML = `
            <input type="text" class="n3-fld-label n3-field-input" data-idx="${i}"
              value="" placeholder="Field label" style="flex:1">
            <select class="n3-fld-type n3-field-input" data-idx="${i}" style="width:110px">
              ${FIELD_TYPES.map(t => `<option value="${t}">  ${t}</option>`).join('')}
            </select>
            <button class="n3-remove-field" data-idx="${i}"
              style="background:none;border:none;color:#888;cursor:pointer;font-size:18px;padding:0 4px;line-height:1"
              title="Remove field">&times;</button>`;
          list.appendChild(row);
          this._reBindFieldListEvents(overlay);
          row.querySelector('.n3-fld-label')?.focus();
        }
      });

      // Builder: cancel
      overlay.querySelector('#n3-cancel-modal')?.addEventListener('click', () => overlay.remove());

      // Builder: create collection
      overlay.querySelector('#n3-create-col')?.addEventListener('click', async () => {
        const nameEl = overlay.querySelector('#n3-col-name');
        const slugEl = overlay.querySelector('#n3-col-slug');
        const name = nameEl?.value?.trim();
        const slug = slugEl?.value?.trim();
        if (!name) { nameEl?.focus(); return; }
        if (!slug) { slugEl?.focus(); return; }

        // Read live field values from DOM
        const liveFields = [];
        overlay.querySelectorAll('.n3-field-builder-row').forEach(row => {
          const labelVal = row.querySelector('.n3-fld-label')?.value?.trim();
          const typeVal  = row.querySelector('.n3-fld-type')?.value;
          if (labelVal) {
            liveFields.push({
              label: labelVal,
              key: labelVal.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
              type: typeVal || 'text',
              required: false,
            });
          }
        });

        const btn = overlay.querySelector('#n3-create-col');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

        try {
          const created = await this._createCollection(name, slug, liveFields);
          overlay.remove();
          await this._loadCollections();
          this._renderList();
          // Show sample entries modal after collection created
          const collection = created?.collection || { name, slug, fields: liveFields };
          this._showSampleEntriesModal(collection);
        } catch (e) {
          if (btn) { btn.disabled = false; btn.textContent = 'Create Collection'; }
          console.error('[n3-content] create collection failed:', e.message);
          if (window._n3wareModules?.N3UI?.toast) {
            window._n3wareModules.N3UI.toast('Create failed: ' + e.message, 'error');
          }
        }
      });
    }

    _reBindFieldListEvents(overlay) {
      // Re-bind label/type change listeners for the fields list after DOM manipulation
      overlay.querySelectorAll('.n3-fld-label').forEach(inp => {
        inp.addEventListener('input', e => {
          const idx = parseInt(e.target.dataset.idx, 10);
          if (this._modalFields[idx] !== undefined) {
            this._modalFields[idx].label = e.target.value;
            this._modalFields[idx].key = e.target.value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '');
          }
        });
      });
      overlay.querySelectorAll('.n3-fld-type').forEach(sel => {
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.idx, 10);
          if (this._modalFields[idx] !== undefined) {
            this._modalFields[idx].type = e.target.value;
          }
        });
      });
    }

    // ── Sample entries modal ─────────────────────────────────────────────────

    _showSampleEntriesModal(collection) {
      const existing = document.getElementById('n3-sample-modal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'n3-modal-overlay';
      overlay.id = 'n3-sample-modal';
      overlay.setAttribute('data-n3-ui', '1');
      overlay.innerHTML = `
        <div class="n3-modal" style="width:400px">
          <h3 style="margin:0 0 8px">Generate sample entries?</h3>
          <p style="font-size:13px;color:#888;margin:0 0 16px;line-height:1.5">
            Let AI fill in ${this._esc(collection.name)} with realistic sample data so you can see how it looks on the page.
          </p>
          <div class="n3-field-row">
            <label class="n3-field-label">Describe your business</label>
            <textarea id="n3-sample-prompt" class="n3-field-input n3-field-textarea"
              placeholder="e.g., 'Wood-fired pizza restaurant called Ember &amp; Oak in Wakefield, Rhode Island'"
              style="min-height:72px"></textarea>
          </div>
          <div class="n3-field-row" style="display:flex;align-items:center;gap:12px">
            <label class="n3-field-label" style="margin:0;white-space:nowrap">How many?</label>
            <input id="n3-sample-count" type="number" class="n3-field-input"
              value="3" min="1" max="10" style="width:72px">
          </div>
          <div style="display:flex;gap:8px;margin-top:16px">
            <button id="n3-sample-skip" class="n3-btn-danger" style="flex:0 0 auto">Skip</button>
            <button id="n3-sample-generate" class="n3-btn-primary">&#10022; Generate</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('#n3-sample-skip').onclick = () => overlay.remove();

      overlay.querySelector('#n3-sample-generate').onclick = async () => {
        const prompt = overlay.querySelector('#n3-sample-prompt').value.trim();
        const count  = parseInt(overlay.querySelector('#n3-sample-count').value, 10) || 3;
        if (!prompt) {
          overlay.querySelector('#n3-sample-prompt').focus();
          return;
        }
        const btn = overlay.querySelector('#n3-sample-generate');
        btn.textContent = `Generating ${count} ${this._esc(collection.name)}...`;
        btn.disabled = true;

        try {
          // 1. Get AI-generated entry data
          const r = await fetch('/api/collections/generate-entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              collectionSlug: collection.slug || collection.id,
              fields: collection.fields,
              prompt,
              count,
            }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Generation failed');
          const entries = d.entries || [];

          // 2. Create each entry via the collections API
          const slug = collection.slug || collection.id;
          const headers = { 'Content-Type': 'application/json' };
          if (this._apiKey) headers['X-Api-Key'] = this._apiKey;

          await Promise.all(entries.map(entry =>
            fetch(`/api/sites/${this._siteId}/collections/${slug}/entries`, {
              method: 'POST', headers,
              body: JSON.stringify({ data: entry.data || entry }),
            })
          ));

          overlay.remove();
          // Refresh to show the new entries
          await this._loadCollections();
          this._renderDetail(collection);
          if (window._n3wareModules?.N3UI?.toast) {
            window._n3wareModules.N3UI.toast(`Created ${entries.length} sample ${collection.name}`, 'success');
          }
        } catch (e) {
          btn.textContent = '&#10022; Generate';
          btn.disabled = false;
          if (window._n3wareModules?.N3UI?.toast) {
            window._n3wareModules.N3UI.toast('Generation failed: ' + e.message, 'error');
          }
        }
      };
    }

    // ── Icon helper ──────────────────────────────────────────────────────────

    _icon(name, size = 14) {
      const icons = {
        'users': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        'newspaper': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>`,
        'utensils': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`,
        'briefcase': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
        'message-square': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        'map-pin': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
        'image': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
        'help-circle': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`,
        'calendar': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
        'shopping-bag': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
      };
      return icons[name] || '';
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
