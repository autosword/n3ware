/**
 * n3ware — Visual Website Editor
 * https://n3ware.com
 *
 * Core module: event bus, shared UI, history, and the main editor orchestrator.
 * Companion modules are loaded automatically from the same directory.
 *
 * Usage:
 *   <script src="https://n3ware.com/n3ware.js"></script>
 *
 * Cloud usage (site-specific):
 *   <script src="https://n3ware.com/n3ware.js"
 *           data-n3-site="SITE_ID"
 *           data-n3-api="https://api.n3ware.com"
 *           data-n3-key="API_KEY"></script>
 *
 * Public API (window.n3ware):
 *   n3ware.toggle()   — toggle edit mode on/off
 *   n3ware.enable()   — force edit mode on
 *   n3ware.disable()  — force edit mode off
 *   n3ware.export()   — download clean HTML
 *   n3ware.copy()     — copy clean HTML to clipboard
 *   n3ware.undo()     — undo last change
 *   n3ware.redo()     — redo last undone change
 *   n3ware.on(event, callback)  — subscribe to editor events
 *   n3ware.off(event, callback) — unsubscribe from editor events
 *
 * @version 1.0.0
 * @license MIT
 */
(function (global) {
  'use strict';

  // ─── JWT from URL hash (#auth=TOKEN) ─────────────────────────────────────
  // The dashboard appends #auth=JWT when opening a live site for editing so
  // the authenticated user's token is available without touching the server.
  (function () {
    try {
      const m = window.location.hash.match(/[#&]auth=([^&]+)/);
      if (m) {
        sessionStorage.setItem('n3_auth', decodeURIComponent(m[1]));
        // Remove the hash so the token isn't in browser history after navigation
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (_) {}
  })();

  // ─── Base URL detection ───────────────────────────────────────────────────
  // Captured synchronously so it's available in async callbacks.
  /** @type {string} Base URL of the directory containing n3ware.js */
  const _baseUrl = (function () {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.includes('n3ware.js')) {
        return scripts[i].src.replace(/n3ware\.js.*$/, '');
      }
    }
    return (document.currentScript && document.currentScript.src)
      ? document.currentScript.src.replace(/[^/]+$/, '') : '';
  })();

  // ─── Module loader ────────────────────────────────────────────────────────
  /** Names of companion script files to load in parallel */
  const _MODULES = [
    'n3ware-icons.js',
    'n3ware-text.js',
    'n3ware-style.js',
    'n3ware-charts.js',
    'n3ware-analytics.js',
    'n3ware-components.js',
  ];

  /**
   * Dynamically load a companion module script.
   * Resolves even on error (modules are optional).
   * @param {string} name  Filename relative to n3ware.js
   * @returns {Promise<void>}
   */
  function _loadModule(name) {
    return new Promise(function (resolve) {
      const s = document.createElement('script');
      s.src = _baseUrl + name;
      s.onload  = resolve;
      s.onerror = function () {
        console.warn('n3ware: optional module not found — ' + _baseUrl + name);
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  // ─── Design tokens ────────────────────────────────────────────────────────
  /**
   * Shared colour palette used across all UI components.
   * @type {{ accent:string, accentDark:string, bgPanel:string, border:string, text:string, muted:string }}
   */
  const T = {
    accent:     '#E31337',
    accentDark: '#B91C2C',
    bgPanel:    '#111111',
    border:     '#2A2A2A',
    text:       '#E5E5E5',
    muted:      '#888888',
  };

  /** CSS selector groups shared across modules. */
  const SEL = {
    /** Inline text elements that become contentEditable in edit mode */
    text:  'p,h1,h2,h3,h4,h5,h6,span,li,a,blockquote,td,th,label,dt,dd',
    /** Block-level elements that receive hover/selection overlays */
    block: 'div,section,article,header,footer,main,aside,nav,figure,p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,table,form,img',
  };

  // ─── Utility functions ────────────────────────────────────────────────────

  /**
   * Escape HTML special characters to prevent injection.
   * @param {*} s  Value to escape (coerced to string)
   * @returns {string}
   */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Format an ISO date string for display.
   * @param {string} iso
   * @returns {string}
   */
  function _fmtDate(iso) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); }
    catch (_) { return iso || ''; }
  }

  /**
   * Format a number, abbreviating thousands with "k".
   * @param {number} n
   * @returns {string}
   */
  function _fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }

  /**
   * Format a duration in seconds as "Xm Ys" or "Xs".
   * @param {number|null} s  Seconds
   * @returns {string}
   */
  function _fmtDur(s) {
    if (!s) return '—';
    if (s < 60) return Math.round(s) + 's';
    return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
  }

  /**
   * Build an SVG donut arc path string.
   * @param {number} cx      Centre X
   * @param {number} cy      Centre Y
   * @param {number} r       Outer radius
   * @param {number} startDeg
   * @param {number} endDeg
   * @param {string} color   Fill colour
   * @returns {string} SVG `<path>` element markup
   */
  function _svgArc(cx, cy, r, startDeg, endDeg, color) {
    const toRad = d => (d - 90) * Math.PI / 180;
    const inner = r * 0.56;
    const x1  = cx + r     * Math.cos(toRad(startDeg));
    const y1  = cy + r     * Math.sin(toRad(startDeg));
    const x2  = cx + r     * Math.cos(toRad(endDeg));
    const y2  = cy + r     * Math.sin(toRad(endDeg));
    const ix1 = cx + inner * Math.cos(toRad(endDeg));
    const iy1 = cy + inner * Math.sin(toRad(endDeg));
    const ix2 = cx + inner * Math.cos(toRad(startDeg));
    const iy2 = cy + inner * Math.sin(toRad(startDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `<path d="M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${ix1} ${iy1} A${inner} ${inner} 0 ${large} 0 ${ix2} ${iy2} Z" fill="${color}" opacity="0.9"/>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Events — lightweight publish/subscribe event bus
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Lightweight publish/subscribe event bus used for inter-module communication.
   * All editor modules communicate through a single shared N3Events instance.
   */
  class N3Events {
    constructor() {
      /** @type {Map<string, Set<Function>>} */
      this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string}   event    Event name
     * @param {Function} callback Handler function
     */
    on(event, callback) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(callback);
    }

    /**
     * Unsubscribe a previously registered handler.
     * @param {string}   event
     * @param {Function} callback
     */
    off(event, callback) {
      const set = this._listeners.get(event);
      if (set) set.delete(callback);
    }

    /**
     * Emit an event, invoking all registered handlers.
     * @param {string} event
     * @param {*}      [data]  Optional payload passed to each handler
     */
    emit(event, data) {
      const set = this._listeners.get(event);
      if (set) set.forEach(fn => fn(data));
    }

    /**
     * Remove all handlers for a given event.
     * @param {string} event
     */
    clear(event) {
      this._listeners.delete(event);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3UI — CSS injection and shared UI factories
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Static utility class providing:
   * - One-time stylesheet injection (`injectStyles`)
   * - Shared DOM element factories (`btn`, `toast`, `confirm`)
   * - Editor-chrome detection (`isEditorEl`)
   *
   * All CSS classes are prefixed `n3-` to avoid collisions with page styles.
   */
  class N3UI {
    /**
     * Inject the full n3ware stylesheet into `<head>` exactly once.
     * Idempotent — safe to call multiple times.
     */
    static injectStyles() {
      if (document.getElementById('n3ware-styles')) return;
      const s = document.createElement('style');
      s.id = 'n3ware-styles';
      s.textContent = [
        `.n3-edit-btn{position:fixed;bottom:24px;right:24px;z-index:999999;background:${T.accent};color:#fff;border:none;border-radius:8px;padding:10px 20px;font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 24px rgba(59,130,246,.4);display:flex;align-items:center;gap:8px;transition:all .2s;letter-spacing:.02em}`,
        `.n3-edit-btn:hover{background:${T.accentDark};transform:translateY(-1px)}`,
        `.n3-edit-btn.n3-active{background:#EF4444;box-shadow:0 4px 24px rgba(239,68,68,.4)}`,
        `.n3-toolbar{position:fixed;top:0;left:0;right:0;z-index:999998;background:${T.bgPanel};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 12px;height:48px;gap:6px;font:13px/1 system-ui,sans-serif;color:${T.text};box-shadow:0 2px 16px rgba(0,0,0,.4);transform:translateY(-100%);transition:transform .2s ease;will-change:transform}`,
        `.n3-toolbar.n3-visible{transform:translateY(0)}`,
        `.n3-toolbar-logo{font-weight:700;color:${T.accent};margin-right:8px;font-size:15px;letter-spacing:-.5px}`,
        `.n3-toolbar-sep{width:1px;height:24px;background:${T.border};margin:0 4px}`,
        `.n3-toolbar-btn{background:transparent;border:1px solid transparent;color:${T.text};padding:5px 12px;border-radius:6px;cursor:pointer;font:inherit;display:flex;align-items:center;gap:6px;transition:all .15s;white-space:nowrap}`,
        `.n3-toolbar-btn:hover{background:rgba(255,255,255,.08);border-color:${T.border}}`,
        `.n3-toolbar-btn.n3-danger:hover{background:rgba(239,68,68,.15);color:#F87171;border-color:rgba(239,68,68,.3)}`,
        `.n3-toolbar-spacer{flex:1}`,
        `.n3-history-count{font-size:11px;color:${T.muted};background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px}`,
        `body.n3-editing{}`,
        `[data-n3-editable]:focus{outline:2px solid ${T.accent}!important;outline-offset:2px!important;border-radius:2px}`,
        `[data-n3-editable]{cursor:text!important}`,
        `.n3-hovered{outline:1.5px dashed rgba(59,130,246,.5)!important;outline-offset:1px}`,
        `.n3-selected{outline:2px solid ${T.accent}!important;outline-offset:2px}`,
        `.n3-controls{position:absolute;z-index:99999;display:flex;align-items:center;gap:2px;background:${T.bgPanel};border:1px solid ${T.border};border-radius:6px;padding:3px 4px;box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:all;animation:n3-fade-in .12s ease}`,
        `@keyframes n3-fade-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`,
        `.n3-ctrl-btn{background:transparent;border:none;color:${T.muted};width:24px;height:24px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .12s}`,
        `.n3-ctrl-btn:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
        `.n3-ctrl-btn.n3-drag-handle{cursor:grab;font-size:14px}`,
        `.n3-ctrl-btn.n3-drag-handle:active{cursor:grabbing}`,
        `.n3-ctrl-btn.n3-delete:hover{background:rgba(239,68,68,.2);color:#F87171}`,
        `.n3-ctrl-btn.n3-dup:hover{background:rgba(59,130,246,.2);color:${T.accent}}`,
        `.n3-type-label{font:11px/1 system-ui,sans-serif;color:${T.muted};padding:0 6px;border-right:1px solid ${T.border};margin-right:2px}`,
        `.n3-drop-line{position:fixed;height:3px;background:${T.accent};border-radius:2px;z-index:999999;pointer-events:none;box-shadow:0 0 8px rgba(59,130,246,.6);transition:top .05s,left .05s,width .05s}`,
        `.n3-dragging{opacity:.4!important;transform:scale(.98)!important;transition:opacity .1s,transform .1s!important}`,
        `.n3-format-bar{position:fixed;z-index:999999;background:${T.bgPanel};border:1px solid ${T.border};border-radius:8px;padding:5px 6px;display:flex;align-items:center;gap:2px;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:n3-fade-in .12s ease;flex-wrap:wrap;max-width:480px}`,
        `.n3-fmt-btn{background:transparent;border:1px solid transparent;color:${T.text};min-width:28px;height:28px;border-radius:5px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:0 6px;transition:all .12s;gap:4px}`,
        `.n3-fmt-btn:hover{background:rgba(255,255,255,.1);border-color:${T.border}}`,
        `.n3-fmt-btn.n3-active-fmt{background:${T.accent};color:#fff}`,
        `.n3-fmt-sep{width:1px;height:20px;background:${T.border};margin:0 2px}`,
        `.n3-fmt-select{background:rgba(255,255,255,.06);border:1px solid ${T.border};color:${T.text};border-radius:5px;padding:0 6px;height:28px;font:12px/1 system-ui,sans-serif;cursor:pointer;outline:none}`,
        `.n3-fmt-select:hover{border-color:${T.accent}}`,
        `.n3-color-btn{position:relative;width:28px;height:28px}`,
        `.n3-color-btn input[type=color]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}`,
        `.n3-color-swatch{width:28px;height:28px;border-radius:5px;border:1px solid ${T.border};display:flex;align-items:center;justify-content:center;font-size:12px;pointer-events:none;transition:border-color .12s}`,
        `.n3-color-btn:hover .n3-color-swatch{border-color:${T.accent}}`,
        `.n3-style-panel{position:fixed;top:48px;right:0;width:280px;height:calc(100vh - 48px);background:${T.bgPanel};border-left:1px solid ${T.border};z-index:999997;overflow-y:auto;font:13px/1 system-ui,sans-serif;color:${T.text};display:none;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.3);animation:n3-slide-in .2s ease}`,
        `@keyframes n3-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}`,
        `.n3-style-panel.n3-panel-open{display:flex}`,
        `.n3-panel-header{padding:16px;border-bottom:1px solid ${T.border};display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:${T.bgPanel};z-index:1}`,
        `.n3-panel-title{font-weight:600;font-size:14px}`,
        `.n3-panel-tag{font-size:11px;color:${T.accent};background:rgba(59,130,246,.15);padding:2px 8px;border-radius:4px;font-weight:600}`,
        `.n3-panel-close{background:transparent;border:none;color:${T.muted};cursor:pointer;font-size:16px;width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all .12s}`,
        `.n3-panel-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
        `.n3-panel-section{padding:14px 16px;border-bottom:1px solid ${T.border}}`,
        `.n3-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${T.muted};margin-bottom:12px}`,
        `.n3-field{margin-bottom:10px}`,
        `.n3-field-label{font-size:11px;color:${T.muted};margin-bottom:5px;display:flex;justify-content:space-between;align-items:center}`,
        `.n3-field-value{color:${T.text};font-size:11px;font-weight:600}`,
        `.n3-slider{width:100%;height:4px;-webkit-appearance:none;background:${T.border};border-radius:2px;outline:none;cursor:pointer}`,
        `.n3-slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:${T.accent};border-radius:50%;cursor:pointer;box-shadow:0 0 0 2px rgba(59,130,246,.3)}`,
        `.n3-panel-color{width:100%;height:36px;border:1px solid ${T.border};border-radius:6px;cursor:pointer;background:transparent;padding:2px 4px}`,
        `.n3-class-input{width:100%;background:rgba(255,255,255,.05);border:1px solid ${T.border};color:${T.text};border-radius:6px;padding:7px 10px;font:12px/1 monospace;outline:none;box-sizing:border-box;transition:border-color .15s}`,
        `.n3-class-input:focus{border-color:${T.accent}}`,
        `.n3-toast{position:fixed;bottom:80px;right:24px;z-index:9999999;background:${T.bgPanel};border:1px solid ${T.border};color:${T.text};padding:10px 16px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.4);animation:n3-toast-in .2s ease;display:flex;align-items:center;gap:8px;max-width:300px}`,
        `.n3-toast.n3-success{border-left:3px solid #22C55E}`,
        `.n3-toast.n3-error{border-left:3px solid #EF4444}`,
        `.n3-toast.n3-info{border-left:3px solid ${T.accent}}`,
        `@keyframes n3-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`,
        `@keyframes n3-toast-out{from{opacity:1}to{opacity:0;transform:translateY(8px)}}`,
        `.n3-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999998;display:flex;align-items:center;justify-content:center;animation:n3-fade-in .15s ease}`,
        `.n3-confirm-box{background:${T.bgPanel};border:1px solid ${T.border};border-radius:12px;padding:24px;width:320px;box-shadow:0 16px 64px rgba(0,0,0,.6)}`,
        `.n3-confirm-title{font-weight:600;font-size:16px;margin-bottom:8px}`,
        `.n3-confirm-msg{color:${T.muted};font-size:13px;line-height:1.5;margin-bottom:20px}`,
        `.n3-confirm-actions{display:flex;gap:8px;justify-content:flex-end}`,
        `.n3-confirm-btn{padding:8px 18px;border-radius:6px;border:none;cursor:pointer;font:600 13px/1 system-ui,sans-serif;transition:all .12s}`,
        `.n3-confirm-cancel{background:rgba(255,255,255,.08);color:${T.text}}`,
        `.n3-confirm-cancel:hover{background:rgba(255,255,255,.14)}`,
        `.n3-confirm-ok{background:#EF4444;color:#fff}`,
        `.n3-confirm-ok:hover{background:#DC2626}`,
        `.n3-cloud-btn{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.4)!important;color:${T.accent}}`,
        `.n3-cloud-btn:hover{background:rgba(59,130,246,.25)!important}`,
        `.n3-rev-panel{position:fixed;top:48px;right:0;width:320px;height:calc(100vh - 48px);background:${T.bgPanel};border-left:1px solid ${T.border};z-index:999997;overflow-y:auto;font:13px/1 system-ui,sans-serif;color:${T.text};display:none;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.3);animation:n3-slide-in .2s ease}`,
        `.n3-rev-panel.n3-rev-visible{display:flex}`,
        `.n3-rev-header{padding:14px 16px;border-bottom:1px solid ${T.border};display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:${T.bgPanel};font-weight:600;font-size:14px}`,
        `.n3-rev-close{background:transparent;border:none;color:${T.muted};cursor:pointer;font-size:16px;width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all .12s}`,
        `.n3-rev-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
        `.n3-rev-list{display:flex;flex-direction:column;gap:1px;padding:8px}`,
        `.n3-rev-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 8px;border-radius:6px;border:1px solid ${T.border}}`,
        `.n3-rev-meta{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}`,
        `.n3-rev-ts{font-size:11px;color:${T.muted}}`,
        `.n3-rev-msg{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
        `.n3-rev-empty{color:${T.muted};padding:16px;text-align:center}`,
        `.n3-rev-rollback-btn{flex-shrink:0;font-size:11px;padding:4px 8px}`,
        `.n3-mob-show{display:none}`,
        `.n3-mob-dropdown{position:fixed;top:48px;right:0;background:${T.bgPanel};border:1px solid ${T.border};border-radius:0 0 0 8px;min-width:180px;z-index:9999999;flex-direction:column;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none}`,
        `.n3-mob-dropdown.n3-mob-open{display:flex}`,
        `.n3-mob-dd-btn{background:transparent;border:none;color:${T.text};padding:10px 14px;border-radius:6px;cursor:pointer;font:13px/1 system-ui,sans-serif;text-align:left;width:100%;min-height:44px;display:flex;align-items:center;gap:8px;touch-action:manipulation}`,
        `.n3-mob-dd-btn:hover{background:rgba(255,255,255,.08)}`,
        `.n3-fab{position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;flex-direction:column-reverse;align-items:center;gap:10px}`,
        `.n3-fab-toggle{width:48px;height:48px;border-radius:50%;background:${T.accent};color:#fff;border:none;cursor:pointer;font:700 16px/1 system-ui,sans-serif;letter-spacing:-.5px;box-shadow:0 4px 24px rgba(59,130,246,.45);display:flex;align-items:center;justify-content:center;transition:all .25s cubic-bezier(.34,1.56,.64,1)}`,
        `.n3-fab-toggle:hover{background:${T.accentDark};transform:scale(1.1)}`,
        `.n3-fab-toggle.n3-editing{background:#EF4444;box-shadow:0 4px 24px rgba(239,68,68,.5);transform:rotate(45deg)}`,
        `.n3-fab-actions{display:flex;flex-direction:column-reverse;align-items:center;gap:8px;overflow:hidden;max-height:0;opacity:0;transition:max-height .35s cubic-bezier(.4,0,.2,1),opacity .2s}`,
        `.n3-fab.n3-expanded .n3-fab-actions{max-height:300px;opacity:1}`,
        `.n3-fab-btn{width:40px;height:40px;border-radius:50%;background:${T.bgPanel};color:${T.text};border:1px solid ${T.border};cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:all .15s;padding:0}`,
        `.n3-fab-btn:hover{background:rgba(255,255,255,.12);border-color:${T.accent};transform:scale(1.08)}`,
        `.n3-fab-btn.n3-active{background:${T.accent};border-color:${T.accent};box-shadow:0 0 0 3px rgba(59,130,246,.3)}`,
        `.n3-fab-btn.n3-editing{background:#EF4444;border-color:#EF4444}`,
        `.n3-analytics-overlay{position:fixed;bottom:0;left:0;right:0;z-index:999995;background:rgba(10,10,15,.98);border-top:1px solid ${T.border};transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);max-height:78vh;overflow-y:auto;font:13px/1.5 system-ui,sans-serif;color:${T.text};backdrop-filter:blur(12px)}`,
        `.n3-analytics-overlay.n3-open{transform:translateY(0)}`,
        `.n3-an-header{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid ${T.border};background:${T.bgPanel};position:sticky;top:0;z-index:1}`,
        `.n3-an-tabs{display:flex;gap:4px;flex:1}`,
        `.n3-an-tab{background:transparent;border:1px solid transparent;color:${T.muted};padding:4px 12px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;transition:all .12s}`,
        `.n3-an-tab.n3-an-active{background:rgba(255,255,255,.08);border-color:${T.border};color:${T.text}}`,
        `.n3-an-periods{display:flex;gap:2px}`,
        `.n3-an-period{background:transparent;border:1px solid transparent;color:${T.muted};padding:3px 8px;border-radius:5px;cursor:pointer;font:600 11px/1 system-ui;transition:all .12s}`,
        `.n3-an-period.n3-an-active{background:rgba(59,130,246,.2);border-color:rgba(59,130,246,.4);color:${T.accent}}`,
        `.n3-an-close{background:transparent;border:none;color:${T.muted};cursor:pointer;font-size:16px;width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all .12s;flex-shrink:0}`,
        `.n3-an-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
        `.n3-an-body{padding:16px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}`,
        `.n3-an-loading{color:${T.muted};font-size:12px;padding:16px 0;width:100%;text-align:center}`,
        `.n3-an-error{color:#F87171;font-size:12px;padding:8px 0;width:100%}`,
        `.n3-an-stats{display:flex;gap:8px;flex-wrap:wrap;width:100%}`,
        `.n3-an-stat{background:rgba(255,255,255,.05);border:1px solid ${T.border};border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:4px;min-width:80px}`,
        `.n3-an-stat-val{font-size:20px;font-weight:700;line-height:1;display:flex;align-items:center;gap:6px}`,
        `.n3-an-stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${T.muted}}`,
        `.n3-an-pulse{width:8px;height:8px;border-radius:50%;background:#22C55E;animation:n3-pulse 2s ease-in-out infinite;display:inline-block}`,
        `@keyframes n3-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}`,
        `.n3-an-chart-wrap{width:100%}`,
        `.n3-an-chart-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${T.muted};margin-bottom:6px}`,
        `.n3-an-chart{width:100%;overflow:visible}`,
        `.n3-an-section{width:100%}`,
        `.n3-an-section-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${T.muted};margin-bottom:8px}`,
        `.n3-an-sources{display:flex;align-items:center;gap:12px}`,
        `.n3-an-donut{flex-shrink:0}`,
        `.n3-an-legend{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}`,
        `.n3-an-legend-item{display:flex;align-items:center;gap:6px;font-size:11px;overflow:hidden}`,
        `.n3-an-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}`,
        `.n3-an-legend-val{margin-left:auto;color:${T.muted};flex-shrink:0}`,
        `.n3-an-device-bar{height:8px;border-radius:4px;overflow:hidden;display:flex;background:${T.border};margin-bottom:6px}`,
        `.n3-an-device-seg{height:100%;transition:width .5s ease}`,
        `.n3-an-device-labels{display:flex;gap:12px;font-size:11px;color:${T.muted}}`,
        `.n3-an-top-item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px}`,
        `.n3-an-top-path{color:${T.muted};truncate:true;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:70%}`,
        `.n3-an-top-count{color:${T.text};font-weight:600;flex-shrink:0}`,
        `.n3-an-connect-prompt{display:flex;align-items:center;gap:8px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:10px;padding:10px 14px;font-size:12px;color:${T.muted};width:100%}`,
        `.n3-an-stat-change{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:5px;letter-spacing:.02em}`,
        `.n3-an-stat-change.n3-up{color:#22C55E;background:rgba(34,197,94,.14)}`,
        `.n3-an-stat-change.n3-dn{color:#F87171;background:rgba(248,113,113,.14)}`,
        `.n3-an-events{display:flex;flex-direction:column;gap:5px;width:100%}`,
        `.n3-an-event{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid ${T.border};border-radius:8px;padding:9px 12px;transition:background .1s}`,
        `.n3-an-event:hover{background:rgba(255,255,255,.06)}`,
        `.n3-an-event-icon{font-size:17px;width:26px;text-align:center;flex-shrink:0;line-height:1}`,
        `.n3-an-event-label{flex:1;font-size:12px;color:${T.text}}`,
        `.n3-an-event-count{font-size:17px;font-weight:700;color:${T.text};flex-shrink:0;min-width:28px;text-align:right}`,
        `.n3-an-event-trend{font-size:11px;font-weight:700;flex-shrink:0;min-width:38px;text-align:right}`,
        `.n3-an-trend-up{color:#22C55E}`,
        `.n3-an-trend-dn{color:#F87171}`,
        `.n3-an-2col{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}`,
        `.n3-an-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}`,
        `.n3-an-bar-label{font-size:11px;color:${T.muted};width:88px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
        `.n3-an-bar-track{flex:1;height:5px;background:${T.border};border-radius:3px;overflow:hidden}`,
        `.n3-an-bar-fill{height:100%;border-radius:3px;transition:width .5s ease}`,
        `.n3-an-bar-val{font-size:11px;color:${T.muted};width:32px;text-align:right;flex-shrink:0}`,
        `.n3-comp-panel{position:fixed;top:0;left:0;bottom:0;z-index:999996;background:#0B1120;border-right:1px solid ${T.border};width:264px;transform:translateX(-100%);transition:transform .25s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;font:13px/1.5 system-ui,sans-serif;color:${T.text};box-shadow:4px 0 24px rgba(0,0,0,.4)}`,
        `.n3-comp-panel.n3-comp-open{transform:translateX(0)}`,
        `.n3-comp-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 12px;border-bottom:1px solid ${T.border};background:#0B1120;position:sticky;top:0;z-index:1;flex-shrink:0}`,
        `.n3-comp-title{font:700 13px/1 system-ui;color:${T.text};display:flex;align-items:center;gap:7px}`,
        `.n3-comp-close{background:transparent;border:none;color:${T.muted};cursor:pointer;font-size:15px;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;transition:all .12s}`,
        `.n3-comp-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
        `.n3-comp-search-wrap{padding:10px 12px 8px;flex-shrink:0}`,
        `.n3-comp-search{width:100%;background:rgba(255,255,255,.06);border:1px solid ${T.border};color:${T.text};border-radius:7px;padding:7px 10px;font:12px/1 system-ui,sans-serif;outline:none;box-sizing:border-box;transition:border-color .15s}`,
        `.n3-comp-search:focus{border-color:${T.accent}}`,
        `.n3-comp-search::placeholder{color:${T.muted}}`,
        `.n3-comp-cats{display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 10px;flex-shrink:0}`,
        `.n3-comp-cat-btn{background:rgba(255,255,255,.05);border:1px solid transparent;color:${T.muted};padding:3px 8px;border-radius:4px;cursor:pointer;font:600 10px/1 system-ui;transition:all .12s;white-space:nowrap}`,
        `.n3-comp-cat-btn:hover{color:${T.text};border-color:${T.border}}`,
        `.n3-comp-cat-btn.n3-comp-cat-on{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.4);color:${T.accent}}`,
        `.n3-comp-list{flex:1;overflow-y:auto;padding-bottom:16px;scrollbar-width:thin;scrollbar-color:${T.border} transparent}`,
        `.n3-comp-empty{color:${T.muted};font-size:12px;padding:20px 14px;text-align:center;line-height:1.6}`,
        `.n3-comp-group-hdr{font:700 10px/1 system-ui;text-transform:uppercase;letter-spacing:.07em;color:${T.muted};padding:12px 12px 5px;position:sticky;top:0;background:#0B1120;z-index:1}`,
        `.n3-comp-item{display:flex;align-items:center;gap:9px;padding:7px 12px;cursor:grab;transition:background .1s;user-select:none}`,
        `.n3-comp-item:hover{background:rgba(255,255,255,.05)}`,
        `.n3-comp-item:active{cursor:grabbing}`,
        `.n3-comp-thumb{font-size:18px;flex-shrink:0;width:28px;text-align:center;line-height:1}`,
        `.n3-comp-info{flex:1;min-width:0}`,
        `.n3-comp-name{font:600 11px/1.3 system-ui;color:${T.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
        `.n3-comp-badge{font:500 9px/1 system-ui;color:${T.muted};margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
        `.n3-comp-add{flex-shrink:0;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:${T.accent};width:22px;height:22px;border-radius:5px;cursor:pointer;font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .12s;padding:0}`,
        `.n3-comp-add:hover{background:rgba(59,130,246,.28);border-color:rgba(59,130,246,.5);transform:scale(1.1)}`,
        `.n3-comp-drop-target{outline:2px dashed ${T.accent}!important;outline-offset:3px;background:rgba(59,130,246,.06)!important}`,
        // ── Script placeholders ─────────────────────────────────────────────
        `.n3-script-ph{display:flex;align-items:center;gap:10px;background:#0B1120;border:1px dashed ${T.border};border-radius:8px;padding:10px 14px;margin:4px 0;font:13px/1 system-ui,sans-serif;color:${T.text};pointer-events:all;box-sizing:border-box;width:100%}`,
        `.n3-script-ph-icon{font:700 14px/1 monospace;color:${T.accent};flex-shrink:0;width:24px;text-align:center}`,
        `.n3-script-ph-name{flex:1;font-weight:600;font-size:12px;color:${T.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
        `.n3-script-ph-actions{display:flex;gap:5px;flex-shrink:0}`,
        `.n3-script-ph-btn{background:rgba(255,255,255,.07);border:1px solid ${T.border};color:${T.text};padding:4px 10px;border-radius:5px;cursor:pointer;font:600 11px/1 system-ui,sans-serif;transition:all .12s;touch-action:manipulation;white-space:nowrap}`,
        `.n3-script-ph-btn:hover{background:rgba(255,255,255,.14);border-color:#888}`,
        `.n3-script-ph-btn.n3-danger:hover{background:rgba(239,68,68,.2);border-color:rgba(239,68,68,.4);color:#F87171}`,
        // ── Save FAB ────────────────────────────────────────────────────────
        `.n3-save-fab{position:fixed;bottom:24px;right:84px;z-index:99998;background:#22C55E;color:#fff;border:none;padding:12px 20px;border-radius:50px;font:700 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(34,197,94,.4);display:none;align-items:center;gap:6px;transition:background .25s,box-shadow .25s,transform .15s;white-space:nowrap}`,
        `.n3-save-fab:hover{background:#16A34A;transform:translateY(-1px);box-shadow:0 6px 20px rgba(34,197,94,.5)}`,
        `.n3-save-fab.n3-save-pulse{animation:n3-save-pulse 2s ease-in-out infinite}`,
        `@keyframes n3-save-pulse{0%,100%{box-shadow:0 4px 16px rgba(34,197,94,.4)}50%{box-shadow:0 4px 28px rgba(34,197,94,.75)}}`,
        // ── Script code-editor modal ────────────────────────────────────────
        `.n3-script-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999999;display:flex;align-items:center;justify-content:center;animation:n3-fade-in .15s ease}`,
        `.n3-script-modal{background:${T.bgPanel};border:1px solid ${T.border};border-radius:12px;width:min(640px,94vw);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.65)}`,
        `.n3-script-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid ${T.border};flex-shrink:0}`,
        `.n3-script-modal-title{font:600 14px/1 system-ui,sans-serif;color:${T.text}}`,
        `.n3-script-modal-close{background:transparent;border:none;color:${T.muted};cursor:pointer;font-size:16px;width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;transition:all .12s;flex-shrink:0}`,
        `.n3-script-modal-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
        `.n3-script-modal-editor{flex:1;background:#050A14;color:#9CDCFE;border:none;padding:16px 18px;font:13px/1.65 'Fira Code','Cascadia Code','Consolas',monospace;resize:none;outline:none;min-height:220px;max-height:54vh;overflow-y:auto;tab-size:2;box-sizing:border-box}`,
        `.n3-script-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid ${T.border};flex-shrink:0}`,
        `.n3-script-modal-cancel{background:rgba(255,255,255,.07);border:1px solid ${T.border};color:${T.text};padding:7px 16px;border-radius:6px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;transition:all .12s;touch-action:manipulation}`,
        `.n3-script-modal-cancel:hover{background:rgba(255,255,255,.14)}`,
        `.n3-script-modal-save{background:${T.accent};border:1px solid ${T.accent};color:#fff;padding:7px 16px;border-radius:6px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;transition:all .12s;touch-action:manipulation}`,
        `.n3-script-modal-save:hover{background:${T.accentDark}}`,
        // ── Mobile / narrow viewport overrides ──────────────────────────────
        `@media(max-width:767px){
          .n3-mob-hide{display:none!important}
          .n3-mob-show{display:flex!important;align-items:center;justify-content:center}
          .n3-toolbar .n3-toolbar-sep{display:none!important}
          .n3-history-count{display:none!important}
          .n3-toolbar{overflow-x:visible;flex-wrap:nowrap;padding:0 8px;gap:4px}
          .n3-toolbar-btn{padding:4px 8px;min-height:44px;touch-action:manipulation}
          .n3-toolbar-logo{margin-right:4px}
          .n3-style-panel{width:100%!important;height:40vh!important;top:auto!important;bottom:0!important;border-left:none!important;border-top:1px solid ${T.border}!important;border-radius:12px 12px 0 0!important;}
          .n3-format-bar{overflow-x:auto;flex-wrap:nowrap;max-width:calc(100vw - 16px)}
          .n3-format-bar::after{content:'';position:absolute;right:0;top:0;bottom:0;width:36px;background:linear-gradient(to right,rgba(17,17,17,0),rgba(17,17,17,.95));pointer-events:none;border-radius:0 8px 8px 0}
          .n3-fmt-btn{min-width:36px;height:40px;touch-action:manipulation}
          .n3-fmt-select{height:40px;font-size:14px;touch-action:manipulation}
          .n3-type-label{display:none!important}
          .n3-ctrl-btn{width:32px!important;height:32px!important;touch-action:manipulation}
          .n3-controls{gap:2px!important;padding:3px 4px!important;flex-wrap:nowrap}
          .n3-analytics-overlay{max-height:100dvh!important;border-radius:0!important}
          .n3-an-2col{grid-template-columns:1fr!important}
          .n3-fab{bottom:16px!important;right:12px!important;}
          .n3-fab-toggle{width:40px!important;height:40px!important;font-size:14px!important;touch-action:manipulation}
          .n3-fab-btn{touch-action:manipulation}
          body.n3-editing{padding-top:48px!important;}
          .n3-save-fab{bottom:20px!important;right:62px!important;padding:10px 14px!important;font-size:13px!important}
        }`,
      ].join('\n');
      document.head.appendChild(s);
    }

    /**
     * Create a `<button>` element with given content and CSS class.
     * @param {string} label   innerHTML for the button
     * @param {string} cls     CSS class string
     * @param {string} [title] Optional tooltip text
     * @returns {HTMLButtonElement}
     */
    static btn(label, cls, title) {
      const b = document.createElement('button');
      b.className = cls;
      b.innerHTML = label;
      if (title) b.title = title;
      return b;
    }

    /**
     * Display a temporary toast notification at the bottom-right of the viewport.
     * @param {string}                      msg
     * @param {'info'|'success'|'error'}    [type='info']
     * @param {number}                      [duration=2500]  Display time in ms
     */
    static toast(msg, type = 'info', duration = 2500) {
      const _icFn = (window._n3wareModules||{}).icon;
      const icons = {
        success: _icFn ? _icFn('check', {size: 14}) : '✓',
        error:   _icFn ? _icFn('x',     {size: 14}) : '✗',
        info:    _icFn ? _icFn('help-circle', {size: 14}) : 'i',
      };
      const el = document.createElement('div');
      el.className = `n3-toast n3-${type}`;
      el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.animation = 'n3-toast-out .2s ease forwards';
        setTimeout(() => el.remove(), 200);
      }, duration);
    }

    /**
     * Show a modal confirmation dialog.
     * @param {string} title  Dialog heading
     * @param {string} msg    Body text
     * @returns {Promise<boolean>} Resolves `true` if confirmed, `false` if cancelled
     */
    static confirm(title, msg) {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'n3-confirm-overlay';
        overlay.innerHTML = `<div class="n3-confirm-box"><div class="n3-confirm-title">${title}</div><div class="n3-confirm-msg">${msg}</div><div class="n3-confirm-actions"><button class="n3-confirm-btn n3-confirm-cancel">Cancel</button><button class="n3-confirm-btn n3-confirm-ok">Delete</button></div></div>`;
        document.body.appendChild(overlay);
        const done = v => { overlay.remove(); resolve(v); };
        overlay.querySelector('.n3-confirm-cancel').onclick = () => done(false);
        overlay.querySelector('.n3-confirm-ok').onclick    = () => done(true);
        overlay.onclick = e => { if (e.target === overlay) done(false); };
      });
    }

    /**
     * Returns `true` if `el` is (or is inside) n3ware's own editor chrome.
     * Used to skip editor interactions on editor-owned elements.
     * @param {Element} el
     * @returns {boolean}
     */
    static isEditorEl(el) {
      return !!(el && (
        el.closest('.n3-controls')             ||
        el.closest('.n3-format-bar')           ||
        el.closest('.n3-style-panel')          ||
        el.closest('.n3-toolbar')              ||
        el.closest('.n3-fab')                  ||
        el.closest('.n3-analytics-overlay')    ||
        el.closest('.n3-comp-panel')           ||
        el.closest('.n3-confirm-overlay')      ||
        el.closest('.n3-toast')                ||
        el.closest('.n3-script-modal-overlay') ||
        el.closest('.n3-script-ph')      ||
        el.closest('.n3-save-fab')
      ));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3History — snapshot-based undo/redo stack
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Manages a bounded stack of HTML snapshots for undo/redo operations.
   * Snapshots are taken of `document.body.innerHTML` at meaningful edit points.
   */
  class N3History {
    /**
     * @param {N3Events} events
     * @param {number}   [maxDepth=100]  Maximum number of snapshots to retain
     */
    constructor(events, maxDepth = 100) {
      this._events   = events;
      this._maxDepth = maxDepth;
      /** @type {string[]} */
      this._stack = [];
      this._index = -1;
    }

    /**
     * Push a new HTML snapshot onto the stack.
     * Any forward history beyond the current index is discarded.
     * @param {string} snapshot  `document.body.innerHTML` string
     */
    push(snapshot) {
      if (this._stack[this._index] === snapshot) return;
      this._stack = this._stack.slice(0, this._index + 1);
      this._stack.push(snapshot);
      if (this._stack.length > this._maxDepth) this._stack.shift();
      else this._index++;
      this._events.emit('history:change', this._state());
    }

    /** @returns {boolean} Whether an undo operation is available */
    canUndo() { return this._index > 0; }

    /** @returns {boolean} Whether a redo operation is available */
    canRedo() { return this._index < this._stack.length - 1; }

    /**
     * Move to the previous snapshot.
     * @returns {string|null} The restored snapshot, or `null` if already at the start
     */
    undo() {
      if (!this.canUndo()) return null;
      this._index--;
      this._events.emit('history:change', this._state());
      return this._stack[this._index];
    }

    /**
     * Move to the next snapshot.
     * @returns {string|null} The restored snapshot, or `null` if already at the end
     */
    redo() {
      if (!this.canRedo()) return null;
      this._index++;
      this._events.emit('history:change', this._state());
      return this._stack[this._index];
    }

    /**
     * Return the current snapshot without modifying the stack pointer.
     * @returns {string|null}
     */
    current() { return this._stack[this._index] ?? null; }

    /** Reset the history stack to empty. */
    reset() {
      this._stack = [];
      this._index = -1;
      this._events.emit('history:change', this._state());
    }

    /** @returns {{ index: number, total: number }} */
    _state() { return { index: this._index, total: this._stack.length }; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Editor — main orchestrator + public API surface
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Central editor orchestrator. Instantiates and wires all sub-modules,
   * manages edit mode state, and exposes the public `window.n3ware` API.
   *
   * Sub-module classes (N3TextEditor, N3StylePanel, etc.) are read from
   * `window._n3wareModules` which is populated by companion scripts loaded
   * in parallel before this constructor runs.
   */
  class N3Editor {
    constructor() {
      this._editMode    = false;
      this._activeEl    = null;
      this._initialHTML = null;

      // Read cloud config from the <script> tag that loaded n3ware.js.
      // document.currentScript is null in Promise callbacks, so fall back to
      // querying by data attribute.
      const scriptTag = document.querySelector('script[data-n3-site]');
      const cloudApi  = scriptTag && scriptTag.dataset.n3Api;
      const cloudSite = scriptTag && scriptTag.dataset.n3Site;
      const cloudKey  = scriptTag && scriptTag.dataset.n3Key;
      this._cloudCfg  = (cloudApi && cloudSite)
        ? { api: cloudApi, site: cloudSite, key: cloudKey || '' } : null;

      // Pull companion module classes from the shared namespace
      const M = window._n3wareModules || {};

      // Core modules (always available — defined in this file)
      this.events  = new N3Events();
      this.history = new N3History(this.events);

      // Style / export modules
      this.exporter = M.N3Export        ? new M.N3Export(this.events)        : null;
      this.panel    = M.N3StylePanel    ? new M.N3StylePanel(this.events)    : null;
      this.toolbar  = M.N3Toolbar       ? new M.N3Toolbar(this.events, { cloud: !!this._cloudCfg }) : null;

      // Text / interaction modules
      this.text     = M.N3TextEditor    ? new M.N3TextEditor(this.events)    : null;
      this.drag     = M.N3DragManager   ? new M.N3DragManager(this.events)   : null;
      this.controls = (M.N3ElementControls && this.drag)
        ? new M.N3ElementControls(this.events, this.drag) : null;

      // Cloud / revision modules
      this.cloud    = (M.N3Cloud && this._cloudCfg)
        ? new M.N3Cloud(this._cloudCfg.api, this._cloudCfg.site, this._cloudCfg.key) : null;
      this.revPanel = (M.N3RevPanel && this.cloud)
        ? new M.N3RevPanel(this.events, this.cloud) : null;

      // Analytics + script-placeholder modules
      this.analytics = M.N3Analytics      ? new M.N3Analytics(this._cloudCfg)          : null;
      this.scripts   = M.N3ScriptPlaceholders ? new M.N3ScriptPlaceholders(this.events) : null;

      // Component library
      this.components = M.N3Components
        ? new M.N3Components(this.events, this._cloudCfg) : null;

      this._fab     = null;
      this._fabOpen = false;
      this._onKeyDown = this._handleKeyDown.bind(this);

      // v2: dirty tracking for GCS file saves
      this._dirty = { pages: new Set(), components: new Set() };
      this._saveBtn = null;
    }

    /**
     * Initialise all editor chrome. Call once after the DOM is ready.
     * Mounts toolbar, panels, FAB, and wires event handlers.
     */
    init() {
      N3UI.injectStyles();
      if (this.toolbar)    this.toolbar.mount();
      if (this.panel)      this.panel.mount();
      if (this.revPanel)   this.revPanel.mount();
      if (this.analytics)  this.analytics.mount();
      if (this.components) this.components.mount();
      this._buildControlPanel();
      this._buildSaveBtn();
      this._wireEvents();
      document.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * Toggle, force-enable, or force-disable edit mode.
     * @param {boolean} [force]  If provided, forces edit mode on (`true`) or off (`false`)
     */
    toggle(force) {
      const next = (force !== undefined) ? force : !this._editMode;
      if (next === this._editMode) return;
      this._editMode = next;
      if (next) {
        this._initialHTML = this.exporter ? this.exporter.cleanHTML() : '';
        this.history.reset();
        this.history.push(document.body.innerHTML);
        this._enter();
      } else {
        this._exit();
      }
      this.events.emit('editor:modeChange', next);
    }

    /**
     * @returns {boolean} Whether edit mode is currently active
     */
    isEditing() { return this._editMode; }

    /**
     * Build and return the public API object attached to `window.n3ware`.
     * @returns {object}
     */
    publicAPI() {
      return {
        /** Toggle edit mode on or off */
        toggle:  ()       => this.toggle(),
        /** Force edit mode on */
        enable:  ()       => this.toggle(true),
        /** Force edit mode off */
        disable: ()       => this.toggle(false),
        /** Download clean HTML */
        export:  ()       => this.exporter && this.exporter.downloadHTML(),
        /** Copy clean HTML to clipboard */
        copy:    ()       => this.exporter && this.exporter.copyHTML(),
        /** Undo the last edit */
        undo:    ()       => this._doUndo(),
        /** Redo the last undone edit */
        redo:    ()       => this._doRedo(),
        /** Subscribe to an editor event */
        on:      (ev, cb) => this.events.on(ev, cb),
        /** Unsubscribe from an editor event */
        off:     (ev, cb) => this.events.off(ev, cb),
        /** Direct module references for advanced / testing usage */
        _modules: {
          events: this.events, history: this.history, exporter: this.exporter,
          text: this.text, drag: this.drag, controls: this.controls,
          panel: this.panel, toolbar: this.toolbar, cloud: this.cloud,
          analytics: this.analytics, components: this.components,
          scripts: this.scripts,
        },
      };
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _buildControlPanel() {
      const PENCIL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      const CHART  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`;
      const GRID   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`;

      this._fab = document.createElement('div');
      this._fab.className = 'n3-fab';
      this._fab.setAttribute('data-n3-ui', '1');

      const actions = document.createElement('div');
      actions.className = 'n3-fab-actions';

      const analyticsBtn = document.createElement('button');
      analyticsBtn.className = 'n3-fab-btn';
      analyticsBtn.innerHTML = CHART;
      analyticsBtn.title = 'Analytics';
      analyticsBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (this.analytics) { this.analytics.toggle(); analyticsBtn.classList.toggle('n3-active', this.analytics.isOpen()); }
      });

      const compBtn = document.createElement('button');
      compBtn.className = 'n3-fab-btn';
      compBtn.innerHTML = GRID;
      compBtn.title = 'Component Library';
      compBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (this.components) { this.components.toggle(); compBtn.classList.toggle('n3-active', this.components.isOpen()); }
      });

      const editBtn = document.createElement('button');
      editBtn.className = 'n3-fab-btn';
      editBtn.innerHTML = PENCIL;
      editBtn.title = 'Toggle Edit Mode (Ctrl+Shift+E)';
      editBtn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });

      actions.appendChild(analyticsBtn);
      actions.appendChild(compBtn);

      if (this._cloudCfg) {
        const PLUS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const pageBtn = document.createElement('button');
        pageBtn.className = 'n3-fab-btn';
        pageBtn.innerHTML = PLUS;
        pageBtn.title = 'New Page';
        pageBtn.addEventListener('click', e => { e.stopPropagation(); this._openPageCreator(); });
        actions.appendChild(pageBtn);
        this._pageFabBtn = pageBtn;
      }

      actions.appendChild(editBtn);
      this._editFabBtn      = editBtn;
      this._analyticsFabBtn = analyticsBtn;
      this._compFabBtn      = compBtn;

      const toggle = document.createElement('button');
      toggle.className = 'n3-fab-toggle';
      toggle.innerHTML = 'n';
      toggle.title = 'n3ware';
      toggle.addEventListener('click', () => {
        this._fabOpen = !this._fabOpen;
        this._fab.classList.toggle('n3-expanded', this._fabOpen);
      });

      this._fab.appendChild(actions);
      this._fab.appendChild(toggle);
      document.body.appendChild(this._fab);
    }

    _syncEditBtn(on) {
      if (!this._editFabBtn) return;
      this._editFabBtn.classList.toggle('n3-editing', on);
      const toggle = this._fab && this._fab.querySelector('.n3-fab-toggle');
      if (toggle) toggle.classList.toggle('n3-editing', on);
    }

    // ── Page Creator Modal ────────────────────────────────────────────────────

    _openPageCreator() {
      if (!this._cloudCfg) return;
      if (!this._pageCreatorEl) this._buildPageCreator();
      this._selectedTemplate = undefined;
      this._pcImages = [];
      this._pcDone   = false;
      this._pcGoToStep1();
      this._pageCreatorEl.style.display = 'flex';
    }

    _pcGoToStep1() {
      const el = this._pageCreatorEl;
      el.querySelector('#n3pc-step1').style.display = 'block';
      el.querySelector('#n3pc-step2').style.display = 'none';
    }

    _pcGoToStep2(template) {
      this._selectedTemplate = template || null;
      const el = this._pageCreatorEl;
      el.querySelector('#n3pc-step1').style.display = 'none';

      // Reset step 2 state
      const nameInput = el.querySelector('#n3pc-name');
      el.querySelector('#n3pc-slug-preview').textContent = '';
      el.querySelector('#n3pc-thumbs').innerHTML = '';
      el.querySelector('#n3pc-form-body').style.display = 'block';
      el.querySelector('#n3pc-spinner').style.display = 'none';
      el.querySelector('#n3pc-success').style.display = 'none';
      el.querySelector('#n3pc-generate-btn').disabled = false;
      el.querySelector('#n3pc-generate-btn').style.display = 'block';

      // Update heading + badge
      const badge = el.querySelector('#n3pc-template-badge');
      const _iconFn = (name, sz) => { const fn = (window._n3wareModules || {}).icon; return fn ? fn(name, { size: sz || 14 }) : ''; };
      if (template) {
        el.querySelector('#n3pc-step2-title').textContent = `Customize: ${template.name}`;
        badge.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;vertical-align:middle">${_iconFn(template.lucideIcon, 14)} ${template.name}</span>`;
        badge.style.display = 'inline-block';
        nameInput.value = template.defaultName || '';
        el.querySelector('#n3pc-desc').value = template.defaultPrompt || '';
        const slug = this._toSlug(nameInput.value);
        const sp = el.querySelector('#n3pc-slug-preview');
        sp.textContent = slug ? `URL slug: /${slug}` : '';
        sp.style.color = slug ? '#E31137' : '#555';
        el.querySelector('#n3pc-generate-btn').textContent = 'Customize with AI';
      } else {
        el.querySelector('#n3pc-step2-title').textContent = 'Create New Page';
        badge.style.display = 'none';
        nameInput.value = '';
        el.querySelector('#n3pc-desc').value = '';
        el.querySelector('#n3pc-generate-btn').textContent = 'Generate Page with AI';
      }

      el.querySelector('#n3pc-step2').style.display = 'block';
      setTimeout(() => nameInput.focus(), 80);
    }

    _buildPageCreator() {
      // Template metadata (mirrors page-templates.json, subset for UI)
      const TEMPLATES = [
        { id: 'about-team',    name: 'About & Team',  lucideIcon: 'users',        description: 'Company story, mission & team',  defaultName: 'About Us',    defaultSlug: 'about',        defaultPrompt: 'A professional About Us page with our company story, mission, values, and team members.' },
        { id: 'services',      name: 'Services',       lucideIcon: 'wrench',       description: 'Showcase your services',         defaultName: 'Services',    defaultSlug: 'services',     defaultPrompt: 'A services page listing all the services we offer with descriptions and a CTA.' },
        { id: 'pricing',       name: 'Pricing',        lucideIcon: 'dollar-sign',  description: 'Tiered plans with feature lists', defaultName: 'Pricing',     defaultSlug: 'pricing',      defaultPrompt: 'A pricing page with 3 tiers, feature comparison, and a bold CTA.' },
        { id: 'contact',       name: 'Contact',        lucideIcon: 'mail',         description: 'Contact form + map + hours',     defaultName: 'Contact Us',  defaultSlug: 'contact',      defaultPrompt: 'A contact page with a form, phone/email, address, hours of operation, and a map embed.' },
        { id: 'faq',           name: 'FAQ',            lucideIcon: 'help-circle',  description: 'Accordion Q&A section',          defaultName: 'FAQ',         defaultSlug: 'faq',          defaultPrompt: 'A FAQ page with an accordion-style list of common questions and detailed answers.' },
        { id: 'portfolio',     name: 'Portfolio',      lucideIcon: 'image',        description: 'Project / work showcase grid',   defaultName: 'Portfolio',   defaultSlug: 'portfolio',    defaultPrompt: 'A portfolio page with a filterable grid of projects, descriptions, and links.' },
        { id: 'testimonials',  name: 'Testimonials',   lucideIcon: 'star',         description: 'Customer reviews & quotes',      defaultName: 'Reviews',     defaultSlug: 'testimonials', defaultPrompt: 'A testimonials page with customer quotes, star ratings, and photos.' },
        { id: 'locations',     name: 'Locations',      lucideIcon: 'map-pin',      description: 'Multi-location cards + maps',    defaultName: 'Locations',   defaultSlug: 'locations',    defaultPrompt: 'A locations page with each location\'s address, hours, phone number, and map link.' },
        { id: 'blog',          name: 'Blog',           lucideIcon: 'newspaper',    description: 'Article listing with previews',  defaultName: 'Blog',        defaultSlug: 'blog',         defaultPrompt: 'A blog index page with article cards, categories, and a newsletter signup.' },
        { id: 'menu',          name: 'Menu',           lucideIcon: 'utensils',     description: 'Restaurant / café menu layout',  defaultName: 'Menu',        defaultSlug: 'menu',         defaultPrompt: 'A restaurant menu page with sections for appetizers, mains, desserts, drinks, and prices.' },
        { id: 'booking',       name: 'Booking',        lucideIcon: 'calendar',     description: 'Appointment / reservation CTA',  defaultName: 'Book Now',    defaultSlug: 'booking',      defaultPrompt: 'A booking page with service options, availability info, and a prominent booking CTA.' },
        { id: 'landing',       name: 'Landing Page',   lucideIcon: 'rocket',       description: 'High-conversion promo page',     defaultName: 'Special Offer', defaultSlug: 'landing',   defaultPrompt: 'A high-conversion landing page with a hero, benefits, social proof, and a strong CTA.' },
      ];

      const el = document.createElement('div');
      el.setAttribute('data-n3-ui', '1');
      Object.assign(el.style, {
        position: 'fixed', inset: '0', zIndex: '100002',
        background: 'rgba(0,0,0,0.88)',
        display: 'none', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui,-apple-system,sans-serif',
      });

      const card = document.createElement('div');
      Object.assign(card.style, {
        background: '#1A1A1A', color: '#fff',
        borderRadius: '16px', border: '1px solid #2a2a2a',
        width: '100%', maxWidth: '680px', maxHeight: '90vh',
        overflowY: 'auto', padding: '32px',
        position: 'relative', boxSizing: 'border-box', margin: '16px',
      });

      const _icon = (name, sz) => {
        const fn = (window._n3wareModules || {}).icon;
        return fn ? fn(name, { size: sz || 22 }) : '';
      };

      card.innerHTML = `
        <button id="n3pc-close" style="position:absolute;top:16px;right:16px;background:none;border:none;color:#666;cursor:pointer;padding:6px;border-radius:6px;line-height:1;display:flex;align-items:center;justify-content:center" title="Close">${_icon('x', 18)}</button>

        <!-- Step 1: Template picker -->
        <div id="n3pc-step1">
          <h2 style="margin:0 0 6px;font-size:21px;font-weight:700;color:#fff">Create New Page</h2>
          <p style="margin:0 0 24px;color:#888;font-size:14px">Choose a starting point</p>
          <div id="n3pc-tpl-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
            <button class="n3pc-tpl-card" data-tpl="__scratch__" style="background:#0A0A0A;border:1px solid #333;border-radius:10px;padding:14px 12px;text-align:center;cursor:pointer;color:#fff;transition:border-color 0.15s">
              <div style="display:flex;align-items:center;justify-content:center;margin-bottom:6px">${_icon('sparkles', 22)}</div>
              <div style="font-size:13px;font-weight:600;margin-bottom:3px">From Scratch</div>
              <div style="font-size:11px;color:#666">AI writes everything</div>
            </button>
            ${TEMPLATES.map(t => `
            <button class="n3pc-tpl-card" data-tpl="${t.id}" style="background:#0A0A0A;border:1px solid #333;border-radius:10px;padding:14px 12px;text-align:center;cursor:pointer;color:#fff;transition:border-color 0.15s">
              <div style="display:flex;align-items:center;justify-content:center;margin-bottom:6px">${_icon(t.lucideIcon, 22)}</div>
              <div style="font-size:13px;font-weight:600;margin-bottom:3px">${t.name}</div>
              <div style="font-size:11px;color:#666">${t.description}</div>
            </button>`).join('')}
          </div>
        </div>

        <!-- Step 2: Form -->
        <div id="n3pc-step2" style="display:none">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <button id="n3pc-back" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px" title="Back">←</button>
            <h2 id="n3pc-step2-title" style="margin:0;font-size:21px;font-weight:700;color:#fff">Create New Page</h2>
          </div>
          <div id="n3pc-template-badge" style="display:none;background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:6px 12px;font-size:12px;color:#aaa;margin-bottom:20px"></div>

          <div id="n3pc-form-body">
            <label style="display:block;margin-bottom:6px;font-size:13px;color:#aaa;font-weight:500">Page Name <span style="color:#E31137">*</span></label>
            <input id="n3pc-name" type="text" placeholder="e.g. Our Menu" autocomplete="off"
              style="width:100%;box-sizing:border-box;background:#0A0A0A;border:1px solid #333;border-radius:8px;padding:10px 14px;color:#fff;font-size:15px;outline:none;margin-bottom:4px">
            <div id="n3pc-slug-preview" style="font-size:12px;color:#555;margin-bottom:18px;min-height:16px"></div>

            <label style="display:block;margin-bottom:6px;font-size:13px;color:#aaa;font-weight:500">Description <span style="color:#555">(optional)</span></label>
            <textarea id="n3pc-desc" rows="4" placeholder="Describe your business context, key content, tone…"
              style="width:100%;box-sizing:border-box;background:#0A0A0A;border:1px solid #333;border-radius:8px;padding:10px 14px;color:#fff;font-size:14px;outline:none;resize:vertical;margin-bottom:20px;font-family:inherit"></textarea>

            <label style="display:block;margin-bottom:8px;font-size:13px;color:#aaa;font-weight:500">Upload Images <span style="color:#555">(optional)</span></label>
            <div id="n3pc-dropzone" style="background:#0A0A0A;border:2px dashed #333;border-radius:10px;padding:24px;text-align:center;cursor:pointer;margin-bottom:10px;transition:border-color 0.2s">
              <div style="margin-bottom:6px;display:flex;justify-content:center;opacity:0.5">${((window._n3wareModules||{}).icon||function(){return'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>'})('camera', {size: 26})}</div>
              <div style="color:#666;font-size:14px">Drop images here or <span style="color:#E31137">click to browse</span></div>
              <div style="color:#444;font-size:12px;margin-top:4px">JPG, PNG, WebP · max 5 MB each</div>
              <input id="n3pc-file-input" type="file" accept="image/*" multiple style="display:none">
            </div>
            <div id="n3pc-thumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px"></div>
          </div>

          <div id="n3pc-spinner" style="display:none;text-align:center;padding:48px 20px">
            <div style="width:64px;height:64px;border:4px solid #2a2a2a;border-top-color:#E31137;border-radius:50%;animation:n3-spin 1s linear infinite;margin:0 auto 24px"></div>
            <h3 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 10px">Creating your page…</h3>
            <p id="n3pc-spin-status" style="color:#888;font-size:14px;margin:0;min-height:20px">Picking the best components…</p>
          </div>

          <div id="n3pc-success" style="display:none;background:#0c2318;border:1px solid #1a5c38;border-radius:10px;padding:14px 16px;margin-bottom:18px">
            <div style="color:#4ade80;font-size:14px;font-weight:600;margin-bottom:6px">✓ Page created!</div>
            <div id="n3pc-success-msg" style="font-size:13px;color:#86efac"></div>
          </div>

          <button id="n3pc-generate-btn"
            style="width:100%;background:#E31137;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity 0.2s">
            <span style="display:inline-flex;align-items:center;gap:6px;justify-content:center">${((window._n3wareModules||{}).icon||function(){return''})('bot', {size: 18})} Generate Page with AI</span>
          </button>
        </div>`;

      el.appendChild(card);

      // Close / backdrop
      card.querySelector('#n3pc-close').addEventListener('click', () => { el.style.display = 'none'; });
      el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });

      // Back button
      card.querySelector('#n3pc-back').addEventListener('click', () => this._pcGoToStep1());

      // Template cards (step 1)
      card.querySelectorAll('.n3pc-tpl-card').forEach(btn => {
        btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#E31137'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#333'; });
        btn.addEventListener('click', () => {
          const tplId = btn.dataset.tpl;
          if (tplId === '__scratch__') {
            this._pcGoToStep2(null);
          } else {
            const tpl = TEMPLATES.find(t => t.id === tplId);
            this._pcGoToStep2(tpl || null);
          }
        });
      });

      // Slug preview
      const nameInput   = card.querySelector('#n3pc-name');
      const slugPreview = card.querySelector('#n3pc-slug-preview');
      nameInput.addEventListener('input', () => {
        const slug = this._toSlug(nameInput.value);
        slugPreview.textContent = slug ? `URL slug: /${slug}` : '';
        slugPreview.style.color = slug ? '#E31137' : '#555';
      });

      // Image drop zone
      const dropzone  = card.querySelector('#n3pc-dropzone');
      const fileInput = card.querySelector('#n3pc-file-input');
      const thumbsEl  = card.querySelector('#n3pc-thumbs');
      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = '#E31137'; });
      dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#333'; });
      dropzone.addEventListener('drop', e => {
        e.preventDefault(); dropzone.style.borderColor = '#333';
        this._pcAddImages(Array.from(e.dataTransfer.files), thumbsEl);
      });
      fileInput.addEventListener('change', () => {
        this._pcAddImages(Array.from(fileInput.files), thumbsEl);
        fileInput.value = '';
      });

      // Generate button
      card.querySelector('#n3pc-generate-btn').addEventListener('click', () => {
        if (this._pcDone) { el.style.display = 'none'; return; }
        this._runPageGeneration(el);
      });

      this._pageCreatorEl = el;
      this._pcImages = [];
      this._pcDone   = false;
      document.body.appendChild(el);
    }

    _toSlug(name) {
      return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }

    _pcAddImages(files, thumbsEl) {
      if (!this._pcImages) this._pcImages = [];
      files.filter(f => f.type.startsWith('image/')).forEach(file => {
        if (file.size > 5 * 1024 * 1024) { N3UI.toast(`${file.name} exceeds 5 MB`, 'error'); return; }
        this._pcImages.push(file);
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { position: 'relative', width: '72px', height: '72px', flexShrink: '0' });
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        Object.assign(img.style, { width:'72px', height:'72px', objectFit:'cover', borderRadius:'8px', border:'1px solid #333', display:'block' });
        const rm = document.createElement('button');
        rm.textContent = '×';
        Object.assign(rm.style, { position:'absolute', top:'-6px', right:'-6px', background:'#E31137', color:'#fff', border:'none', borderRadius:'50%', width:'18px', height:'18px', fontSize:'13px', cursor:'pointer', lineHeight:'18px', padding:'0', textAlign:'center' });
        rm.addEventListener('click', e => { e.stopPropagation(); this._pcImages = this._pcImages.filter(f => f !== file); wrap.remove(); });
        wrap.appendChild(img); wrap.appendChild(rm); thumbsEl.appendChild(wrap);
      });
    }

    async _runPageGeneration(el) {
      const nameVal   = el.querySelector('#n3pc-name').value.trim();
      if (!nameVal) { N3UI.toast('Page name is required', 'error'); el.querySelector('#n3pc-name').focus(); return; }
      const description = el.querySelector('#n3pc-desc').value.trim() || `A page called ${nameVal}`;
      const formBody    = el.querySelector('#n3pc-form-body');
      const spinnerEl   = el.querySelector('#n3pc-spinner');
      const spinStatus  = el.querySelector('#n3pc-spin-status');
      const successEl   = el.querySelector('#n3pc-success');
      const genBtn      = el.querySelector('#n3pc-generate-btn');

      const { api, site, key } = this._cloudCfg;

      // Build auth headers: prefer JWT cookie, fall back to site API key
      const cookieJwt = document.cookie.match(/n3_token=([^;]+)/)?.[1]
                     || sessionStorage.getItem('n3_auth');
      const jsonHeaders = { 'Content-Type': 'application/json' };
      const uploadHdrBase = {};
      if (cookieJwt) {
        jsonHeaders['Authorization']   = 'Bearer ' + cookieJwt;
        uploadHdrBase['Authorization'] = 'Bearer ' + cookieJwt;
      } else if (key) {
        jsonHeaders['X-API-Key']   = key;
        uploadHdrBase['X-API-Key'] = key;
      }

      // Inject spin keyframes once
      if (!document.getElementById('n3-spin-kf')) {
        const s = document.createElement('style');
        s.id = 'n3-spin-kf';
        s.textContent = '@keyframes n3-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
      }

      // Switch to spinner view
      formBody.style.display  = 'none';
      genBtn.style.display    = 'none';
      successEl.style.display = 'none';
      spinnerEl.style.display = 'block';

      const statuses = [
        'Picking the best components…',
        'Writing your content…',
        'Adding photos…',
        'Updating your navigation…',
        'Almost done…',
      ];
      let statusIdx = 0;
      spinStatus.textContent = statuses[0];
      const statusInterval = setInterval(() => {
        statusIdx = (statusIdx + 1) % statuses.length;
        spinStatus.textContent = statuses[statusIdx];
      }, 4000);

      const _stopSpinner = () => {
        clearInterval(statusInterval);
        spinnerEl.style.display = 'none';
      };

      try {
        // 1. Upload images
        const imageUrls = [];
        const images    = this._pcImages || [];
        if (images.length > 0) {
          spinStatus.textContent = `Uploading ${images.length} image(s)…`;
          for (let i = 0; i < images.length; i++) {
            const fd = new FormData();
            fd.append('file', images[i]);
            const r = await fetch(`${api}/uploads/${site}/upload`, { method: 'POST', headers: uploadHdrBase, credentials: 'include', body: fd });
            if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Upload failed: ${r.status}`); }
            const { file: uploaded } = await r.json();
            imageUrls.push(uploaded.url);
          }
        }

        // 2. Generate page with AI (pass templateId if a template was selected)
        const body = { name: nameVal, description, imageUrls };
        if (this._selectedTemplate) body.templateId = this._selectedTemplate.id;
        const genRes = await fetch(`${api}/sites/${site}/pages/generate`, {
          method: 'POST', headers: jsonHeaders, credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!genRes.ok) {
          const e = await genRes.json().catch(() => ({}));
          throw new Error(e.error || `Generation failed: ${genRes.status}`);
        }
        const genData = await genRes.json();

        _stopSpinner();

        // 3. Show success
        successEl.style.display = 'block';
        const pageUrl = `https://assembler.n3ware.com/sites/${site}/${genData.slug}`;
        el.querySelector('#n3pc-success-msg').innerHTML =
          `<strong>${nameVal}</strong> — <a href="${pageUrl}" target="_blank" style="color:#4ade80;text-decoration:underline">View page →</a>`;
        genBtn.textContent   = '✓ Done — Close';
        genBtn.style.display = 'block';
        genBtn.disabled      = false;
        this._pcDone         = true;
        N3UI.toast(`Page "${nameVal}" created!`, 'success');
      } catch (err) {
        _stopSpinner();
        formBody.style.display  = 'block';
        genBtn.style.display    = 'block';
        genBtn.disabled         = false;
        const _botIc = ((window._n3wareModules||{}).icon||function(){return''})('bot', {size: 18});
        genBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;justify-content:center">${_botIc} ${this._selectedTemplate ? 'Customize with AI' : 'Generate Page with AI'}</span>`;
        N3UI.toast(`Error: ${err.message}`, 'error');
      }
    }

    _enter() {
      this._dirty.pages.clear();
      this._dirty.components.clear();
      if (this.analytics && this.analytics.isOpen()) this.analytics.close();
      if (this.text)     this.text.enable();
      this._markBlocks();
      if (this.controls) this.controls.enable();
      if (this.scripts)  this.scripts.enable();
      if (this.toolbar)  this.toolbar.show();
      document.body.classList.add('n3-editing');
      this._syncEditBtn(true);
      document.addEventListener('click', this._onClickEl = this._handleClick.bind(this), true);
      document.addEventListener('focus', this._onFocus   = this._handleFocus.bind(this), true);
      document.addEventListener('input', this._onInput   = this._handleInput.bind(this));
      N3UI.toast('Edit mode on — click any element to edit', 'success');
    }

    _exit() {
      const hasDirty = this._dirty.pages.size > 0 || this._dirty.components.size > 0;
      if (hasDirty && !confirm('You have unsaved changes. Exit without saving?')) return;
      if (this._saveBtn) this._saveBtn.style.display = 'none';
      this._deactivate();
      if (this.text)     this.text.disable();
      this._unmarkBlocks();
      if (this.controls) this.controls.disable();
      if (this.scripts)  this.scripts.disable();
      if (this.toolbar)  this.toolbar.hide();
      if (this.panel)    this.panel.close();
      document.body.classList.remove('n3-editing');
      this._syncEditBtn(false);
      this._fabOpen = false;
      if (this._fab) this._fab.classList.remove('n3-expanded');
      document.removeEventListener('click', this._onClickEl, true);
      document.removeEventListener('focus', this._onFocus,   true);
      document.removeEventListener('input', this._onInput);
      N3UI.toast('Edit mode off', 'info', 1500);
    }

    _markBlocks() {
      document.querySelectorAll(SEL.block).forEach(el => {
        if (!N3UI.isEditorEl(el)) el.setAttribute('data-n3-block', '1');
      });
    }

    _unmarkBlocks() {
      document.querySelectorAll('[data-n3-block]').forEach(el => {
        el.removeAttribute('data-n3-block');
        el.classList.remove('n3-hovered', 'n3-selected');
      });
    }

    _activate(el) {
      if (this._activeEl) this._activeEl.classList.remove('n3-selected');
      this._activeEl = el;
      el.classList.add('n3-selected');
      if (window.innerWidth >= 768 && this.panel) this.panel.open(el);
    }

    _deactivate() {
      if (this._activeEl) { this._activeEl.classList.remove('n3-selected'); this._activeEl = null; }
      if (this.panel) this.panel.close();
      if (this.text)  this.text.hideToolbar();
    }

    _snapshot() {
      this.history.push(document.body.innerHTML);
      if (this._editMode) this._showSaveButton();
    }

    _restore(snapshot) {
      if (!snapshot) return;
      document.body.innerHTML = snapshot;
      document.querySelectorAll('[data-n3-ui]').forEach(e => e.remove());
      if (this.toolbar)  this.toolbar.mount();
      if (this.panel)    this.panel.mount();
      this._buildControlPanel();
      if (this._editMode) {
        this._markBlocks();
        if (this.text)     this.text.enable();
        if (this.controls) this.controls.enable();
        if (this.toolbar)  this.toolbar.show();
        document.body.classList.add('n3-editing');
        this._syncEditBtn(true);
      }
    }

    _wireEvents() {
      this.events.on('history:change', s => this.toolbar && this.toolbar.updateHistory(s));
      this.events.on('toolbar:action', action => {
        const map = {
          'undo':            () => this._doUndo(),
          'redo':            () => this._doRedo(),
          'save-html':       () => this.exporter && this.exporter.downloadHTML(),
          'copy-html':       () => this.exporter && this.exporter.copyHTML(),
          'json-diff':       () => this.exporter && this.exporter.downloadDiff(this._initialHTML || (this.exporter ? this.exporter.cleanHTML() : '')),
          'exit-edit':       () => this.toggle(false),
          'cloud-save':      () => this._doCloudSave(),
          'cloud-revisions': () => this.revPanel && this.revPanel.toggle(),
        };
        if (map[action]) map[action]();
      });
      this.events.on('panel:close', () => this._deactivate());
      this.events.on('controls:duplicate', el => this._duplicate(el));
      this.events.on('controls:delete', el => {
        this._snapshot(); el.remove();
        if (this.controls) this.controls.removeOverlay();
        N3UI.toast('Element deleted', 'info');
      });
      this.events.on('controls:move-up', el => {
        const prev = el.previousElementSibling;
        if (prev && !N3UI.isEditorEl(prev)) {
          this._snapshot();
          el.parentNode.insertBefore(el, prev);
          if (this.controls) this.controls.removeOverlay();
          N3UI.toast('Moved up', 'info', 1200);
        }
      });
      this.events.on('controls:move-down', el => {
        const next = el.nextElementSibling;
        if (next && !N3UI.isEditorEl(next)) {
          this._snapshot();
          el.parentNode.insertBefore(next, el);
          if (this.controls) this.controls.removeOverlay();
          N3UI.toast('Moved down', 'info', 1200);
        }
      });
      this.events.on('drag:drop', ({ dragged, el: target, above }) => {
        this._markDirty(dragged);
        this._snapshot();
        if (above) target.parentNode.insertBefore(dragged, target);
        else       target.parentNode.insertBefore(dragged, target.nextSibling);
        if (this.controls) this.controls.removeOverlay();
        N3UI.toast('Reordered', 'info', 1200);
      });
      this.events.on('style:change', () => {
        if (this._activeEl) this._markDirty(this._activeEl);
        clearTimeout(this._styleTimer);
        this._styleTimer = setTimeout(() => this._snapshot(), 400);
      });
    }

    _handleClick(e) {
      if (!this._editMode || N3UI.isEditorEl(e.target)) return;
      const block = e.target.closest('[data-n3-block]');
      if (block) {
        if (block === this._activeEl) this._deactivate();
        else                          this._activate(block);
      } else {
        this._deactivate();
      }
      if (e.detail === 3) {
        const ed = e.target.closest('[data-n3-editable]');
        if (ed) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(ed);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }

    _handleFocus(e) {
      if (!this._editMode || N3UI.isEditorEl(e.target)) return;
      const ed = e.target.closest('[data-n3-editable]');
      const bl = e.target.closest('[data-n3-block]');
      if (ed || bl) this._activate(ed || bl);
      if (ed && this.text) setTimeout(() => this.text.showToolbar(ed), 50);
    }

    _handleInput(e) {
      if (!this._editMode || !e.target.closest('[data-n3-editable]')) return;
      this._markDirty(e.target);
      clearTimeout(this._inputTimer);
      this._inputTimer = setTimeout(() => this._snapshot(), 600);
    }

    _handleKeyDown(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); this.toggle(); return; }
      if (!this._editMode) return;
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); this._doUndo(); }
      if (e.ctrlKey &&  e.shiftKey && e.key === 'Z') { e.preventDefault(); this._doRedo(); }
      if (e.key === 'Escape') this._deactivate();
    }

    async _doCloudSave() {
      if (!this.cloud || !this.exporter) return;
      const html = this.exporter.cleanHTML();
      N3UI.toast('Publishing…', 'info', 60000);
      try {
        await this.cloud.save(html, 'Saved from editor');
        N3UI.toast('Published!', 'success', 3000);
      } catch (e) {
        N3UI.toast('Publish failed: ' + e.message, 'error', 4000);
      }
    }

    _doUndo() {
      const s = this.history.undo();
      if (s) { this._restore(s); N3UI.toast('Undo', 'info', 1200); }
      else N3UI.toast('Nothing to undo', 'info');
    }

    _doRedo() {
      const s = this.history.redo();
      if (s) { this._restore(s); N3UI.toast('Redo', 'info', 1200); }
      else N3UI.toast('Nothing to redo', 'info');
    }

    // ── v2 Save FAB ───────────────────────────────────────────────────────────

    _buildSaveBtn() {
      if (!this._cloudCfg) return; // only when cloud-configured
      const btn = document.createElement('button');
      btn.className = 'n3-save-fab';
      btn.setAttribute('data-n3-ui', '1');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
      btn.addEventListener('click', e => { e.stopPropagation(); this._handleSave(); });
      document.body.appendChild(btn);
      this._saveBtn = btn;
    }

    _showSaveButton() {
      if (!this._saveBtn) return;
      this._saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
      this._saveBtn.style.cssText = '';
      this._saveBtn.style.background = '#22C55E';
      this._saveBtn.style.display = 'flex';
      this._saveBtn.classList.add('n3-save-pulse');
    }

    _markDirty(el) {
      if (!el) return;
      // Walk up to find containing semantic region
      const header = el.closest('header');
      const nav    = el.closest('nav');
      const footer = el.closest('footer');
      if (header) { this._dirty.components.add('header'); return; }
      if (nav)    { this._dirty.components.add('nav');    return; }
      if (footer) { this._dirty.components.add('footer'); return; }
      // Default: page body (current page slug is always 'index' for v2 single-page sites)
      this._dirty.pages.add('index');
    }

    _extractComponentHtml(name) {
      // Try comment-marker delimited extraction first (n3:component:NAME:start/end)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
      let startNode = null;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim() === `n3:component:${name}:start`) {
          startNode = walker.currentNode;
          break;
        }
      }
      if (startNode) {
        let html = '';
        let node = startNode.nextSibling;
        while (node) {
          if (node.nodeType === 8 && node.textContent.trim() === `n3:component:${name}:end`) break;
          if (node.nodeType === 1) html += node.outerHTML;
          node = node.nextSibling;
        }
        if (html) return html;
      }
      // Fallback: grab the tag directly by element type
      const tagMap = { header: 'header', nav: 'nav', footer: 'footer' };
      const el = document.querySelector(tagMap[name]);
      return el ? el.outerHTML : null;
    }

    async _handleSave() {
      if (!this._cloudCfg || !this._saveBtn) return;
      const hasWork = this._dirty.pages.size > 0 || this._dirty.components.size > 0;
      if (!hasWork) return;

      this._saveBtn.classList.remove('n3-save-pulse');
      this._saveBtn.innerHTML = '⏳ Saving…';
      this._saveBtn.style.background = '#666';

      const { api, site, key } = this._cloudCfg;
      const headers = { 'Content-Type': 'application/json' };
      const jwt = document.cookie.match(/n3_token=([^;]+)/)?.[1]
               || sessionStorage.getItem('n3_auth');
      if (jwt) {
        headers['Authorization'] = 'Bearer ' + jwt;
      } else if (key) {
        headers['X-API-Key'] = key;
      }

      const promises = [];

      for (const slug of this._dirty.pages) {
        const main = document.querySelector('main');
        const html = main ? main.innerHTML : document.body.innerHTML;
        promises.push(
          fetch(`${api}/sites/${site}/pages/${slug}`, {
            method: 'PUT', headers, body: JSON.stringify({ html }),
          })
        );
      }

      for (const name of this._dirty.components) {
        const html = this._extractComponentHtml(name);
        if (html) {
          promises.push(
            fetch(`${api}/sites/${site}/components/${name}`, {
              method: 'PUT', headers, body: JSON.stringify({ html }),
            })
          );
        }
      }

      try {
        const results = await Promise.all(promises);
        const allOk = results.every(r => r.ok);
        if (!allOk) throw new Error('One or more saves failed');

        this._dirty.pages.clear();
        this._dirty.components.clear();
        this._saveBtn.innerHTML = '✓ Saved';
        this._saveBtn.style.background = '#16A34A';
        N3UI.toast('Changes saved — reloading…', 'success');
        setTimeout(() => {
          // Force a cache-busted reload so the user sees their saved changes
          const url = new URL(window.location.href);
          url.searchParams.set('_', Date.now());
          window.location.replace(url.toString());
        }, 1500);
      } catch (err) {
        this._saveBtn.innerHTML = 'Failed';
        this._saveBtn.style.background = '#DC2626';
        N3UI.toast('Save failed: ' + err.message, 'error', 4000);
        setTimeout(() => {
          if (this._saveBtn) {
            this._saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
            this._saveBtn.style.background = '#22C55E';
            this._saveBtn.classList.add('n3-save-pulse');
          }
        }, 3000);
      }
    }

    _duplicate(el) {
      this._snapshot();
      const clone = el.cloneNode(true);
      ['data-n3-editable', 'contenteditable', 'spellcheck'].forEach(a => clone.removeAttribute(a));
      el.parentNode.insertBefore(clone, el.nextSibling);
      if (this._editMode) {
        clone.querySelectorAll(SEL.text).forEach(t => {
          t.setAttribute('data-n3-editable', '1');
          t.setAttribute('contenteditable', 'true');
          t.setAttribute('spellcheck', 'false');
        });
        clone.setAttribute('data-n3-block', '1');
      }
      N3UI.toast('Duplicated', 'success', 1500);
    }
  }

  // ─── Shared namespace ─────────────────────────────────────────────────────
  // Expose core utilities so companion modules can import them.
  global._n3wareModules = {
    T, SEL,
    _esc, _fmtDate, _fmtNum, _fmtDur, _svgArc,
    N3UI, N3Events, N3History,
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────
  // Load all companion modules in parallel, then initialise the editor.
  Promise.all(_MODULES.map(_loadModule)).then(function () {
    const editor = new N3Editor();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { editor.init(); });
    } else {
      editor.init();
    }
    global.n3ware = editor.publicAPI();
  });

})(window);
