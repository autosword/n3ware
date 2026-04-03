(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────────
  let editMode = false;
  let selectedEl = null;
  let editingEl = null;
  let dragEl = null;
  let dragGhost = null;
  let dragIndicator = null;
  let history = [];
  let historyIndex = -1;
  let stylePanel = null;
  let toolbar = null;
  let floatBtn = null;
  let inlineToolbar = null;
  let elementOverlays = new Map();
  let resizeHandles = [];
  let currentImageEl = null;
  let rafId = null;

  const TEXT_TAGS = new Set(['P','H1','H2','H3','H4','H5','H6','SPAN','LI','A','BLOCKQUOTE','TD','LABEL','FIGCAPTION','BUTTON','DIV']);
  const BLOCK_TAGS = new Set(['DIV','SECTION','ARTICLE','HEADER','FOOTER','ASIDE','P','H1','H2','H3','H4','H5','H6','IMG','UL','OL','FIGURE','BLOCKQUOTE','MAIN','NAV','FORM']);
  const N3_ATTRS = ['data-n3-id','data-n3-drag','data-n3-editing','contenteditable'];

  // ─── Styles ───────────────────────────────────────────────────────────────────
  function injectStyles() {
    const id = 'n3ware-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .n3-float-btn {
        position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
        width: 52px; height: 52px; border-radius: 50%;
        background: #1e1e2e; border: 2px solid #3B82F6;
        color: #3B82F6; font-size: 11px; font-weight: 700;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 20px rgba(59,130,246,0.4);
        transition: all 0.2s ease; font-family: system-ui, sans-serif;
        letter-spacing: 0.5px; user-select: none;
      }
      .n3-float-btn:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(59,130,246,0.6); }
      .n3-float-btn.active { background: #3B82F6; color: #fff; }

      .n3-toolbar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
        height: 48px; background: #1e1e2e; border-bottom: 1px solid #2d2d3f;
        display: flex; align-items: center; padding: 0 16px; gap: 8px;
        font-family: system-ui, sans-serif; font-size: 13px; color: #e0e0e0;
        box-shadow: 0 2px 16px rgba(0,0,0,0.4);
        transform: translateY(-100%); transition: transform 0.25s ease;
      }
      .n3-toolbar.visible { transform: translateY(0); }
      .n3-toolbar-logo { color: #3B82F6; font-weight: 800; font-size: 15px; margin-right: 8px; letter-spacing: -0.5px; }
      .n3-toolbar-sep { width: 1px; height: 24px; background: #2d2d3f; margin: 0 4px; }
      .n3-toolbar-btn {
        background: transparent; border: 1px solid #2d2d3f; color: #e0e0e0;
        padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;
        font-family: system-ui, sans-serif; transition: all 0.15s ease; white-space: nowrap;
      }
      .n3-toolbar-btn:hover { background: #2d2d3f; border-color: #3B82F6; color: #fff; }
      .n3-toolbar-btn.primary { background: #3B82F6; border-color: #3B82F6; color: #fff; }
      .n3-toolbar-btn.primary:hover { background: #2563eb; }
      .n3-undo-redo { display: flex; gap: 4px; }
      .n3-undo-redo button {
        background: transparent; border: none; color: #888; font-size: 16px;
        cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: all 0.15s;
        font-family: system-ui, sans-serif;
      }
      .n3-undo-redo button:hover { color: #fff; background: #2d2d3f; }
      .n3-spacer { flex: 1; }

      /* Element overlay on hover */
      .n3-el-overlay {
        position: absolute; pointer-events: none;
        border: 1px dashed rgba(59,130,246,0.4); border-radius: 3px;
        z-index: 2147483640; box-sizing: border-box;
        transition: opacity 0.15s ease;
      }
      .n3-el-controls {
        position: absolute; display: flex; align-items: center; gap: 3px;
        pointer-events: all; z-index: 2147483641;
      }
      .n3-el-tag {
        font-family: monospace; font-size: 9px; color: #3B82F6;
        background: #1e1e2e; padding: 1px 4px; border-radius: 3px;
        border: 1px solid #3B82F6; line-height: 1.4;
        pointer-events: none;
      }
      .n3-el-btn {
        width: 18px; height: 18px; border-radius: 3px;
        background: #1e1e2e; border: 1px solid #3d3d5c;
        color: #ccc; font-size: 11px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s; font-family: system-ui, sans-serif;
      }
      .n3-el-btn:hover { background: #3B82F6; border-color: #3B82F6; color: #fff; }
      .n3-el-btn.del:hover { background: #ef4444; border-color: #ef4444; }
      .n3-drag-handle {
        cursor: grab; font-size: 13px; color: #3B82F6;
        width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
        background: #1e1e2e; border: 1px solid #3d3d5c; border-radius: 3px;
      }
      .n3-drag-handle:active { cursor: grabbing; }

      /* Inline toolbar */
      .n3-inline-toolbar {
        position: fixed; z-index: 2147483645;
        background: #1e1e2e; border: 1px solid #2d2d3f;
        border-radius: 8px; display: flex; align-items: center; gap: 2px;
        padding: 4px 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        font-family: system-ui, sans-serif;
        opacity: 0; pointer-events: none; transition: opacity 0.15s;
      }
      .n3-inline-toolbar.visible { opacity: 1; pointer-events: all; }
      .n3-inline-btn {
        background: transparent; border: none; color: #ccc;
        padding: 4px 6px; border-radius: 5px; cursor: pointer; font-size: 12px;
        font-weight: 600; transition: all 0.1s; min-width: 26px; height: 26px;
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, sans-serif;
      }
      .n3-inline-btn:hover { background: #2d2d3f; color: #fff; }
      .n3-inline-btn.active { background: #3B82F6; color: #fff; }
      .n3-inline-sep { width: 1px; height: 18px; background: #2d2d3f; margin: 0 2px; }
      .n3-color-input { width: 22px; height: 22px; border: none; border-radius: 4px; cursor: pointer; background: none; padding: 0; }
      .n3-font-select {
        background: #2d2d3f; border: none; color: #ccc;
        font-size: 11px; padding: 2px 4px; border-radius: 4px; cursor: pointer;
      }

      /* Style panel */
      .n3-style-panel {
        position: fixed; right: 0; top: 48px; bottom: 0; width: 260px;
        background: #1e1e2e; border-left: 1px solid #2d2d3f;
        z-index: 2147483644; overflow-y: auto; font-family: system-ui, sans-serif;
        transform: translateX(100%); transition: transform 0.25s ease;
        color: #e0e0e0; font-size: 12px;
      }
      .n3-style-panel.visible { transform: translateX(0); }
      .n3-panel-header {
        padding: 12px 16px; border-bottom: 1px solid #2d2d3f;
        font-weight: 700; font-size: 13px; color: #3B82F6;
        display: flex; align-items: center; justify-content: space-between;
      }
      .n3-panel-section { padding: 12px 16px; border-bottom: 1px solid #2d2d3f; }
      .n3-panel-label { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
      .n3-panel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .n3-panel-row label { flex: 1; font-size: 11px; color: #aaa; }
      .n3-slider { flex: 2; accent-color: #3B82F6; cursor: pointer; }
      .n3-num-input {
        width: 44px; background: #2d2d3f; border: 1px solid #3d3d5c;
        color: #e0e0e0; font-size: 11px; padding: 2px 4px; border-radius: 4px;
        text-align: center; font-family: system-ui, sans-serif;
      }
      .n3-color-swatch { width: 28px; height: 20px; border-radius: 4px; cursor: pointer; border: 1px solid #3d3d5c; }
      .n3-css-textarea {
        width: 100%; box-sizing: border-box; background: #0d0d1a;
        border: 1px solid #2d2d3f; color: #a5f3fc; font-family: monospace;
        font-size: 11px; padding: 8px; border-radius: 6px; resize: vertical;
        min-height: 80px; outline: none;
      }
      .n3-class-list { display: flex; flex-wrap: wrap; gap: 4px; }
      .n3-class-tag {
        background: #2d2d3f; color: #93c5fd; font-size: 10px; padding: 2px 6px;
        border-radius: 999px; display: flex; align-items: center; gap: 4px; cursor: default;
      }
      .n3-class-tag span { cursor: pointer; color: #ef4444; font-size: 12px; }
      .n3-add-class {
        background: transparent; border: 1px dashed #3d3d5c; color: #888;
        font-size: 10px; padding: 2px 6px; border-radius: 999px; cursor: pointer;
      }
      .n3-add-class:hover { border-color: #3B82F6; color: #3B82F6; }

      /* Drag indicator */
      .n3-drop-line {
        position: fixed; height: 3px; background: #3B82F6; border-radius: 2px;
        z-index: 2147483647; pointer-events: none;
        box-shadow: 0 0 8px rgba(59,130,246,0.8);
        transition: none;
      }

      /* Image controls */
      .n3-img-controls {
        position: absolute; background: #1e1e2e; border: 1px solid #2d2d3f;
        border-radius: 8px; padding: 6px; display: flex; gap: 4px;
        z-index: 2147483645; flex-wrap: wrap; max-width: 200px;
      }
      .n3-resize-handle {
        position: fixed; width: 10px; height: 10px; background: #3B82F6;
        border-radius: 50%; z-index: 2147483647; cursor: se-resize;
        border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      }

      /* Selection highlight */
      .n3-selected {
        outline: 2px solid #3B82F6 !important;
        outline-offset: 2px;
      }
      .n3-editing {
        outline: 2px solid #60a5fa !important;
        outline-offset: 2px;
      }

      /* Drag ghost */
      .n3-drag-ghost {
        position: fixed; opacity: 0.6; pointer-events: none;
        z-index: 2147483647; background: #1e1e2e; border: 2px solid #3B82F6;
        border-radius: 6px; padding: 6px 10px; font-size: 12px; color: #fff;
        font-family: system-ui, sans-serif; max-width: 200px; overflow: hidden;
        white-space: nowrap; text-overflow: ellipsis;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }

      /* Toast */
      .n3-toast {
        position: fixed; bottom: 88px; right: 24px; z-index: 2147483647;
        background: #1e1e2e; border: 1px solid #3B82F6; color: #e0e0e0;
        padding: 10px 16px; border-radius: 8px; font-size: 13px;
        font-family: system-ui, sans-serif;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        animation: n3-slide-in 0.25s ease;
      }
      @keyframes n3-slide-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Utils ───────────────────────────────────────────────────────────────────
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'n3-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function isN3Element(el) {
    if (!el) return false;
    return el.classList && (
      el.classList.contains('n3-toolbar') ||
      el.classList.contains('n3-float-btn') ||
      el.classList.contains('n3-inline-toolbar') ||
      el.classList.contains('n3-style-panel') ||
      el.classList.contains('n3-el-overlay') ||
      el.classList.contains('n3-el-controls') ||
      el.classList.contains('n3-drop-line') ||
      el.classList.contains('n3-drag-ghost') ||
      el.classList.contains('n3-toast') ||
      el.classList.contains('n3-img-controls') ||
      el.classList.contains('n3-resize-handle') ||
      el.id === 'n3ware-styles'
    ) || (el.closest && (
      el.closest('.n3-toolbar') ||
      el.closest('.n3-float-btn') ||
      el.closest('.n3-inline-toolbar') ||
      el.closest('.n3-style-panel') ||
      el.closest('.n3-el-controls') ||
      el.closest('.n3-img-controls')
    ));
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function getSelector(el) {
    if (!el || el === document.body) return 'body';
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { part += '#' + cur.id; parts.unshift(part); break; }
      const siblings = Array.from(cur.parentElement?.children || []).filter(c => c.tagName === cur.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ─── History ─────────────────────────────────────────────────────────────────
  function recordChange(type, el, before, after) {
    history = history.slice(0, historyIndex + 1);
    history.push({ type, selector: getSelector(el), before, after, el });
    historyIndex++;
  }

  function undo() {
    if (historyIndex < 0) return;
    const entry = history[historyIndex--];
    applyHistoryEntry(entry, true);
    toast('Undone');
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    const entry = history[++historyIndex];
    applyHistoryEntry(entry, false);
    toast('Redone');
  }

  function applyHistoryEntry(entry, isUndo) {
    const val = isUndo ? entry.before : entry.after;
    if (entry.type === 'text' && entry.el) entry.el.innerHTML = val;
    if (entry.type === 'style' && entry.el) entry.el.style.cssText = val;
    if (entry.type === 'move' && entry.el) {
      const { parentBefore, nextSibBefore, parentAfter, nextSibAfter } = val;
      const parent = isUndo ? parentBefore : parentAfter;
      const nextSib = isUndo ? nextSibBefore : nextSibAfter;
      if (parent) parent.insertBefore(entry.el, nextSib || null);
    }
  }

  // ─── Float Button ─────────────────────────────────────────────────────────────
  function createFloatButton() {
    floatBtn = document.createElement('button');
    floatBtn.className = 'n3-float-btn';
    floatBtn.title = 'Toggle n3ware editor (Ctrl+Shift+E)';
    floatBtn.innerHTML = 'n3';
    floatBtn.addEventListener('click', toggleEditMode);
    document.body.appendChild(floatBtn);
  }

  // ─── Toolbar ─────────────────────────────────────────────────────────────────
  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'n3-toolbar';
    toolbar.innerHTML = `
      <span class="n3-toolbar-logo">n3ware</span>
      <div class="n3-undo-redo">
        <button id="n3-undo" title="Undo (Ctrl+Z)">↩</button>
        <button id="n3-redo" title="Redo (Ctrl+Shift+Z)">↪</button>
      </div>
      <div class="n3-toolbar-sep"></div>
      <button class="n3-toolbar-btn" id="n3-save-btn">⬇ Save HTML</button>
      <button class="n3-toolbar-btn" id="n3-copy-btn">⎘ Copy HTML</button>
      <button class="n3-toolbar-btn" id="n3-diff-btn">⟨⟩ Get Changes</button>
      <div class="n3-spacer"></div>
      <button class="n3-toolbar-btn primary" id="n3-close-btn">✕ Exit Editor</button>
    `;
    document.body.appendChild(toolbar);

    toolbar.querySelector('#n3-undo').addEventListener('click', undo);
    toolbar.querySelector('#n3-redo').addEventListener('click', redo);
    toolbar.querySelector('#n3-save-btn').addEventListener('click', saveHTML);
    toolbar.querySelector('#n3-copy-btn').addEventListener('click', copyHTML);
    toolbar.querySelector('#n3-diff-btn').addEventListener('click', getChanges);
    toolbar.querySelector('#n3-close-btn').addEventListener('click', toggleEditMode);
  }

  // ─── Inline Toolbar ───────────────────────────────────────────────────────────
  function createInlineToolbar() {
    inlineToolbar = document.createElement('div');
    inlineToolbar.className = 'n3-inline-toolbar';
    inlineToolbar.innerHTML = `
      <button class="n3-inline-btn" data-cmd="bold" title="Bold"><b>B</b></button>
      <button class="n3-inline-btn" data-cmd="italic" title="Italic"><i>I</i></button>
      <button class="n3-inline-btn" data-cmd="underline" title="Underline"><u>U</u></button>
      <div class="n3-inline-sep"></div>
      <button class="n3-inline-btn" data-cmd="link" title="Insert Link">🔗</button>
      <div class="n3-inline-sep"></div>
      <input type="color" class="n3-color-input" id="n3-text-color" title="Text color" value="#000000">
      <div class="n3-inline-sep"></div>
      <select class="n3-font-select" id="n3-font-size" title="Font size">
        <option value="12px">S</option>
        <option value="16px">M</option>
        <option value="20px">L</option>
        <option value="28px">XL</option>
      </select>
      <div class="n3-inline-sep"></div>
      <button class="n3-inline-btn" data-heading="P" title="Paragraph">P</button>
      <button class="n3-inline-btn" data-heading="H1" title="Heading 1">H1</button>
      <button class="n3-inline-btn" data-heading="H2" title="Heading 2">H2</button>
      <button class="n3-inline-btn" data-heading="H3" title="Heading 3">H3</button>
      <div class="n3-inline-sep"></div>
      <button class="n3-inline-btn" data-align="left" title="Align left">⬅</button>
      <button class="n3-inline-btn" data-align="center" title="Center">↔</button>
      <button class="n3-inline-btn" data-align="right" title="Align right">➡</button>
    `;
    document.body.appendChild(inlineToolbar);

    inlineToolbar.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.cmd === 'link') {
          const url = prompt('Enter URL:', 'https://');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(btn.dataset.cmd, false, null);
        }
        updateInlineToolbarState();
      });
    });

    inlineToolbar.querySelector('#n3-text-color').addEventListener('input', (e) => {
      document.execCommand('foreColor', false, e.target.value);
    });

    inlineToolbar.querySelector('#n3-font-size').addEventListener('change', (e) => {
      if (editingEl) editingEl.style.fontSize = e.target.value;
    });

    inlineToolbar.querySelectorAll('[data-heading]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!editingEl) return;
        const newTag = btn.dataset.heading;
        if (newTag === 'P' || newTag.startsWith('H')) {
          const newEl = document.createElement(newTag);
          newEl.innerHTML = editingEl.innerHTML;
          newEl.className = editingEl.className;
          newEl.style.cssText = editingEl.style.cssText;
          editingEl.parentNode.replaceChild(newEl, editingEl);
          editingEl = newEl;
          editingEl.contentEditable = 'true';
          editingEl.focus();
        }
      });
    });

    inlineToolbar.querySelectorAll('[data-align]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (editingEl) editingEl.style.textAlign = btn.dataset.align;
      });
    });
  }

  function positionInlineToolbar(el) {
    const rect = el.getBoundingClientRect();
    const tbHeight = 40;
    let top = rect.top - tbHeight - 8;
    if (top < 52) top = rect.bottom + 8;
    inlineToolbar.style.top = top + 'px';
    inlineToolbar.style.left = Math.max(8, rect.left) + 'px';
    inlineToolbar.classList.add('visible');
  }

  function hideInlineToolbar() {
    if (inlineToolbar) inlineToolbar.classList.remove('visible');
  }

  function updateInlineToolbarState() {
    if (!inlineToolbar) return;
    ['bold','italic','underline'].forEach(cmd => {
      const btn = inlineToolbar.querySelector(`[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  // ─── Style Panel ─────────────────────────────────────────────────────────────
  function createStylePanel() {
    stylePanel = document.createElement('div');
    stylePanel.className = 'n3-style-panel';
    document.body.appendChild(stylePanel);
  }

  function updateStylePanel(el) {
    if (!stylePanel || !el) return;
    const cs = window.getComputedStyle(el);
    const classes = Array.from(el.classList).filter(c => !c.startsWith('n3-'));

    stylePanel.innerHTML = `
      <div class="n3-panel-header">
        <span>Style: <code style="font-size:11px;color:#93c5fd">${el.tagName.toLowerCase()}</code></span>
        <button class="n3-inline-btn" id="n3-panel-close" style="color:#888">✕</button>
      </div>
      <div class="n3-panel-section">
        <div class="n3-panel-label">Colors</div>
        <div class="n3-panel-row">
          <label>Background</label>
          <input type="color" class="n3-color-swatch" id="n3-bg-color" value="${rgbToHex(cs.backgroundColor)}">
        </div>
        <div class="n3-panel-row">
          <label>Text Color</label>
          <input type="color" class="n3-color-swatch" id="n3-fg-color" value="${rgbToHex(cs.color)}">
        </div>
      </div>
      <div class="n3-panel-section">
        <div class="n3-panel-label">Spacing</div>
        ${['paddingTop','paddingRight','paddingBottom','paddingLeft'].map(p =>
          `<div class="n3-panel-row">
            <label>${p.replace('padding','Pad ').replace(/([A-Z])/g,' $1').trim()}</label>
            <input type="range" class="n3-slider" data-style="${p}" min="0" max="80" value="${parseInt(cs[p])||0}">
            <input type="number" class="n3-num-input" data-style="${p}" value="${parseInt(cs[p])||0}">
          </div>`).join('')}
        ${['marginTop','marginRight','marginBottom','marginLeft'].map(p =>
          `<div class="n3-panel-row">
            <label>${p.replace('margin','Marg ').replace(/([A-Z])/g,' $1').trim()}</label>
            <input type="range" class="n3-slider" data-style="${p}" min="0" max="80" value="${parseInt(cs[p])||0}">
            <input type="number" class="n3-num-input" data-style="${p}" value="${parseInt(cs[p])||0}">
          </div>`).join('')}
      </div>
      <div class="n3-panel-section">
        <div class="n3-panel-label">Border & Opacity</div>
        <div class="n3-panel-row">
          <label>Border Radius</label>
          <input type="range" class="n3-slider" data-style="borderRadius" min="0" max="50" value="${parseInt(cs.borderRadius)||0}">
          <input type="number" class="n3-num-input" data-style="borderRadius" value="${parseInt(cs.borderRadius)||0}">
        </div>
        <div class="n3-panel-row">
          <label>Opacity</label>
          <input type="range" class="n3-slider" data-style="opacity" min="0" max="100" value="${Math.round((parseFloat(cs.opacity)||1)*100)}">
          <input type="number" class="n3-num-input" data-style="opacity" value="${Math.round((parseFloat(cs.opacity)||1)*100)}">
        </div>
      </div>
      <div class="n3-panel-section">
        <div class="n3-panel-label">CSS Classes</div>
        <div class="n3-class-list" id="n3-class-list">
          ${classes.map(c => `<span class="n3-class-tag">${c} <span data-remove-class="${c}">×</span></span>`).join('')}
          <button class="n3-add-class" id="n3-add-class-btn">+ Add Class</button>
        </div>
      </div>
      <div class="n3-panel-section">
        <div class="n3-panel-label">Custom CSS</div>
        <textarea class="n3-css-textarea" id="n3-custom-css" placeholder="e.g. font-weight: bold;">${el.style.cssText}</textarea>
      </div>
    `;

    stylePanel.querySelector('#n3-panel-close').addEventListener('click', () => {
      stylePanel.classList.remove('visible');
    });

    stylePanel.querySelector('#n3-bg-color').addEventListener('input', (e) => {
      const before = el.style.cssText;
      el.style.backgroundColor = e.target.value;
      recordChange('style', el, before, el.style.cssText);
    });

    stylePanel.querySelector('#n3-fg-color').addEventListener('input', (e) => {
      const before = el.style.cssText;
      el.style.color = e.target.value;
      recordChange('style', el, before, el.style.cssText);
    });

    stylePanel.querySelectorAll('.n3-slider[data-style]').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const prop = e.target.dataset.style;
        const val = e.target.value;
        const numInput = stylePanel.querySelector(`.n3-num-input[data-style="${prop}"]`);
        if (numInput) numInput.value = val;
        const before = el.style.cssText;
        if (prop === 'opacity') {
          el.style[prop] = val / 100;
        } else {
          el.style[prop] = val + 'px';
        }
        recordChange('style', el, before, el.style.cssText);
      });
    });

    stylePanel.querySelectorAll('.n3-num-input[data-style]').forEach(input => {
      input.addEventListener('change', (e) => {
        const prop = e.target.dataset.style;
        const val = e.target.value;
        const slider = stylePanel.querySelector(`.n3-slider[data-style="${prop}"]`);
        if (slider) slider.value = val;
        const before = el.style.cssText;
        if (prop === 'opacity') {
          el.style[prop] = val / 100;
        } else {
          el.style[prop] = val + 'px';
        }
        recordChange('style', el, before, el.style.cssText);
      });
    });

    stylePanel.querySelector('#n3-add-class-btn').addEventListener('click', () => {
      const cls = prompt('Enter class name:');
      if (cls && cls.trim()) {
        el.classList.add(cls.trim());
        updateStylePanel(el);
      }
    });

    stylePanel.querySelectorAll('[data-remove-class]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        el.classList.remove(e.target.dataset.removeClass);
        updateStylePanel(el);
      });
    });

    stylePanel.querySelector('#n3-custom-css').addEventListener('change', (e) => {
      const before = el.style.cssText;
      el.style.cssText = e.target.value;
      recordChange('style', el, before, el.style.cssText);
    });

    stylePanel.classList.add('visible');
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return '#ffffff';
    const m = rgb.match(/\d+/g);
    if (!m) return '#ffffff';
    return '#' + [m[0], m[1], m[2]].map(x => (+x).toString(16).padStart(2, '0')).join('');
  }

  // ─── Element Overlays ─────────────────────────────────────────────────────────
  function showElementOverlay(el) {
    if (isN3Element(el) || !el.getBoundingClientRect) return;
    removeElementOverlay(el);

    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const overlay = document.createElement('div');
    overlay.className = 'n3-el-overlay';
    overlay.style.cssText = `
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
    `;

    const controls = document.createElement('div');
    controls.className = 'n3-el-controls';
    controls.style.cssText = `
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY - 22}px;
      position: absolute;
    `;

    const handle = document.createElement('span');
    handle.className = 'n3-drag-handle';
    handle.innerHTML = '⠿';
    handle.title = 'Drag to reorder';
    handle.draggable = true;

    handle.addEventListener('dragstart', (e) => startDrag(e, el));
    handle.addEventListener('touchstart', (e) => touchDragStart(e, el), { passive: false });

    const tag = document.createElement('span');
    tag.className = 'n3-el-tag';
    tag.textContent = el.tagName;

    const dupBtn = document.createElement('button');
    dupBtn.className = 'n3-el-btn';
    dupBtn.innerHTML = '⧉';
    dupBtn.title = 'Duplicate';
    dupBtn.addEventListener('click', (e) => { e.stopPropagation(); duplicateElement(el); });

    const delBtn = document.createElement('button');
    delBtn.className = 'n3-el-btn del';
    delBtn.innerHTML = '×';
    delBtn.title = 'Delete element';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete this ${el.tagName} element?`)) {
        el.remove();
        removeElementOverlay(el);
        toast('Element deleted');
      }
    });

    controls.appendChild(handle);
    controls.appendChild(tag);
    controls.appendChild(dupBtn);
    controls.appendChild(delBtn);

    document.body.appendChild(overlay);
    document.body.appendChild(controls);
    elementOverlays.set(el, { overlay, controls });
  }

  function removeElementOverlay(el) {
    const data = elementOverlays.get(el);
    if (data) {
      data.overlay.remove();
      data.controls.remove();
      elementOverlays.delete(el);
    }
  }

  function clearAllOverlays() {
    elementOverlays.forEach(({ overlay, controls }) => {
      overlay.remove();
      controls.remove();
    });
    elementOverlays.clear();
  }

  function duplicateElement(el) {
    const clone = el.cloneNode(true);
    el.parentNode.insertBefore(clone, el.nextSibling);
    toast('Element duplicated');
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────────────
  let dropTarget = null;
  let dropPosition = null;

  function startDrag(e, el) {
    dragEl = el;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');

    dragGhost = document.createElement('div');
    dragGhost.className = 'n3-drag-ghost';
    dragGhost.textContent = el.tagName + ': ' + (el.textContent || '').slice(0, 30);
    document.body.appendChild(dragGhost);
    e.dataTransfer.setDragImage(dragGhost, 0, 0);

    dragIndicator = document.createElement('div');
    dragIndicator.className = 'n3-drop-line';
    document.body.appendChild(dragIndicator);

    el.style.opacity = '0.4';
  }

  function onDragOver(e) {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target;
    if (isN3Element(target) || target === dragEl || target.contains(dragEl)) return;

    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dropPosition = e.clientY < midY ? 'before' : 'after';
    dropTarget = target;

    if (dragIndicator) {
      const lineY = dropPosition === 'before' ? rect.top + window.scrollY : rect.bottom + window.scrollY;
      dragIndicator.style.cssText = `
        left: ${rect.left}px; top: ${lineY - 1}px; width: ${rect.width}px;
      `;
    }
  }

  function onDrop(e) {
    if (!dragEl || !dropTarget) return;
    e.preventDefault();

    const before = {
      parentBefore: dragEl.parentElement,
      nextSibBefore: dragEl.nextElementSibling,
      parentAfter: null, nextSibAfter: null
    };

    if (dropPosition === 'before') {
      dropTarget.parentNode.insertBefore(dragEl, dropTarget);
    } else {
      dropTarget.parentNode.insertBefore(dragEl, dropTarget.nextSibling);
    }

    before.parentAfter = dragEl.parentElement;
    before.nextSibAfter = dragEl.nextElementSibling;
    recordChange('move', dragEl, before, before);

    endDrag();
    toast('Element moved');
  }

  function endDrag() {
    if (dragEl) dragEl.style.opacity = '';
    dragEl = null;
    dropTarget = null;
    dropPosition = null;
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (dragIndicator) { dragIndicator.remove(); dragIndicator = null; }
  }

  // Touch drag
  let touchDragEl = null, touchOffsetX = 0, touchOffsetY = 0;
  function touchDragStart(e, el) {
    e.preventDefault();
    touchDragEl = el;
    const touch = e.touches[0];
    const rect = el.getBoundingClientRect();
    touchOffsetX = touch.clientX - rect.left;
    touchOffsetY = touch.clientY - rect.top;
    el.style.opacity = '0.4';

    dragIndicator = document.createElement('div');
    dragIndicator.className = 'n3-drop-line';
    document.body.appendChild(dragIndicator);
  }

  document.addEventListener('touchmove', (e) => {
    if (!touchDragEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target || isN3Element(target) || target === touchDragEl) return;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dropPosition = touch.clientY < midY ? 'before' : 'after';
    dropTarget = target;
    if (dragIndicator) {
      const lineY = dropPosition === 'before' ? rect.top + window.scrollY : rect.bottom + window.scrollY;
      dragIndicator.style.cssText = `left: ${rect.left}px; top: ${lineY}px; width: ${rect.width}px;`;
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!touchDragEl) return;
    if (dropTarget && dropPosition) {
      if (dropPosition === 'before') {
        dropTarget.parentNode.insertBefore(touchDragEl, dropTarget);
      } else {
        dropTarget.parentNode.insertBefore(touchDragEl, dropTarget.nextSibling);
      }
      toast('Element moved');
    }
    touchDragEl.style.opacity = '';
    touchDragEl = null;
    dropTarget = null;
    dropPosition = null;
    if (dragIndicator) { dragIndicator.remove(); dragIndicator = null; }
  });

  // ─── Text Editing ─────────────────────────────────────────────────────────────
  function enableTextEditing(el) {
    if (editingEl && editingEl !== el) {
      disableTextEditing();
    }
    if (!TEXT_TAGS.has(el.tagName)) return;
    const before = el.innerHTML;
    editingEl = el;
    el.contentEditable = 'true';
    el.classList.add('n3-editing');
    el.focus();
    positionInlineToolbar(el);
    updateInlineToolbarState();

    el.addEventListener('input', debounce(() => {
      recordChange('text', el, before, el.innerHTML);
    }, 500));
  }

  function disableTextEditing() {
    if (!editingEl) return;
    editingEl.contentEditable = 'false';
    editingEl.classList.remove('n3-editing');
    editingEl = null;
    hideInlineToolbar();
  }

  // ─── Image Controls ───────────────────────────────────────────────────────────
  function showImageControls(img) {
    clearImageControls();
    currentImageEl = img;
    img.classList.add('n3-selected');

    const controls = document.createElement('div');
    controls.className = 'n3-img-controls';
    controls.innerHTML = `
      <button class="n3-inline-btn" id="n3-img-replace" title="Replace image">🔄 Replace</button>
      <button class="n3-inline-btn" id="n3-img-alt" title="Edit alt text">Alt</button>
      <button class="n3-inline-btn" data-img-align="left" title="Float left">◧</button>
      <button class="n3-inline-btn" data-img-align="center" title="Center">⊟</button>
      <button class="n3-inline-btn" data-img-align="right" title="Float right">◨</button>
      <button class="n3-inline-btn" data-img-align="full" title="Full width">⬛</button>
    `;

    const rect = img.getBoundingClientRect();
    controls.style.cssText = `
      position: fixed;
      top: ${rect.bottom + 8}px;
      left: ${rect.left}px;
    `;

    document.body.appendChild(controls);

    controls.querySelector('#n3-img-replace').addEventListener('click', () => {
      const url = prompt('Enter image URL:', img.src);
      if (url) img.src = url;
    });

    controls.querySelector('#n3-img-alt').addEventListener('click', () => {
      const alt = prompt('Enter alt text:', img.alt);
      if (alt !== null) img.alt = alt;
    });

    controls.querySelectorAll('[data-img-align]').forEach(btn => {
      btn.addEventListener('click', () => {
        const align = btn.dataset.imgAlign;
        if (align === 'left') { img.style.float = 'left'; img.style.width = ''; }
        else if (align === 'right') { img.style.float = 'right'; img.style.width = ''; }
        else if (align === 'center') { img.style.float = ''; img.style.display = 'block'; img.style.margin = '0 auto'; }
        else if (align === 'full') { img.style.width = '100%'; img.style.float = ''; img.style.display = 'block'; }
      });
    });

    // Resize handles
    ['nw','ne','sw','se'].forEach(corner => {
      const handle = document.createElement('div');
      handle.className = 'n3-resize-handle';
      const cr = img.getBoundingClientRect();
      const x = corner.includes('e') ? cr.right : cr.left;
      const y = corner.includes('s') ? cr.bottom : cr.top;
      handle.style.cssText = `left: ${x - 5}px; top: ${y - 5}px;`;
      handle.dataset.corner = corner;
      document.body.appendChild(handle);
      resizeHandles.push(handle);

      let startX, startY, startW, startH;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX; startY = e.clientY;
        const br = img.getBoundingClientRect();
        startW = br.width; startH = br.height;

        const onMove = (e) => {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          img.style.width = Math.max(40, startW + (corner.includes('e') ? dx : -dx)) + 'px';
          img.style.height = 'auto';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    currentImgControls = controls;
  }

  let currentImgControls = null;
  function clearImageControls() {
    if (currentImgControls) { currentImgControls.remove(); currentImgControls = null; }
    if (currentImageEl) { currentImageEl.classList.remove('n3-selected'); currentImageEl = null; }
    resizeHandles.forEach(h => h.remove());
    resizeHandles = [];
  }

  // ─── Click Handling ───────────────────────────────────────────────────────────
  function handleClick(e) {
    if (!editMode) return;
    if (isN3Element(e.target)) return;

    const el = e.target;

    if (el.tagName === 'IMG') {
      e.preventDefault();
      clearImageControls();
      showImageControls(el);
      if (selectedEl) selectedEl.classList.remove('n3-selected');
      selectedEl = el;
      updateStylePanel(el);
      return;
    }

    clearImageControls();

    if (TEXT_TAGS.has(el.tagName)) {
      e.preventDefault();
      if (selectedEl) selectedEl.classList.remove('n3-selected');
      selectedEl = el;
      el.classList.add('n3-selected');
      enableTextEditing(el);
      updateStylePanel(el);
    }
  }

  function handleMouseOver(e) {
    if (!editMode) return;
    const el = e.target;
    if (isN3Element(el) || el === document.body || el === document.documentElement) return;
    if (BLOCK_TAGS.has(el.tagName) || TEXT_TAGS.has(el.tagName)) {
      showElementOverlay(el);
    }
  }

  function handleMouseOut(e) {
    if (!editMode) return;
    const el = e.target;
    if (!e.relatedTarget || !el.contains(e.relatedTarget)) {
      removeElementOverlay(el);
    }
  }

  // ─── Edit Mode Toggle ─────────────────────────────────────────────────────────
  function toggleEditMode() {
    editMode = !editMode;

    if (editMode) {
      floatBtn.classList.add('active');
      floatBtn.innerHTML = '✕';
      toolbar.classList.add('visible');
      document.body.style.marginTop = '48px';
      document.body.setAttribute('data-n3-edit', 'true');

      document.addEventListener('click', handleClick, true);
      document.addEventListener('mouseover', handleMouseOver);
      document.addEventListener('mouseout', handleMouseOut);
      document.addEventListener('dragover', onDragOver);
      document.addEventListener('drop', onDrop);
      document.addEventListener('dragend', endDrag);

      toast('Edit mode ON — click any element to edit');
    } else {
      floatBtn.classList.remove('active');
      floatBtn.innerHTML = 'n3';
      toolbar.classList.remove('visible');
      document.body.style.marginTop = '';
      document.body.removeAttribute('data-n3-edit');

      disableTextEditing();
      clearAllOverlays();
      clearImageControls();
      if (selectedEl) { selectedEl.classList.remove('n3-selected'); selectedEl = null; }
      if (stylePanel) stylePanel.classList.remove('visible');
      hideInlineToolbar();

      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', endDrag);
    }
  }

  // ─── Save / Export ────────────────────────────────────────────────────────────
  function getCleanHTML() {
    const clone = document.documentElement.cloneNode(true);
    // Remove all n3ware elements
    clone.querySelectorAll(
      '.n3-toolbar, .n3-float-btn, .n3-inline-toolbar, .n3-style-panel, ' +
      '.n3-el-overlay, .n3-el-controls, .n3-drop-line, .n3-drag-ghost, ' +
      '.n3-toast, .n3-img-controls, .n3-resize-handle, #n3ware-styles'
    ).forEach(el => el.remove());
    // Remove n3 attributes
    clone.querySelectorAll('[data-n3-id],[data-n3-drag],[data-n3-editing],[data-n3-edit]').forEach(el => {
      N3_ATTRS.forEach(attr => el.removeAttribute(attr));
    });
    // Remove n3 classes
    clone.querySelectorAll('[class]').forEach(el => {
      ['n3-selected','n3-editing','n3-drag-handle'].forEach(c => el.classList.remove(c));
      if (!el.getAttribute('class').trim()) el.removeAttribute('class');
    });
    clone.body.style.marginTop = '';
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function saveHTML() {
    const html = getCleanHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'edited-page.html';
    a.click();
    toast('HTML saved!');
  }

  function copyHTML() {
    const html = getCleanHTML();
    navigator.clipboard.writeText(html).then(() => toast('HTML copied to clipboard!'));
  }

  function getChanges() {
    const changes = history.slice(0, historyIndex + 1).map(entry => ({
      type: entry.type,
      selector: entry.selector,
      before: entry.before,
      after: entry.after
    }));
    const json = JSON.stringify(changes, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      console.log('[n3ware] Changes:', changes);
      toast(`${changes.length} change(s) copied as JSON`);
    });
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key === 'E') { e.preventDefault(); toggleEditMode(); return; }
    if (!editMode) return;
    if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (mod && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); return; }
    if (mod && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape') { disableTextEditing(); clearAllOverlays(); clearImageControls(); }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    createFloatButton();
    createToolbar();
    createInlineToolbar();
    createStylePanel();
    console.log('%c n3ware %c loaded — Press Ctrl+Shift+E or click the button to edit',
      'background:#3B82F6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold',
      'color:#888');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
