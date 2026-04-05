/**
 * n3ware-nav-panel.js — Nav editor panel DOM: styles, build, wire, refresh.
 * Attaches: window._n3wareNav.{injectStyles, buildPanel, wirePanel,
 *           refreshPanel, refreshLogoPreview, refreshItemsList}
 */
(function () { 'use strict';
  window._n3wareNav = window._n3wareNav || {};

  const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const GRIP_SVG  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
  const TRASH_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
  const PLUS_SVG  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  window._n3wareNav.injectStyles = function injectStyles() {
    if (document.getElementById('n3-nav-panel-css')) return;
    const style = document.createElement('style');
    style.id = 'n3-nav-panel-css';
    style.textContent = [
      '.n3-nav-panel{position:fixed;top:0;right:0;bottom:0;width:300px;z-index:99999;',
      'background:#111111;border-left:1px solid #2A2A2A;display:flex;flex-direction:column;',
      'transform:translateX(110%);transition:transform 0.3s ease;',
      'font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#E5E5E5;',
      'box-shadow:-4px 0 24px rgba(0,0,0,.5);}',

      '.n3-nav-open{transform:translateX(0) !important;}',

      '.n3-nav-panel h3{font-size:11px;font-weight:600;letter-spacing:.08em;',
      'text-transform:uppercase;color:#888888;margin:0 0 10px;}',

      '.n3-nav-header{display:flex;align-items:center;justify-content:space-between;',
      'padding:14px 16px;border-bottom:1px solid #2A2A2A;flex-shrink:0;}',

      '.n3-nav-title{font-size:13px;font-weight:600;color:#E5E5E5;margin:0;}',

      '.n3-nav-close-btn{background:none;border:none;color:#888888;cursor:pointer;',
      'padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;}',
      '.n3-nav-close-btn:hover{background:#2A2A2A;color:#E5E5E5;}',

      '.n3-nav-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px;}',
      '.n3-nav-body::-webkit-scrollbar{width:4px;}',
      '.n3-nav-body::-webkit-scrollbar-track{background:transparent;}',
      '.n3-nav-body::-webkit-scrollbar-thumb{background:#2A2A2A;border-radius:2px;}',

      '.n3-nav-section{display:flex;flex-direction:column;gap:8px;}',
      '.n3-nav-field{display:flex;flex-direction:column;gap:4px;}',
      '.n3-nav-field-label{font-size:11px;color:#888888;}',

      '.n3-nav-input{background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;',
      'color:#E5E5E5;font-size:12px;padding:6px 10px;width:100%;box-sizing:border-box;}',
      '.n3-nav-input:focus{outline:none;border-color:#E31337;}',
      '.n3-nav-input:disabled{opacity:.4;cursor:default;}',

      '.n3-nav-upload-slot{border:1px dashed #2A2A2A;border-radius:8px;padding:10px;',
      'text-align:center;cursor:pointer;position:relative;overflow:hidden;transition:border-color .15s;}',
      '.n3-nav-upload-slot:hover{border-color:#E31337;}',
      '.n3-nav-upload-slot input[type="file"]{position:absolute;inset:0;opacity:0;cursor:pointer;}',
      '.n3-nav-logo-preview{max-height:32px;max-width:100%;border-radius:4px;margin-bottom:4px;display:none;}',
      '.n3-nav-upload-hint{font-size:11px;color:#888888;}',

      '.n3-nav-items-list{display:flex;flex-direction:column;gap:6px;}',

      '.n3-nav-item-row{display:flex;align-items:center;gap:5px;background:#1A1A1A;',
      'border:1px solid #2A2A2A;border-radius:6px;padding:6px 8px;cursor:grab;}',
      '.n3-nav-item-row:active{cursor:grabbing;}',
      '.n3-nav-item-grip{color:#444;flex-shrink:0;display:flex;align-items:center;}',
      '.n3-nav-item-label,.n3-nav-item-href{flex:2;min-width:0;background:#111;border:1px solid #2A2A2A;',
      'border-radius:4px;color:#E5E5E5;font-size:11px;padding:3px 6px;box-sizing:border-box;}',
      '.n3-nav-item-label:focus,.n3-nav-item-href:focus{outline:none;border-color:#E31337;}',
      '.n3-nav-item-type{background:#111;border:1px solid #2A2A2A;border-radius:4px;',
      'color:#E5E5E5;font-size:11px;padding:3px 4px;width:58px;flex-shrink:0;}',
      '.n3-nav-item-type:focus{outline:none;border-color:#E31337;}',
      '.n3-nav-item-delete{background:none;border:none;color:#555;cursor:pointer;',
      'padding:2px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;}',
      '.n3-nav-item-delete:hover{color:#E31337;background:rgba(227,19,55,.1);}',

      '.n3-nav-add-btn{background:#E31337;color:#fff;border:none;border-radius:6px;',
      'padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;',
      'display:flex;align-items:center;gap:6px;align-self:flex-start;transition:background .15s;}',
      '.n3-nav-add-btn:hover{background:#B91C2C;}',

      '.n3-nav-toggle-row{display:flex;align-items:center;gap:8px;margin-bottom:2px;}',
      '.n3-nav-toggle-label{flex:1;font-size:12px;color:#888888;}',
      '.n3-nav-toggle{width:36px;height:20px;-webkit-appearance:none;appearance:none;',
      'background:#2A2A2A;border-radius:10px;cursor:pointer;position:relative;',
      'transition:background .15s;flex-shrink:0;}',
      '.n3-nav-toggle:checked{background:#E31337;}',
      '.n3-nav-toggle::after{content:"";position:absolute;top:2px;left:2px;',
      'width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;}',
      '.n3-nav-toggle:checked::after{transform:translateX(16px);}',

      '.n3-nav-footer{padding:12px 16px;border-top:1px solid #2A2A2A;',
      'display:flex;gap:8px;flex-shrink:0;}',
      '.n3-nav-save-btn{flex:1;background:#E31337;color:#fff;border:none;border-radius:6px;',
      'padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;}',
      '.n3-nav-save-btn:hover{background:#B91C2C;}',
      '.n3-nav-save-btn:disabled{opacity:.5;cursor:default;}',
      '.n3-nav-reset-btn{background:#1A1A1A;color:#888888;border:1px solid #2A2A2A;',
      'border-radius:6px;padding:8px 12px;font-size:13px;cursor:pointer;',
      'transition:background .15s,color .15s;}',
      '.n3-nav-reset-btn:hover{background:#2A2A2A;color:#E5E5E5;}',
    ].join('');
    document.head.appendChild(style);
  };

  /** Build the nav panel, insert into <body>, set inst._panel. */
  window._n3wareNav.buildPanel = function buildPanel(inst) {
    if (inst._panel) return;
    const el = document.createElement('div');
    el.className = 'n3-nav-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Nav editor panel');
    el.innerHTML = _skeletonHtml();
    document.body.appendChild(el);
    inst._panel = el;
    window._n3wareNav.wirePanel(inst);
    window._n3wareNav.refreshPanel(inst);
  };

  /** Sync all panel state to current inst._data. Called by open(). */
  window._n3wareNav.refreshPanel = function refreshPanel(inst) {
    window._n3wareNav.refreshLogoPreview(inst);
    window._n3wareNav.refreshItemsList(inst);
    _syncInputs(inst);
  };

  window._n3wareNav.refreshLogoPreview = function refreshLogoPreview(inst) {
    const p = inst._panel;
    if (!p || !inst._data) return;
    const preview = p.querySelector('.n3-nav-logo-preview');
    const url = inst._data.brand && inst._data.brand.logoUrl;
    if (preview) { preview.src = url || ''; preview.style.display = url ? 'block' : 'none'; }
  };

  window._n3wareNav.refreshItemsList = function refreshItemsList(inst) {
    const p = inst._panel;
    if (!p || !inst._data) return;
    const list = p.querySelector('.n3-nav-items-list');
    if (!list) return;

    list.innerHTML = '';
    (inst._data.items || []).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'n3-nav-item-row';
      row.setAttribute('draggable', 'true');
      row.dataset.idx = idx;
      row.innerHTML = (
        `<span class="n3-nav-item-grip">${GRIP_SVG}</span>` +
        `<input class="n3-nav-item-label" type="text" value="${_esc(item.label)}" placeholder="Label" data-field="label" data-idx="${idx}">` +
        `<input class="n3-nav-item-href"  type="text" value="${_esc(item.href)}"  placeholder="/link"  data-field="href"  data-idx="${idx}">` +
        `<select class="n3-nav-item-type" data-idx="${idx}">` +
          `<option value="link"${item.type === 'link'   ? ' selected' : ''}>Link</option>` +
          `<option value="button"${item.type === 'button' ? ' selected' : ''}>Button</option>` +
        '</select>' +
        `<button class="n3-nav-item-delete" aria-label="Remove">${TRASH_SVG}</button>`
      );

      row.querySelector('.n3-nav-item-label').addEventListener('input', e => {
        inst._data.items[idx].label = e.target.value;
      });
      row.querySelector('.n3-nav-item-href').addEventListener('input', e => {
        inst._data.items[idx].href = e.target.value;
      });
      row.querySelector('.n3-nav-item-type').addEventListener('change', e => {
        inst._data.items[idx].type = e.target.value;
      });
      row.querySelector('.n3-nav-item-delete').addEventListener('click', () => {
        inst._data.items.splice(idx, 1);
        window._n3wareNav.refreshItemsList(inst);
      });

      // Drag-to-reorder
      row.addEventListener('dragstart', e => {
        inst._dragIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = inst._dragIdx;
        if (from === null || from === idx) return;
        const [moved] = inst._data.items.splice(from, 1);
        inst._data.items.splice(idx, 0, moved);
        inst._dragIdx = null;
        window._n3wareNav.refreshItemsList(inst);
      });

      list.appendChild(row);
    });
  };

  /** Wire all static controls (close, brand fields, add-item, CTA, save, reset). */
  window._n3wareNav.wirePanel = function wirePanel(inst) {
    const p = inst._panel;
    if (!p) return;

    p.querySelector('.n3-nav-close-btn').addEventListener('click', () => inst.close());

    p.querySelector('.n3-brand-text').addEventListener('input', e => {
      inst._data.brand = inst._data.brand || {};
      inst._data.brand.text = e.target.value;
    });
    p.querySelector('.n3-brand-href').addEventListener('input', e => {
      inst._data.brand = inst._data.brand || {};
      inst._data.brand.href = e.target.value;
    });

    p.querySelector('.n3-brand-logo-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        inst._data.brand = inst._data.brand || {};
        inst._data.brand.logoUrl = ev.target.result;
        window._n3wareNav.refreshLogoPreview(inst);
      };
      reader.readAsDataURL(file);
    });

    p.querySelector('.n3-nav-add-btn').addEventListener('click', () => {
      inst._data.items = inst._data.items || [];
      inst._data.items.push({ id: 'item-' + Date.now(), label: 'New Link', href: '#', type: 'link' });
      window._n3wareNav.refreshItemsList(inst);
    });

    const ctaToggle = p.querySelector('.n3-cta-toggle');
    ctaToggle.addEventListener('change', e => {
      inst._data.cta = inst._data.cta || {};
      inst._data.cta.enabled = e.target.checked;
      _syncCtaFields(inst);
    });
    p.querySelector('.n3-cta-label').addEventListener('input', e => {
      inst._data.cta = inst._data.cta || {};
      inst._data.cta.label = e.target.value;
    });
    p.querySelector('.n3-cta-href').addEventListener('input', e => {
      inst._data.cta = inst._data.cta || {};
      inst._data.cta.href = e.target.value;
    });

    p.querySelector('.n3-nav-save-btn').addEventListener('click', () => {
      window._n3wareNav.render(inst);
      window._n3wareNav.saveState(inst);
      const N3UI = window._n3wareModules && window._n3wareModules.N3UI;
      if (N3UI) N3UI.toast('Nav saved!', 'success');
    });
    p.querySelector('.n3-nav-reset-btn').addEventListener('click', () => {
      inst._data = window._n3wareNav.parseNav(inst._navEl || document.querySelector('nav'));
      window._n3wareNav.refreshPanel(inst);
    });
  };

  // ── Private ──────────────────────────────────────────────────────────────────

  function _syncInputs(inst) {
    const p = inst._panel;
    if (!p || !inst._data) return;
    const d = inst._data;
    const bt = p.querySelector('.n3-brand-text');
    const bh = p.querySelector('.n3-brand-href');
    if (bt) bt.value = (d.brand && d.brand.text) || '';
    if (bh) bh.value = (d.brand && d.brand.href) || '/';
    _syncCtaFields(inst);
  }

  function _syncCtaFields(inst) {
    const p = inst._panel;
    if (!p) return;
    const cta = (inst._data && inst._data.cta) || {};
    const toggle   = p.querySelector('.n3-cta-toggle');
    const ctaLabel = p.querySelector('.n3-cta-label');
    const ctaHref  = p.querySelector('.n3-cta-href');
    if (toggle)   toggle.checked      = Boolean(cta.enabled);
    if (ctaLabel) { ctaLabel.value    = cta.label || ''; ctaLabel.disabled = !cta.enabled; }
    if (ctaHref)  { ctaHref.value     = cta.href  || ''; ctaHref.disabled  = !cta.enabled; }
  }

  function _skeletonHtml() {
    return (
      '<div class="n3-nav-header">' +
        '<span class="n3-nav-title">Navigation</span>' +
        `<button class="n3-nav-close-btn" aria-label="Close">${CLOSE_SVG}</button>` +
      '</div>' +

      '<div class="n3-nav-body">' +
        '<div class="n3-nav-section"><h3>Brand</h3>' +
          '<div class="n3-nav-upload-slot">' +
            '<img class="n3-nav-logo-preview" style="display:none" alt="Logo">' +
            '<span class="n3-nav-upload-hint">Click to upload logo</span>' +
            '<input type="file" class="n3-brand-logo-file" accept="image/*">' +
          '</div>' +
          '<div class="n3-nav-field"><span class="n3-nav-field-label">Brand text</span>' +
            '<input type="text" class="n3-nav-input n3-brand-text" placeholder="My Brand"></div>' +
          '<div class="n3-nav-field"><span class="n3-nav-field-label">Brand link</span>' +
            '<input type="text" class="n3-nav-input n3-brand-href" placeholder="/"></div>' +
        '</div>' +

        '<div class="n3-nav-section"><h3>Menu items</h3>' +
          '<div class="n3-nav-items-list"></div>' +
          `<button class="n3-nav-add-btn">${PLUS_SVG} Add Item</button>` +
        '</div>' +

        '<div class="n3-nav-section"><h3>CTA button</h3>' +
          '<div class="n3-nav-toggle-row">' +
            '<span class="n3-nav-toggle-label">Enable CTA</span>' +
            '<input type="checkbox" class="n3-nav-toggle n3-cta-toggle">' +
          '</div>' +
          '<div class="n3-nav-field"><span class="n3-nav-field-label">Label</span>' +
            '<input type="text" class="n3-nav-input n3-cta-label" placeholder="Get Started" disabled></div>' +
          '<div class="n3-nav-field"><span class="n3-nav-field-label">Link</span>' +
            '<input type="text" class="n3-nav-input n3-cta-href" placeholder="#" disabled></div>' +
        '</div>' +
      '</div>' +

      '<div class="n3-nav-footer">' +
        '<button class="n3-nav-reset-btn">Reset</button>' +
        '<button class="n3-nav-save-btn">Save Nav</button>' +
      '</div>'
    );
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
