/**
 * n3ware-media — Media Library panel for the n3ware visual editor.
 *
 * Provides a slide-in panel for browsing, uploading, and deleting
 * site media assets. Integrates with the /api/sites/:id/media and
 * /api/uploads/:siteId/upload endpoints.
 *
 * Registered as: window._n3wareModules.N3MediaManager
 */
(function () { 'use strict';

  // ── Design tokens (match n3ware.js core) ──────────────────────────────────
  const T = {
    accent:    '#E31337',
    accentDark:'#B91C2C',
    bgPanel:   '#111111',
    border:    '#2A2A2A',
    text:      '#E5E5E5',
    muted:     '#888888',
  };

  // ── Inline SVG icons ───────────────────────────────────────────────────────
  const ICONS = {
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    info:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    trash:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    images: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  };

  // ── CSS ────────────────────────────────────────────────────────────────────
  const STYLES = `
.n3-media-panel {
  position: fixed; top: 0; right: 0;
  width: 360px; max-width: 100vw; height: 100vh;
  background: #111111; border-left: 1px solid #2A2A2A;
  z-index: 999997; display: flex; flex-direction: column;
  transform: translateX(110%); transition: transform 0.3s ease;
  font: 13px/1.5 system-ui, sans-serif; color: #E5E5E5;
  overflow: hidden;
}
.n3-media-panel.n3-media-open { transform: translateX(0) !important; }
.n3-media-header { display: flex; align-items: center; padding: 16px; border-bottom: 1px solid #2A2A2A; gap: 8px; flex-shrink: 0; }
.n3-media-title { font-weight: 600; font-size: 14px; flex: 1; }
.n3-media-subtitle { font-size: 11px; color: #888888; }
.n3-media-close { background: none; border: none; color: #888888; cursor: pointer; padding: 4px; border-radius: 4px; line-height: 1; }
.n3-media-close:hover { color: #E5E5E5; }
.n3-media-search { padding: 10px 16px; border-bottom: 1px solid #2A2A2A; flex-shrink: 0; }
.n3-media-search input { width: 100%; background: #1a1a1a; border: 1px solid #2A2A2A; border-radius: 6px; color: #E5E5E5; padding: 6px 10px; font: 13px system-ui; box-sizing: border-box; outline: none; }
.n3-media-search input:focus { border-color: #E31337; }
.n3-media-grid { flex: 1; overflow-y: auto; padding: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; align-content: start; }
.n3-media-card { background: #1a1a1a; border: 1px solid #2A2A2A; border-radius: 8px; overflow: hidden; position: relative; cursor: default; }
.n3-media-card:hover { border-color: #444; }
.n3-media-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; background: #0d0d0d; display: block; }
.n3-media-thumb-placeholder { width: 100%; aspect-ratio: 1; background: #1a1a1a; display: flex; align-items: center; justify-content: center; color: #444; font-size: 24px; }
.n3-media-info { padding: 6px 8px; }
.n3-media-filename { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #E5E5E5; }
.n3-media-size { font-size: 10px; color: #888888; }
.n3-media-badge { font-size: 10px; padding: 2px 5px; border-radius: 4px; display: inline-block; margin-top: 3px; }
.n3-media-badge.used { background: rgba(227,19,55,0.15); color: #E31337; }
.n3-media-badge.unused { background: rgba(136,136,136,0.15); color: #888888; }
.n3-media-card-actions { position: absolute; top: 4px; right: 4px; display: none; gap: 4px; }
.n3-media-card:hover .n3-media-card-actions { display: flex; }
.n3-media-card-btn { width: 28px; height: 28px; border-radius: 6px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: rgba(17,17,17,.85); color: #E5E5E5; backdrop-filter: blur(4px); }
.n3-media-card-btn:hover { background: #E31337; color: #fff; }
.n3-media-card-btn.info:hover { background: rgba(255,255,255,0.15); }
.n3-media-empty { grid-column: 1 / -1; padding: 48px 16px; text-align: center; color: #888888; }
.n3-media-footer { padding: 12px 16px; border-top: 1px solid #2A2A2A; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.n3-media-footer-info { flex: 1; font-size: 11px; color: #888888; }
.n3-media-upload-btn { background: #E31337; color: #fff; border: none; border-radius: 6px; padding: 7px 14px; font: 13px system-ui; cursor: pointer; display: flex; align-items: center; gap: 5px; }
.n3-media-upload-btn:hover { background: #B91C2C; }
.n3-media-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 999996; display: flex; align-items: center; justify-content: center; }
.n3-media-modal { background: #111111; border: 1px solid #2A2A2A; border-radius: 12px; width: 380px; max-width: 90vw; padding: 24px; z-index: 999998; }
.n3-media-modal h3 { margin: 0 0 8px; font-size: 15px; }
.n3-media-modal p { margin: 0 0 16px; color: #888888; font-size: 13px; }
.n3-media-usage-list { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.n3-media-usage-list li { background: #1a1a1a; border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #E5E5E5; }
.n3-media-modal-btns { display: flex; gap: 8px; justify-content: flex-end; }
.n3-media-modal-btn { padding: 7px 16px; border-radius: 6px; border: 1px solid #2A2A2A; font: 13px system-ui; cursor: pointer; }
.n3-media-modal-btn.primary { background: #E31337; color: #fff; border-color: #E31337; }
.n3-media-modal-btn.primary:hover { background: #B91C2C; }
.n3-media-modal-btn.danger { background: transparent; color: #E31337; border-color: #E31337; }
.n3-media-modal-btn.danger:hover { background: rgba(227,19,55,0.1); }
.n3-media-modal-btn.secondary { background: transparent; color: #E5E5E5; }
.n3-media-modal-btn.secondary:hover { background: rgba(255,255,255,0.05); }
.n3-media-loading { grid-column: 1/-1; text-align: center; padding: 48px; color: #888; }
`;

  // ──────────────────────────────────────────────────────────────────────────

  class N3MediaManager {
    // Expose the images icon so the host editor can use it for a FAB button
    static ICON = ICONS.images;

    /**
     * @param {object}      events    N3Events instance (may be null)
     * @param {object|null} cloudCfg  { api, site, key } or null
     */
    constructor(events, cloudCfg) {
      this._events    = events;
      this._cloudCfg  = cloudCfg || null;
      this._panel     = null;
      this._open      = false;
      this._items     = [];   // cached media items
      this._loading   = false;

      // Build the API base: /api/sites/{siteId}
      if (cloudCfg && cloudCfg.api && cloudCfg.site) {
        this._apiBase = cloudCfg.api.replace(/\/$/, '') + '/sites/' + cloudCfg.site;
      } else {
        this._apiBase = '/api/sites/unknown';
      }

      // Refs set in _buildPanel
      this._grid      = null;
      this._subtitle  = null;
      this._footerInfo = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    mount() {
      this._injectStyles();
      // Panel is built lazily on first open()
    }

    toggle() {
      this._open ? this.close() : this.open();
    }

    open() {
      if (this._open) return;
      if (!this._panel) this._buildPanel();
      this._open = true;
      this._panel.classList.remove('n3-media-open');
      this._panel.style.removeProperty('transform');
      void this._panel.offsetHeight;          // force reflow
      setTimeout(() => {
        if (!this._panel) return;
        this._panel.classList.add('n3-media-open');
      }, 0);
      this._loadMedia();                      // refresh on each open
    }

    close() {
      if (!this._open) return;
      this._open = false;
      if (this._panel) this._panel.classList.remove('n3-media-open');
    }

    isOpen() { return this._open; }

    // ── Styles ──────────────────────────────────────────────────────────────

    _injectStyles() {
      if (document.getElementById('n3-media-style')) return;
      const s = document.createElement('style');
      s.id = 'n3-media-style';
      s.textContent = STYLES;
      document.head.appendChild(s);
    }

    // ── Panel construction ───────────────────────────────────────────────────

    _buildPanel() {
      const panel = document.createElement('div');
      panel.className = 'n3-media-panel';
      panel.setAttribute('data-n3-ui', '1');

      // ── Header ──
      const header = document.createElement('div');
      header.className = 'n3-media-header';

      const titleWrap = document.createElement('div');
      titleWrap.style.flex = '1';

      const title = document.createElement('div');
      title.className = 'n3-media-title';
      title.textContent = 'Media library';

      const subtitle = document.createElement('div');
      subtitle.className = 'n3-media-subtitle';
      subtitle.textContent = '';
      this._subtitle = subtitle;

      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'n3-media-close';
      closeBtn.setAttribute('title', 'Close');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => this.close());

      header.appendChild(titleWrap);
      header.appendChild(closeBtn);

      // ── Search ──
      const searchWrap = document.createElement('div');
      searchWrap.className = 'n3-media-search';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search files…';
      searchInput.addEventListener('input', () => this._filterGrid(searchInput.value));

      searchWrap.appendChild(searchInput);

      // ── Grid ──
      const grid = document.createElement('div');
      grid.className = 'n3-media-grid';
      this._grid = grid;

      // ── Footer ──
      const footer = document.createElement('div');
      footer.className = 'n3-media-footer';

      const footerInfo = document.createElement('div');
      footerInfo.className = 'n3-media-footer-info';
      this._footerInfo = footerInfo;

      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'n3-media-upload-btn';
      uploadBtn.innerHTML = ICONS.upload + ' Upload';
      uploadBtn.addEventListener('click', () => this._pickAndUpload());

      footer.appendChild(footerInfo);
      footer.appendChild(uploadBtn);

      // ── Assemble ──
      panel.appendChild(header);
      panel.appendChild(searchWrap);
      panel.appendChild(grid);
      panel.appendChild(footer);
      document.body.appendChild(panel);

      this._panel = panel;
    }

    // ── Data loading ────────────────────────────────────────────────────────

    async _loadMedia() {
      if (this._loading) return;

      if (!this._cloudCfg) {
        this._grid.innerHTML = '<div class="n3-media-empty">Media library is not configured for this site.</div>';
        return;
      }

      this._loading = true;
      this._grid.innerHTML = '<div class="n3-media-loading">Loading…</div>';

      try {
        const r = await this._api('GET', '/media');
        if (!r.ok) throw new Error('Failed to load media');
        const { items } = await r.json();
        this._items = items || [];
        this._renderGrid(this._items);
        this._updateHeader();
      } catch (e) {
        this._grid.innerHTML = '<div class="n3-media-empty">Failed to load media</div>';
      } finally {
        this._loading = false;
      }
    }

    // ── Grid rendering ──────────────────────────────────────────────────────

    _renderGrid(items) {
      this._grid.innerHTML = '';

      if (!items || items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'n3-media-empty';
        empty.textContent = 'No files yet. Upload an image to get started.';
        this._grid.appendChild(empty);
        return;
      }

      for (const item of items) {
        this._grid.appendChild(this._buildCard(item));
      }
    }

    _buildCard(item) {
      const card = document.createElement('div');
      card.className = 'n3-media-card';

      // Thumbnail
      const img = document.createElement('img');
      img.className = 'n3-media-thumb';
      img.src = item.url || '';
      img.loading = 'lazy';
      img.alt = item.filename || '';

      const placeholder = document.createElement('div');
      placeholder.className = 'n3-media-thumb-placeholder';
      placeholder.style.display = 'none';
      placeholder.textContent = '📄';

      img.addEventListener('error', () => {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
      });

      // Action buttons overlay
      const actions = document.createElement('div');
      actions.className = 'n3-media-card-actions';

      const infoBtn = document.createElement('button');
      infoBtn.className = 'n3-media-card-btn info';
      infoBtn.setAttribute('title', 'Usage info');
      infoBtn.innerHTML = ICONS.info;
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showUsageModal(item);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'n3-media-card-btn';
      deleteBtn.setAttribute('title', 'Delete');
      deleteBtn.innerHTML = ICONS.trash;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteItem(item);
      });

      actions.appendChild(infoBtn);
      actions.appendChild(deleteBtn);

      // Info bar
      const info = document.createElement('div');
      info.className = 'n3-media-info';

      const filename = document.createElement('div');
      filename.className = 'n3-media-filename';
      filename.textContent = item.filename || '—';

      const size = document.createElement('div');
      size.className = 'n3-media-size';
      size.textContent = this._formatSize(item.sizeBytes || 0);

      const usages = Array.isArray(item.usages) ? item.usages : [];
      const badge = document.createElement('span');
      badge.className = 'n3-media-badge ' + (usages.length > 0 ? 'used' : 'unused');
      badge.textContent = usages.length > 0
        ? `\u25CF Used (${usages.length})`
        : 'Unused';

      info.appendChild(filename);
      info.appendChild(size);
      info.appendChild(badge);

      card.appendChild(img);
      card.appendChild(placeholder);
      card.appendChild(actions);
      card.appendChild(info);

      return card;
    }

    // ── Utilities ───────────────────────────────────────────────────────────

    _formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    _updateHeader() {
      const n = this._items.length;
      const totalBytes = this._items.reduce((sum, i) => sum + (i.sizeBytes || 0), 0);
      const totalMB = (totalBytes / 1048576).toFixed(1);
      const label = `${n} file${n !== 1 ? 's' : ''} \u00B7 ${totalMB} MB total`;
      if (this._subtitle) this._subtitle.textContent = label;
      if (this._footerInfo) this._footerInfo.textContent = label;
    }

    _filterGrid(query) {
      const q = (query || '').toLowerCase().trim();
      const filtered = q
        ? this._items.filter(i => (i.filename || '').toLowerCase().includes(q))
        : this._items;
      this._renderGrid(filtered);
    }

    // ── Usage modal ─────────────────────────────────────────────────────────

    _showUsageModal(item) {
      const usages = Array.isArray(item.usages) ? item.usages : [];

      const backdrop = document.createElement('div');
      backdrop.className = 'n3-media-backdrop';

      const modal = document.createElement('div');
      modal.className = 'n3-media-modal';

      const h3 = document.createElement('h3');
      h3.textContent = item.filename || 'File';
      modal.appendChild(h3);

      if (usages.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'No usages found. Safe to delete.';
        modal.appendChild(p);
      } else {
        const p = document.createElement('p');
        p.textContent = `Used in ${usages.length} location${usages.length !== 1 ? 's' : ''}:`;
        modal.appendChild(p);

        const ul = document.createElement('ul');
        ul.className = 'n3-media-usage-list';
        for (const u of usages) {
          const li = document.createElement('li');
          li.textContent = this._formatUsage(u);
          ul.appendChild(li);
        }
        modal.appendChild(ul);
      }

      const btns = document.createElement('div');
      btns.className = 'n3-media-modal-btns';

      const okBtn = document.createElement('button');
      okBtn.className = 'n3-media-modal-btn primary';
      okBtn.textContent = 'OK';
      okBtn.addEventListener('click', () => backdrop.remove());

      btns.appendChild(okBtn);
      modal.appendChild(btns);

      backdrop.appendChild(modal);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
      document.body.appendChild(backdrop);
    }

    _formatUsage(u) {
      if (!u || !u.type) return String(u);
      if (u.type === 'page') return `\u201C${u.title || u.slug || u.slug}\u201D page`;
      if (u.type === 'theme') return `Theme \u2192 ${u.field || u.field}`;
      if (u.type === 'component') return `Component \u2192 ${u.name || u.name}`;
      return JSON.stringify(u);
    }

    // ── Delete flow ─────────────────────────────────────────────────────────

    async _deleteItem(item) {
      const usages = Array.isArray(item.usages) ? item.usages : [];

      if (usages.length > 0) {
        this._showUsageWarning(item);
        return;
      }

      if (!confirm(`Delete ${item.filename}? This can't be undone.`)) return;
      await this._doDelete(item, false);
    }

    _showUsageWarning(item) {
      const usages = Array.isArray(item.usages) ? item.usages : [];

      const backdrop = document.createElement('div');
      backdrop.className = 'n3-media-backdrop';

      const modal = document.createElement('div');
      modal.className = 'n3-media-modal';

      const h3 = document.createElement('h3');
      h3.textContent = 'This file is still in use';
      modal.appendChild(h3);

      const p = document.createElement('p');
      p.textContent = `${item.filename} is referenced in ${usages.length} location${usages.length !== 1 ? 's' : ''}:`;
      modal.appendChild(p);

      const ul = document.createElement('ul');
      ul.className = 'n3-media-usage-list';
      for (const u of usages) {
        const li = document.createElement('li');
        li.textContent = this._formatUsage(u);
        ul.appendChild(li);
      }
      modal.appendChild(ul);

      const btns = document.createElement('div');
      btns.className = 'n3-media-modal-btns';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'n3-media-modal-btn secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => backdrop.remove());

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'n3-media-modal-btn danger';
      deleteBtn.textContent = 'Delete anyway';
      deleteBtn.addEventListener('click', async () => {
        backdrop.remove();
        await this._doDelete(item, true);
      });

      btns.appendChild(cancelBtn);
      btns.appendChild(deleteBtn);
      modal.appendChild(btns);

      backdrop.appendChild(modal);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
      document.body.appendChild(backdrop);
    }

    async _doDelete(item, force) {
      const qs = force ? '?force=true' : '';
      const r = await this._api('DELETE', `/media/${item.id}${qs}`);
      if (r.ok) {
        this._items = this._items.filter(i => i.id !== item.id);
        this._renderGrid(this._items);
        this._updateHeader();
        this._toast(`Deleted ${item.filename}`);
        // Close any open modals
        document.querySelectorAll('.n3-media-backdrop').forEach(el => el.remove());
      } else {
        const data = await r.json().catch(() => ({}));
        this._toast(data.error || 'Delete failed', true);
      }
    }

    // ── Upload ──────────────────────────────────────────────────────────────

    _pickAndUpload() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.pdf,.svg,.woff,.woff2';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', async () => {
        input.remove();
        if (!input.files || !input.files.length) return;

        const siteId = this._cloudCfg ? this._cloudCfg.site : null;
        if (!siteId) {
          this._toast('No site configured', true);
          return;
        }

        const apiRoot = this._cloudCfg.api.replace(/\/$/, '');
        let uploaded = 0;

        for (const file of input.files) {
          const fd = new FormData();
          fd.append('file', file);
          try {
            const r = await fetch(`${apiRoot}/uploads/${siteId}/upload`, {
              method: 'POST',
              headers: this._authHeader(),   // no Content-Type — browser sets multipart boundary
              body: fd,
            });
            if (r.ok) {
              uploaded++;
            } else {
              const d = await r.json().catch(() => ({}));
              this._toast(d.error || 'Upload failed', true);
            }
          } catch {
            this._toast('Upload failed', true);
          }
        }

        if (uploaded > 0) {
          this._toast(`Uploaded ${uploaded} file${uploaded > 1 ? 's' : ''}`);
          this._loadMedia();
        }
      });

      input.click();
    }

    // ── Auth & fetch helpers ─────────────────────────────────────────────────

    _authHeader() {
      const token = sessionStorage.getItem('n3_auth') || localStorage.getItem('n3_token');
      if (token) return { 'Authorization': 'Bearer ' + token };
      if (this._cloudCfg && this._cloudCfg.key) return { 'X-Api-Key': this._cloudCfg.key };
      return {};
    }

    async _api(method, path, body) {
      const opts = {
        method,
        headers: { ...this._authHeader(), 'Content-Type': 'application/json' },
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch(this._apiBase + path, opts);
    }

    // ── Toast ────────────────────────────────────────────────────────────────

    _toast(msg, isErr) {
      if (window.n3ware && window.n3ware._showToast) {
        window.n3ware._showToast(msg, isErr);
        return;
      }
      const t = document.createElement('div');
      t.style.cssText = [
        'position:fixed',
        'bottom:80px',
        'left:50%',
        'transform:translateX(-50%)',
        `background:${isErr ? '#dc2626' : '#111'}`,
        'color:#fff',
        'padding:8px 16px',
        'border-radius:8px',
        'z-index:9999999',
        'font:13px system-ui',
        `border:1px solid ${isErr ? '#dc2626' : '#2A2A2A'}`,
      ].join(';');
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    }
  }

  // ── Register module ────────────────────────────────────────────────────────
  window._n3wareModules = window._n3wareModules || {};
  window._n3wareModules.N3MediaManager = N3MediaManager;

})();
