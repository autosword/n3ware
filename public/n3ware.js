/**
 * n3ware.js — Visual editor for any webpage
 * Zero dependencies. Single script tag activation.
 * https://github.com/autosword/n3ware
 */
(function (global) {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const ACCENT = '#3B82F6';
  const ACCENT_DARK = '#2563EB';
  const BG_DARK = '#0F172A';
  const BG_PANEL = '#1E293B';
  const BG_TOOLBAR = '#1E293B';
  const BORDER = '#334155';
  const TEXT = '#F1F5F9';
  const TEXT_MUTED = '#94A3B8';

  const TEXT_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, span, li, a, blockquote, td, th, label, dt, dd';
  const BLOCK_SELECTORS = 'div, section, article, header, footer, main, aside, nav, figure, p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, table, form, img';

  // ─── State ────────────────────────────────────────────────────────────────
  let editMode = false;
  let activeElement = null;
  let dragSrc = null;
  let dragIndicator = null;
  let historyStack = [];
  let historyIndex = -1;
  let formattingBar = null;
  let stylePanel = null;
  let toolbar = null;
  let editBtn = null;
  let isSaving = false;

  // ─── CSS Injection ────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('n3ware-styles')) return;
    const style = document.createElement('style');
    style.id = 'n3ware-styles';
    style.textContent = `
      /* n3ware base */
      .n3-edit-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        background: ${ACCENT};
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 10px 20px;
        font: 600 14px/1 system-ui, sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 24px rgba(59,130,246,0.4);
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s;
        letter-spacing: 0.02em;
      }
      .n3-edit-btn:hover { background: ${ACCENT_DARK}; transform: translateY(-1px); }
      .n3-edit-btn.n3-active { background: #EF4444; box-shadow: 0 4px 24px rgba(239,68,68,0.4); }

      /* Toolbar */
      .n3-toolbar {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 999998;
        background: ${BG_TOOLBAR};
        border-bottom: 1px solid ${BORDER};
        display: flex;
        align-items: center;
        padding: 0 16px;
        height: 48px;
        gap: 8px;
        font: 13px/1 system-ui, sans-serif;
        color: ${TEXT};
        box-shadow: 0 2px 16px rgba(0,0,0,0.4);
        transform: translateY(-100%);
        transition: transform 0.2s ease;
      }
      .n3-toolbar.n3-visible { transform: translateY(0); }
      .n3-toolbar-logo {
        font-weight: 700;
        color: ${ACCENT};
        margin-right: 8px;
        font-size: 15px;
        letter-spacing: -0.5px;
      }
      .n3-toolbar-sep {
        width: 1px; height: 24px;
        background: ${BORDER};
        margin: 0 4px;
      }
      .n3-toolbar-btn {
        background: transparent;
        border: 1px solid transparent;
        color: ${TEXT};
        padding: 5px 12px;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
        display: flex; align-items: center; gap: 6px;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .n3-toolbar-btn:hover { background: rgba(255,255,255,0.08); border-color: ${BORDER}; }
      .n3-toolbar-btn.n3-danger:hover { background: rgba(239,68,68,0.15); color: #F87171; border-color: rgba(239,68,68,0.3); }
      .n3-toolbar-spacer { flex: 1; }

      /* Undo/redo badge */
      .n3-history-count {
        font-size: 11px;
        color: ${TEXT_MUTED};
        background: rgba(255,255,255,0.06);
        padding: 2px 6px;
        border-radius: 4px;
      }

      /* Edit mode body offset */
      body.n3-editing { margin-top: 48px !important; }

      /* Editable element highlight */
      [data-n3-editable]:focus {
        outline: 2px solid ${ACCENT} !important;
        outline-offset: 2px !important;
        border-radius: 2px;
      }
      [data-n3-editable] { cursor: text !important; }

      /* Hover overlay for block elements */
      .n3-hovered {
        outline: 1.5px dashed rgba(59,130,246,0.5) !important;
        outline-offset: 1px;
      }
      .n3-selected {
        outline: 2px solid ${ACCENT} !important;
        outline-offset: 2px;
      }

      /* Element control overlay */
      .n3-controls {
        position: absolute;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 2px;
        background: ${BG_PANEL};
        border: 1px solid ${BORDER};
        border-radius: 6px;
        padding: 3px 4px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        pointer-events: all;
        animation: n3-fade-in 0.12s ease;
      }
      @keyframes n3-fade-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
      .n3-ctrl-btn {
        background: transparent;
        border: none;
        color: ${TEXT_MUTED};
        width: 24px; height: 24px;
        border-radius: 4px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px;
        transition: all 0.12s;
      }
      .n3-ctrl-btn:hover { background: rgba(255,255,255,0.1); color: ${TEXT}; }
      .n3-ctrl-btn.n3-drag-handle { cursor: grab; color: ${TEXT_MUTED}; font-size: 14px; }
      .n3-ctrl-btn.n3-drag-handle:active { cursor: grabbing; }
      .n3-ctrl-btn.n3-delete:hover { background: rgba(239,68,68,0.2); color: #F87171; }
      .n3-ctrl-btn.n3-dup:hover { background: rgba(59,130,246,0.2); color: ${ACCENT}; }
      .n3-type-label {
        font: 11px/1 system-ui, sans-serif;
        color: ${TEXT_MUTED};
        padding: 0 6px;
        border-right: 1px solid ${BORDER};
        margin-right: 2px;
      }

      /* Drag indicator line */
      .n3-drop-line {
        position: fixed;
        height: 3px;
        background: ${ACCENT};
        border-radius: 2px;
        z-index: 999999;
        pointer-events: none;
        box-shadow: 0 0 8px rgba(59,130,246,0.6);
        transition: top 0.05s, left 0.05s, width 0.05s;
      }

      /* Dragging state */
      .n3-dragging {
        opacity: 0.4 !important;
        transform: scale(0.98) !important;
        transition: opacity 0.1s, transform 0.1s !important;
      }

      /* Formatting toolbar */
      .n3-format-bar {
        position: fixed;
        z-index: 999999;
        background: ${BG_PANEL};
        border: 1px solid ${BORDER};
        border-radius: 8px;
        padding: 5px 6px;
        display: flex; align-items: center; gap: 2px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        animation: n3-fade-in 0.12s ease;
        flex-wrap: wrap;
        max-width: 480px;
      }
      .n3-fmt-btn {
        background: transparent;
        border: 1px solid transparent;
        color: ${TEXT};
        min-width: 28px; height: 28px;
        border-radius: 5px;
        cursor: pointer;
        font: 600 13px/1 system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        padding: 0 6px;
        transition: all 0.12s;
        gap: 4px;
      }
      .n3-fmt-btn:hover { background: rgba(255,255,255,0.1); border-color: ${BORDER}; }
      .n3-fmt-btn.n3-active-fmt { background: ${ACCENT}; color: #fff; }
      .n3-fmt-sep { width: 1px; height: 20px; background: ${BORDER}; margin: 0 2px; }
      .n3-fmt-select {
        background: rgba(255,255,255,0.06);
        border: 1px solid ${BORDER};
        color: ${TEXT};
        border-radius: 5px;
        padding: 0 6px;
        height: 28px;
        font: 12px/1 system-ui, sans-serif;
        cursor: pointer;
        outline: none;
      }
      .n3-fmt-select:hover { border-color: ${ACCENT}; }
      .n3-color-btn {
        position: relative;
        width: 28px; height: 28px;
      }
      .n3-color-btn input[type=color] {
        position: absolute; inset: 0;
        opacity: 0; cursor: pointer; width: 100%; height: 100%;
      }
      .n3-color-swatch {
        width: 28px; height: 28px;
        border-radius: 5px;
        border: 1px solid ${BORDER};
        display: flex; align-items: center; justify-content: center;
        font-size: 12px;
        pointer-events: none;
        transition: border-color 0.12s;
      }
      .n3-color-btn:hover .n3-color-swatch { border-color: ${ACCENT}; }

      /* Style Panel */
      .n3-style-panel {
        position: fixed;
        top: 48px; right: 0;
        width: 280px;
        height: calc(100vh - 48px);
        background: ${BG_PANEL};
        border-left: 1px solid ${BORDER};
        z-index: 999997;
        overflow-y: auto;
        font: 13px/1 system-ui, sans-serif;
        color: ${TEXT};
        display: none;
        flex-direction: column;
        box-shadow: -4px 0 24px rgba(0,0,0,0.3);
        animation: n3-slide-in 0.2s ease;
      }
      @keyframes n3-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
      .n3-style-panel.n3-panel-open { display: flex; }
      .n3-panel-header {
        padding: 16px;
        border-bottom: 1px solid ${BORDER};
        display: flex; align-items: center; justify-content: space-between;
        position: sticky; top: 0;
        background: ${BG_PANEL};
        z-index: 1;
      }
      .n3-panel-title { font-weight: 600; font-size: 14px; }
      .n3-panel-tag {
        font-size: 11px;
        color: ${ACCENT};
        background: rgba(59,130,246,0.15);
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
      }
      .n3-panel-close {
        background: transparent; border: none;
        color: ${TEXT_MUTED}; cursor: pointer; font-size: 16px;
        width: 24px; height: 24px; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.12s;
      }
      .n3-panel-close:hover { background: rgba(255,255,255,0.1); color: ${TEXT}; }
      .n3-panel-section { padding: 14px 16px; border-bottom: 1px solid ${BORDER}; }
      .n3-section-title {
        font-size: 11px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: ${TEXT_MUTED};
        margin-bottom: 12px;
      }
      .n3-field { margin-bottom: 10px; }
      .n3-field-label {
        font-size: 11px; color: ${TEXT_MUTED};
        margin-bottom: 5px; display: flex;
        justify-content: space-between; align-items: center;
      }
      .n3-field-value { color: ${TEXT}; font-size: 11px; font-weight: 600; }
      .n3-slider {
        width: 100%; height: 4px;
        -webkit-appearance: none;
        background: ${BORDER};
        border-radius: 2px;
        outline: none;
        cursor: pointer;
      }
      .n3-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px; height: 14px;
        background: ${ACCENT};
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 0 2px rgba(59,130,246,0.3);
      }
      .n3-panel-color {
        width: 100%; height: 36px;
        border: 1px solid ${BORDER};
        border-radius: 6px;
        cursor: pointer;
        background: transparent;
        padding: 2px 4px;
      }
      .n3-class-input {
        width: 100%;
        background: rgba(255,255,255,0.05);
        border: 1px solid ${BORDER};
        color: ${TEXT};
        border-radius: 6px;
        padding: 7px 10px;
        font: 12px/1 monospace;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s;
      }
      .n3-class-input:focus { border-color: ${ACCENT}; }

      /* Toast notifications */
      .n3-toast {
        position: fixed;
        bottom: 80px; right: 24px;
        z-index: 9999999;
        background: ${BG_PANEL};
        border: 1px solid ${BORDER};
        color: ${TEXT};
        padding: 10px 16px;
        border-radius: 8px;
        font: 13px/1.4 system-ui, sans-serif;
        box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        animation: n3-toast-in 0.2s ease;
        display: flex; align-items: center; gap: 8px;
        max-width: 300px;
      }
      .n3-toast.n3-toast-success { border-left: 3px solid #22C55E; }
      .n3-toast.n3-toast-error { border-left: 3px solid #EF4444; }
      .n3-toast.n3-toast-info { border-left: 3px solid ${ACCENT}; }
      @keyframes n3-toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes n3-toast-out { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(8px); } }

      /* Confirm dialog */
      .n3-confirm-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        z-index: 9999998;
        display: flex; align-items: center; justify-content: center;
        animation: n3-fade-in 0.15s ease;
      }
      .n3-confirm-box {
        background: ${BG_PANEL};
        border: 1px solid ${BORDER};
        border-radius: 12px;
        padding: 24px;
        width: 320px;
        box-shadow: 0 16px 64px rgba(0,0,0,0.6);
      }
      .n3-confirm-title { font-weight: 600; font-size: 16px; margin-bottom: 8px; }
      .n3-confirm-msg { color: ${TEXT_MUTED}; font-size: 13px; line-height: 1.5; margin-bottom: 20px; }
      .n3-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .n3-confirm-btn {
        padding: 8px 18px; border-radius: 6px; border: none;
        cursor: pointer; font: 600 13px/1 system-ui, sans-serif;
        transition: all 0.12s;
      }
      .n3-confirm-cancel { background: rgba(255,255,255,0.08); color: ${TEXT}; }
      .n3-confirm-cancel:hover { background: rgba(255,255,255,0.14); }
      .n3-confirm-ok { background: #EF4444; color: #fff; }
      .n3-confirm-ok:hover { background: #DC2626; }
    `;
    document.head.appendChild(style);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 2500) {
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `n3-toast n3-toast-${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'n3-toast-out 0.2s ease forwards';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  function confirm(title, msg) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'n3-confirm-overlay';
      overlay.innerHTML = `
        <div class="n3-confirm-box">
          <div class="n3-confirm-title">${title}</div>
          <div class="n3-confirm-msg">${msg}</div>
          <div class="n3-confirm-actions">
            <button class="n3-confirm-btn n3-confirm-cancel">Cancel</button>
            <button class="n3-confirm-btn n3-confirm-ok">Delete</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.n3-confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
      overlay.querySelector('.n3-confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
  }

  function getElType(el) {
    return el.tagName.toLowerCase();
  }

  function isEditorElement(el) {
    return el && (
      el.closest('.n3-controls') ||
      el.closest('.n3-format-bar') ||
      el.closest('.n3-style-panel') ||
      el.closest('.n3-toolbar') ||
      el.closest('.n3-edit-btn') ||
      el.closest('.n3-confirm-overlay') ||
      el.closest('.n3-toast')
    );
  }

  // ─── History ──────────────────────────────────────────────────────────────
  function snapshot() {
    const html = document.body.innerHTML;
    if (historyStack[historyIndex] === html) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(html);
    historyIndex = historyStack.length - 1;
    updateHistoryUI();
  }

  function undo() {
    if (historyIndex <= 0) { toast('Nothing to undo', 'info'); return; }
    historyIndex--;
    restoreSnapshot();
    toast('Undo', 'info', 1200);
  }

  function redo() {
    if (historyIndex >= historyStack.length - 1) { toast('Nothing to redo', 'info'); return; }
    historyIndex++;
    restoreSnapshot();
    toast('Redo', 'info', 1200);
  }

  function restoreSnapshot() {
    document.body.innerHTML = historyStack[historyIndex];
    // Re-init editor elements since they were destroyed
    rebuildEditorUI();
    if (editMode) {
      applyEditMode();
    }
    updateHistoryUI();
  }

  function updateHistoryUI() {
    const el = document.querySelector('.n3-history-count');
    if (el) el.textContent = `${historyIndex + 1}/${historyStack.length}`;
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────────
  function buildToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'n3-toolbar';
    toolbar.setAttribute('data-n3-ui', '1');
    toolbar.innerHTML = `
      <span class="n3-toolbar-logo">n3ware</span>
      <div class="n3-toolbar-sep"></div>
      <button class="n3-toolbar-btn" data-action="undo" title="Undo (Ctrl+Z)">↩ Undo</button>
      <button class="n3-toolbar-btn" data-action="redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
      <span class="n3-history-count">1/1</span>
      <div class="n3-toolbar-sep"></div>
      <button class="n3-toolbar-btn" data-action="save-html" title="Download HTML">⬇ Download</button>
      <button class="n3-toolbar-btn" data-action="copy-html" title="Copy HTML">⎘ Copy HTML</button>
      <button class="n3-toolbar-btn" data-action="json-diff" title="JSON diff of changes">{ } Diff</button>
      <div class="n3-toolbar-spacer"></div>
      <button class="n3-toolbar-btn n3-danger" data-action="exit-edit">✕ Exit Editor</button>
    `;
    document.body.appendChild(toolbar);

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      switch (btn.dataset.action) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'save-html': exportHTML(); break;
        case 'copy-html': copyHTML(); break;
        case 'json-diff': showDiff(); break;
        case 'exit-edit': toggleEditMode(false); break;
      }
    });
  }

  function buildEditButton() {
    editBtn = document.createElement('button');
    editBtn.className = 'n3-edit-btn';
    editBtn.setAttribute('data-n3-ui', '1');
    editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
    editBtn.title = 'Toggle Edit Mode (Ctrl+Shift+E)';
    editBtn.addEventListener('click', () => toggleEditMode());
    document.body.appendChild(editBtn);
  }

  function buildStylePanel() {
    stylePanel = document.createElement('div');
    stylePanel.className = 'n3-style-panel';
    stylePanel.setAttribute('data-n3-ui', '1');
    stylePanel.innerHTML = `
      <div class="n3-panel-header">
        <div>
          <div class="n3-panel-title">Style</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="n3-panel-tag" id="n3-sel-tag">—</span>
          <button class="n3-panel-close" id="n3-panel-close">✕</button>
        </div>
      </div>

      <div class="n3-panel-section">
        <div class="n3-section-title">Colors</div>
        <div class="n3-field">
          <div class="n3-field-label">Background</div>
          <input type="color" id="n3-bg-color" class="n3-panel-color" value="#ffffff">
        </div>
        <div class="n3-field">
          <div class="n3-field-label">Text Color</div>
          <input type="color" id="n3-text-color" class="n3-panel-color" value="#000000">
        </div>
      </div>

      <div class="n3-panel-section">
        <div class="n3-section-title">Spacing</div>
        <div class="n3-field">
          <div class="n3-field-label">Padding <span class="n3-field-value" id="n3-pad-val">0px</span></div>
          <input type="range" class="n3-slider" id="n3-padding" min="0" max="80" step="1" value="0">
        </div>
        <div class="n3-field">
          <div class="n3-field-label">Margin <span class="n3-field-value" id="n3-mar-val">0px</span></div>
          <input type="range" class="n3-slider" id="n3-margin" min="0" max="80" step="1" value="0">
        </div>
      </div>

      <div class="n3-panel-section">
        <div class="n3-section-title">Appearance</div>
        <div class="n3-field">
          <div class="n3-field-label">Border Radius <span class="n3-field-value" id="n3-rad-val">0px</span></div>
          <input type="range" class="n3-slider" id="n3-radius" min="0" max="50" step="1" value="0">
        </div>
        <div class="n3-field">
          <div class="n3-field-label">Opacity <span class="n3-field-value" id="n3-opa-val">100%</span></div>
          <input type="range" class="n3-slider" id="n3-opacity" min="0" max="100" step="1" value="100">
        </div>
      </div>

      <div class="n3-panel-section">
        <div class="n3-section-title">CSS Classes</div>
        <div class="n3-field">
          <input type="text" class="n3-class-input" id="n3-classes" placeholder="e.g. container hero flex">
        </div>
      </div>
    `;
    document.body.appendChild(stylePanel);

    document.getElementById('n3-panel-close').onclick = () => {
      deactivateElement();
    };

    // Wire up panel controls
    const bindSlider = (id, valId, prop, unit) => {
      const slider = document.getElementById(id);
      const val = document.getElementById(valId);
      slider.oninput = () => {
        val.textContent = slider.value + unit;
        if (activeElement) {
          activeElement.style[prop] = slider.value + 'px';
          if (prop === 'opacity') activeElement.style.opacity = slider.value / 100;
          snapshot();
        }
      };
    };
    bindSlider('n3-padding', 'n3-pad-val', 'padding', 'px');
    bindSlider('n3-margin', 'n3-mar-val', 'margin', 'px');
    bindSlider('n3-radius', 'n3-rad-val', 'borderRadius', 'px');

    document.getElementById('n3-opacity').oninput = function () {
      document.getElementById('n3-opa-val').textContent = this.value + '%';
      if (activeElement) { activeElement.style.opacity = this.value / 100; snapshot(); }
    };

    document.getElementById('n3-bg-color').oninput = function () {
      if (activeElement) { activeElement.style.backgroundColor = this.value; snapshot(); }
    };
    document.getElementById('n3-text-color').oninput = function () {
      if (activeElement) { activeElement.style.color = this.value; snapshot(); }
    };
    document.getElementById('n3-classes').oninput = function () {
      if (!activeElement) return;
      // Preserve n3- classes
      const n3Classes = Array.from(activeElement.classList).filter(c => c.startsWith('n3-'));
      activeElement.className = '';
      n3Classes.forEach(c => activeElement.classList.add(c));
      this.value.trim().split(/\s+/).filter(Boolean).forEach(c => activeElement.classList.add(c));
      snapshot();
    };
  }

  function syncPanelToElement(el) {
    if (!el || !stylePanel) return;
    const cs = window.getComputedStyle(el);
    const tag = document.getElementById('n3-sel-tag');
    if (tag) tag.textContent = getElType(el);

    const toHex = (color) => {
      if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return '#ffffff';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map(x => x.toString(16).padStart(2, '0')).join('');
    };

    const bg = document.getElementById('n3-bg-color');
    const tc = document.getElementById('n3-text-color');
    if (bg) bg.value = toHex(cs.backgroundColor);
    if (tc) tc.value = toHex(cs.color);

    const pad = parseInt(cs.paddingTop) || 0;
    const mar = parseInt(cs.marginTop) || 0;
    const rad = parseInt(cs.borderRadius) || 0;
    const opa = Math.round((parseFloat(cs.opacity) || 1) * 100);

    const setSlider = (id, valId, val, unit) => {
      const s = document.getElementById(id);
      const v = document.getElementById(valId);
      if (s) s.value = val;
      if (v) v.textContent = val + unit;
    };
    setSlider('n3-padding', 'n3-pad-val', pad, 'px');
    setSlider('n3-margin', 'n3-mar-val', mar, 'px');
    setSlider('n3-radius', 'n3-rad-val', rad, 'px');
    setSlider('n3-opacity', 'n3-opa-val', opa, '%');

    const classInput = document.getElementById('n3-classes');
    if (classInput) {
      const userClasses = Array.from(el.classList).filter(c => !c.startsWith('n3-'));
      classInput.value = userClasses.join(' ');
    }
  }

  // ─── Edit Mode ────────────────────────────────────────────────────────────
  function toggleEditMode(force) {
    editMode = (force !== undefined) ? force : !editMode;
    if (editMode) {
      snapshot(); // save initial state
      applyEditMode();
      toolbar.classList.add('n3-visible');
      document.body.classList.add('n3-editing');
      editBtn.classList.add('n3-active');
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg> Editing`;
      toast('Edit mode on — click any element to edit', 'success');
    } else {
      removeEditMode();
      toolbar.classList.remove('n3-visible');
      document.body.classList.remove('n3-editing');
      editBtn.classList.remove('n3-active');
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
      toast('Edit mode off', 'info', 1500);
    }
  }

  function applyEditMode() {
    // Make text elements editable
    document.querySelectorAll(TEXT_SELECTORS).forEach(el => {
      if (isEditorElement(el)) return;
      el.setAttribute('data-n3-editable', '1');
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
    });

    // Set up hover + controls for block elements
    document.querySelectorAll(BLOCK_SELECTORS).forEach(el => {
      if (isEditorElement(el)) return;
      el.setAttribute('data-n3-block', '1');
    });

    document.addEventListener('mouseover', onHover);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('click', onClickElement, true);
    document.addEventListener('focus', onFocus, true);
  }

  function removeEditMode() {
    deactivateElement();
    removeAllControls();
    removeFormattingBar();

    document.querySelectorAll('[data-n3-editable]').forEach(el => {
      el.removeAttribute('data-n3-editable');
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
    });
    document.querySelectorAll('[data-n3-block]').forEach(el => {
      el.removeAttribute('data-n3-block');
      el.classList.remove('n3-hovered', 'n3-selected');
    });

    document.removeEventListener('mouseover', onHover);
    document.removeEventListener('mouseout', onMouseOut);
    document.removeEventListener('click', onClickElement, true);
    document.removeEventListener('focus', onFocus, true);
  }

  // ─── Hover Controls ───────────────────────────────────────────────────────
  let currentHovered = null;
  let controlsEl = null;

  function onHover(e) {
    if (!editMode) return;
    if (isEditorElement(e.target)) return;
    const el = e.target.closest('[data-n3-block]');
    if (!el || el === currentHovered) return;
    removeAllControls();
    currentHovered = el;
    el.classList.add('n3-hovered');
    showControls(el);
  }

  function onMouseOut(e) {
    if (!editMode) return;
    if (e.relatedTarget && (e.relatedTarget.closest('.n3-controls') || e.relatedTarget === currentHovered)) return;
    if (currentHovered && !activeElement) {
      currentHovered.classList.remove('n3-hovered');
      currentHovered = null;
    }
    removeAllControls();
  }

  function showControls(el) {
    if (!el) return;
    removeAllControls();

    controlsEl = document.createElement('div');
    controlsEl.className = 'n3-controls';
    controlsEl.setAttribute('data-n3-ui', '1');

    const typeLabel = document.createElement('span');
    typeLabel.className = 'n3-type-label';
    typeLabel.textContent = getElType(el);
    controlsEl.appendChild(typeLabel);

    // Drag handle
    const drag = makeCtrlBtn('⠿', 'Drag to reorder', 'n3-drag-handle');
    drag.draggable = false;
    drag.addEventListener('mousedown', (e) => startDrag(e, el));
    controlsEl.appendChild(drag);

    // Duplicate
    const dup = makeCtrlBtn('+', 'Duplicate', 'n3-dup');
    dup.addEventListener('click', (e) => { e.stopPropagation(); duplicateEl(el); });
    controlsEl.appendChild(dup);

    // Delete
    const del = makeCtrlBtn('×', 'Delete element', 'n3-delete');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirm('Delete element?', `Remove this <${getElType(el)}> element? This can be undone with Ctrl+Z.`);
      if (ok) { snapshot(); el.remove(); removeAllControls(); toast('Element deleted', 'info'); }
    });
    controlsEl.appendChild(del);

    positionControls(el);
    document.body.appendChild(controlsEl);

    // Reposition on scroll/resize
    const reposition = () => positionControls(el);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    controlsEl._cleanup = () => {
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };

    // Keep visible when hovering controls
    controlsEl.addEventListener('mouseenter', () => {
      if (currentHovered) currentHovered.classList.add('n3-hovered');
    });
    controlsEl.addEventListener('mouseleave', () => {
      if (currentHovered && el !== activeElement) {
        currentHovered.classList.remove('n3-hovered');
        currentHovered = null;
        removeAllControls();
      }
    });
  }

  function makeCtrlBtn(label, title, extraClass) {
    const btn = document.createElement('button');
    btn.className = `n3-ctrl-btn ${extraClass}`;
    btn.title = title;
    btn.textContent = label;
    return btn;
  }

  function positionControls(el) {
    if (!controlsEl) return;
    const rect = el.getBoundingClientRect();
    controlsEl.style.top = (rect.top + window.scrollY - controlsEl.offsetHeight - 4) + 'px';
    controlsEl.style.left = (rect.left + window.scrollX) + 'px';
  }

  function removeAllControls() {
    if (controlsEl) {
      if (controlsEl._cleanup) controlsEl._cleanup();
      controlsEl.remove();
      controlsEl = null;
    }
  }

  // ─── Click / Focus handlers ───────────────────────────────────────────────
  function onClickElement(e) {
    if (!editMode) return;
    if (isEditorElement(e.target)) return;

    const block = e.target.closest('[data-n3-block]');
    if (block) {
      activateElement(block);
    }
  }

  function onFocus(e) {
    if (!editMode) return;
    if (isEditorElement(e.target)) return;
    const el = e.target.closest('[data-n3-editable]') || e.target.closest('[data-n3-block]');
    if (el) activateElement(el);

    // Show formatting bar for text elements
    if (e.target.closest('[data-n3-editable]')) {
      setTimeout(() => showFormattingBar(e.target.closest('[data-n3-editable]')), 50);
    }
  }

  function activateElement(el) {
    if (activeElement) activeElement.classList.remove('n3-selected');
    activeElement = el;
    el.classList.add('n3-selected');
    stylePanel.classList.add('n3-panel-open');
    syncPanelToElement(el);
  }

  function deactivateElement() {
    if (activeElement) {
      activeElement.classList.remove('n3-selected');
      activeElement = null;
    }
    if (stylePanel) stylePanel.classList.remove('n3-panel-open');
    removeFormattingBar();
  }

  // ─── Duplicate ─────────────────────────────────────────────────────────────
  function duplicateEl(el) {
    snapshot();
    const clone = el.cloneNode(true);
    clone.removeAttribute('data-n3-editable');
    clone.removeAttribute('contenteditable');
    el.parentNode.insertBefore(clone, el.nextSibling);

    // Re-init editable on clone
    if (editMode) {
      clone.querySelectorAll(TEXT_SELECTORS).forEach(t => {
        t.setAttribute('data-n3-editable', '1');
        t.setAttribute('contenteditable', 'true');
        t.setAttribute('spellcheck', 'false');
      });
      clone.setAttribute('data-n3-block', '1');
    }
    toast('Duplicated', 'success', 1500);
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────────
  function startDrag(e, el) {
    e.preventDefault();
    dragSrc = el;
    el.classList.add('n3-dragging');
    removeAllControls();

    const onMove = (ev) => {
      const clientY = ev.clientY || (ev.touches && ev.touches[0].clientY);
      const clientX = ev.clientX || (ev.touches && ev.touches[0].clientX);
      showDropIndicator(clientX, clientY, el);
    };
    const onUp = (ev) => {
      const clientY = ev.clientY || (ev.changedTouches && ev.changedTouches[0].clientY);
      const clientX = ev.clientX || (ev.changedTouches && ev.changedTouches[0].clientX);
      endDrag(clientX, clientY, el);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function showDropIndicator(x, y, draggedEl) {
    if (!dragIndicator) {
      dragIndicator = document.createElement('div');
      dragIndicator.className = 'n3-drop-line';
      dragIndicator.setAttribute('data-n3-ui', '1');
      document.body.appendChild(dragIndicator);
    }

    const siblings = getSiblings(draggedEl);
    let best = null;
    let bestDist = Infinity;

    siblings.forEach(sib => {
      if (sib === draggedEl || isEditorElement(sib)) return;
      const rect = sib.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dist = Math.abs(y - midY);
      if (dist < bestDist) { bestDist = dist; best = { el: sib, above: y < midY, rect }; }
    });

    if (best) {
      const rect = best.rect;
      const lineY = best.above ? rect.top - 2 : rect.bottom + 1;
      dragIndicator.style.top = (lineY + window.scrollY) + 'px';
      dragIndicator.style.left = rect.left + 'px';
      dragIndicator.style.width = rect.width + 'px';
      dragIndicator._dropTarget = best;
    }
  }

  function endDrag(x, y, el) {
    el.classList.remove('n3-dragging');
    if (dragIndicator && dragIndicator._dropTarget) {
      const { el: target, above } = dragIndicator._dropTarget;
      if (target !== el) {
        snapshot();
        if (above) target.parentNode.insertBefore(el, target);
        else target.parentNode.insertBefore(el, target.nextSibling);
        toast('Reordered', 'info', 1200);
      }
    }
    if (dragIndicator) { dragIndicator.remove(); dragIndicator = null; }
    dragSrc = null;
  }

  function getSiblings(el) {
    return el.parentNode ? Array.from(el.parentNode.children) : [];
  }

  // ─── Formatting Bar ───────────────────────────────────────────────────────
  function showFormattingBar(el) {
    removeFormattingBar();
    formattingBar = document.createElement('div');
    formattingBar.className = 'n3-format-bar';
    formattingBar.setAttribute('data-n3-ui', '1');

    const execCmd = (cmd, val) => {
      el.focus();
      document.execCommand(cmd, false, val || null);
      snapshot();
      updateFormatState();
    };

    // Bold, Italic, Underline
    const boldBtn = makeFmtBtn('<b>B</b>', 'Bold (Ctrl+B)', () => execCmd('bold'));
    boldBtn.id = 'n3-fmt-bold';
    const italicBtn = makeFmtBtn('<i>I</i>', 'Italic (Ctrl+I)', () => execCmd('italic'));
    italicBtn.id = 'n3-fmt-italic';
    const underBtn = makeFmtBtn('<u>U</u>', 'Underline (Ctrl+U)', () => execCmd('underline'));
    underBtn.id = 'n3-fmt-underline';

    formattingBar.append(boldBtn, italicBtn, underBtn);
    formattingBar.appendChild(makeSep());

    // Alignment
    const alignL = makeFmtBtn('⇤', 'Align Left', () => execCmd('justifyLeft'));
    const alignC = makeFmtBtn('≡', 'Align Center', () => execCmd('justifyCenter'));
    const alignR = makeFmtBtn('⇥', 'Align Right', () => execCmd('justifyRight'));
    formattingBar.append(alignL, alignC, alignR);
    formattingBar.appendChild(makeSep());

    // Heading level
    const headSel = document.createElement('select');
    headSel.className = 'n3-fmt-select';
    headSel.title = 'Heading level';
    [['—', ''], ['H1', 'h1'], ['H2', 'h2'], ['H3', 'h3'], ['H4', 'h4'], ['P', 'p']].forEach(([label, val]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      headSel.appendChild(opt);
    });
    headSel.onchange = () => {
      if (headSel.value) document.execCommand('formatBlock', false, headSel.value);
      snapshot();
    };
    formattingBar.appendChild(headSel);

    // Font size
    const sizeSel = document.createElement('select');
    sizeSel.className = 'n3-fmt-select';
    sizeSel.title = 'Font size';
    [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s + 'px';
      if (s === 16) opt.selected = true;
      sizeSel.appendChild(opt);
    });
    sizeSel.onchange = () => {
      el.style.fontSize = sizeSel.value + 'px';
      snapshot();
    };
    formattingBar.appendChild(sizeSel);
    formattingBar.appendChild(makeSep());

    // Text color
    const colorWrap = document.createElement('div');
    colorWrap.className = 'n3-color-btn';
    colorWrap.title = 'Text color';
    const colorInput = document.createElement('input');
    colorInput.type = 'color'; colorInput.value = '#000000';
    colorInput.oninput = () => execCmd('foreColor', colorInput.value);
    const colorSwatch = document.createElement('div');
    colorSwatch.className = 'n3-color-swatch';
    colorSwatch.textContent = 'A';
    colorSwatch.style.color = colorInput.value;
    colorInput.oninput = () => {
      execCmd('foreColor', colorInput.value);
      colorSwatch.style.color = colorInput.value;
    };
    colorWrap.append(colorInput, colorSwatch);
    formattingBar.appendChild(colorWrap);

    // Link
    const linkBtn = makeFmtBtn('🔗', 'Insert Link', () => {
      const url = prompt('Enter URL:');
      if (url) execCmd('createLink', url);
    });
    formattingBar.appendChild(linkBtn);

    document.body.appendChild(formattingBar);
    positionFormattingBar(el);
    updateFormatState();

    document.addEventListener('selectionchange', updateFormatState);
  }

  function makeFmtBtn(html, title, onclick) {
    const btn = document.createElement('button');
    btn.className = 'n3-fmt-btn';
    btn.title = title;
    btn.innerHTML = html;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', onclick);
    return btn;
  }

  function makeSep() {
    const sep = document.createElement('div');
    sep.className = 'n3-fmt-sep';
    return sep;
  }

  function positionFormattingBar(el) {
    if (!formattingBar) return;
    const rect = el.getBoundingClientRect();
    const barH = 46;
    let top = rect.top + window.scrollY - barH - 8;
    if (top < 56) top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;
    const maxLeft = window.innerWidth - formattingBar.offsetWidth - 16;
    left = Math.min(left, maxLeft);
    formattingBar.style.top = top + 'px';
    formattingBar.style.left = Math.max(8, left) + 'px';
  }

  function updateFormatState() {
    if (!formattingBar) return;
    const bold = document.getElementById('n3-fmt-bold');
    const italic = document.getElementById('n3-fmt-italic');
    const under = document.getElementById('n3-fmt-underline');
    if (bold) bold.classList.toggle('n3-active-fmt', document.queryCommandState('bold'));
    if (italic) italic.classList.toggle('n3-active-fmt', document.queryCommandState('italic'));
    if (under) under.classList.toggle('n3-active-fmt', document.queryCommandState('underline'));
  }

  function removeFormattingBar() {
    if (formattingBar) {
      formattingBar.remove();
      formattingBar = null;
      document.removeEventListener('selectionchange', updateFormatState);
    }
  }

  // ─── Export / Save ─────────────────────────────────────────────────────────
  function getCleanHTML() {
    const clone = document.documentElement.cloneNode(true);
    // Remove all editor UI
    clone.querySelectorAll('[data-n3-ui]').forEach(e => e.remove());
    clone.querySelectorAll('#n3ware-styles').forEach(e => e.remove());
    clone.querySelectorAll('.n3-controls, .n3-format-bar, .n3-drop-line, .n3-toast').forEach(e => e.remove());
    // Remove editor attributes
    clone.querySelectorAll('[data-n3-editable]').forEach(e => {
      e.removeAttribute('data-n3-editable');
      e.removeAttribute('contenteditable');
      e.removeAttribute('spellcheck');
    });
    clone.querySelectorAll('[data-n3-block]').forEach(e => e.removeAttribute('data-n3-block'));
    clone.querySelectorAll('.n3-hovered, .n3-selected, .n3-dragging, .n3-editing').forEach(e => {
      e.classList.remove('n3-hovered', 'n3-selected', 'n3-dragging', 'n3-editing');
    });
    clone.querySelector('body').classList.remove('n3-editing');
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function exportHTML() {
    const html = getCleanHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (document.title || 'page') + '-edited.html';
    a.click();
    toast('Downloaded!', 'success');
  }

  function copyHTML() {
    const html = getCleanHTML();
    navigator.clipboard.writeText(html).then(() => {
      toast('HTML copied to clipboard', 'success');
    }).catch(() => {
      toast('Copy failed — try downloading instead', 'error');
    });
  }

  function showDiff() {
    if (historyStack.length < 2) { toast('No changes yet', 'info'); return; }
    const initial = historyStack[0];
    const current = getCleanHTML();
    const changes = computeDiff(initial, current);
    const json = JSON.stringify(changes, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'n3ware-diff.json';
    a.click();
    toast(`${changes.length} change(s) exported`, 'info');
  }

  function computeDiff(before, after) {
    const pBefore = new DOMParser().parseFromString(before, 'text/html');
    const pAfter = new DOMParser().parseFromString(after, 'text/html');
    const changes = [];
    const beforeEls = pBefore.querySelectorAll('*');
    const afterEls = pAfter.querySelectorAll('*');
    const len = Math.min(beforeEls.length, afterEls.length);
    for (let i = 0; i < len; i++) {
      const bEl = beforeEls[i], aEl = afterEls[i];
      if (bEl.outerHTML !== aEl.outerHTML) {
        changes.push({
          index: i,
          tag: aEl.tagName.toLowerCase(),
          before: bEl.textContent.trim().slice(0, 80),
          after: aEl.textContent.trim().slice(0, 80),
          styleChanged: bEl.getAttribute('style') !== aEl.getAttribute('style'),
        });
      }
    }
    return changes;
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); toggleEditMode(); return; }
    if (!editMode) return;
    if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); }
    if (e.key === 'Escape') { deactivateElement(); }
  }

  // ─── Re-build UI after history restore ────────────────────────────────────
  function rebuildEditorUI() {
    // Remove stale editor elements from restored HTML
    document.querySelectorAll('[data-n3-ui]').forEach(e => e.remove());
    // Re-create
    buildToolbar();
    buildEditButton();
    buildStylePanel();
    if (editMode) {
      toolbar.classList.add('n3-visible');
      document.body.classList.add('n3-editing');
      editBtn.classList.add('n3-active');
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg> Editing`;
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    buildToolbar();
    buildEditButton();
    buildStylePanel();
    document.addEventListener('keydown', onKeyDown);

    // Content change snapshots
    document.addEventListener('input', (e) => {
      if (!editMode) return;
      if (e.target.closest('[data-n3-editable]')) {
        clearTimeout(window._n3SnapTimer);
        window._n3SnapTimer = setTimeout(snapshot, 600);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose public API
  global.n3ware = {
    toggle: () => toggleEditMode(),
    enable: () => toggleEditMode(true),
    disable: () => toggleEditMode(false),
    export: exportHTML,
    copy: copyHTML,
    undo,
    redo,
  };
})(window);
