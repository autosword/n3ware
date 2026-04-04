/**
 * n3ware.js — Visual editor for any webpage
 * Zero dependencies. Single script tag activation.
 * https://github.com/autosword/n3ware
 *
 * Architecture:
 *   N3Events          — inter-module pub/sub event bus
 *   N3UI              — CSS injection + shared UI element factories
 *   N3History         — snapshot-based undo/redo stack
 *   N3Export          — clean HTML, clipboard copy, JSON diff
 *   N3TextEditor      — contentEditable + floating formatting toolbar
 *   N3DragManager     — drag-and-drop block reordering
 *   N3ElementControls — hover overlays (type label, dup, delete, drag handle)
 *   N3StylePanel      — right-sidebar live style editor
 *   N3Toolbar         — top toolbar in edit mode
 *   N3Editor          — main orchestrator; public API surface
 */
(function (global) {
  'use strict';

  // ─── Design tokens ────────────────────────────────────────────────────────
  const T = {
    accent:     '#E31337',
    accentDark: '#B91C2C',
    bgPanel:    '#111111',
    border:     '#2A2A2A',
    text:       '#E5E5E5',
    muted:      '#888888',
  };

  /** Selector lists shared across modules */
  const SEL = {
    text:  'p,h1,h2,h3,h4,h5,h6,span,li,a,blockquote,td,th,label,dt,dd',
    block: 'div,section,article,header,footer,main,aside,nav,figure,p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,table,form,img',
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Events — lightweight pub/sub event bus
  // ═══════════════════════════════════════════════════════════════════════════
  class N3Events {
    constructor() {
      /** @type {Map<string, Set<Function>>} */
      this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} callback
     */
    on(event, callback) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(callback);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
      const set = this._listeners.get(event);
      if (set) set.delete(callback);
    }

    /**
     * Emit an event with optional payload.
     * @param {string} event
     * @param {*} [data]
     */
    emit(event, data) {
      const set = this._listeners.get(event);
      if (set) set.forEach(fn => fn(data));
    }

    /** Remove all listeners for a given event. */
    clear(event) {
      this._listeners.delete(event);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3UI — CSS injection + reusable element factories
  // ═══════════════════════════════════════════════════════════════════════════
  class N3UI {
    /**
     * Inject the full n3ware stylesheet once into <head>.
     * All classes are prefixed n3- to avoid collisions.
     */
    static injectStyles() {
      if (document.getElementById('n3ware-styles')) return;
      const s = document.createElement('style');
      s.id = 'n3ware-styles';
      s.textContent = [
        `.n3-edit-btn{position:fixed;bottom:24px;right:24px;z-index:999999;background:${T.accent};color:#fff;border:none;border-radius:8px;padding:10px 20px;font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 24px rgba(59,130,246,.4);display:flex;align-items:center;gap:8px;transition:all .2s;letter-spacing:.02em}`,
        `.n3-edit-btn:hover{background:${T.accentDark};transform:translateY(-1px)}`,
        `.n3-edit-btn.n3-active{background:#EF4444;box-shadow:0 4px 24px rgba(239,68,68,.4)}`,
        `.n3-toolbar{position:fixed;top:0;left:0;right:0;z-index:999998;background:${T.bgPanel};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 16px;height:48px;gap:8px;font:13px/1 system-ui,sans-serif;color:${T.text};box-shadow:0 2px 16px rgba(0,0,0,.4);transform:translateY(-100%);transition:transform .2s ease}`,
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
        // ── Floating Action Button cluster ──────────────────────────────────
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
        // ── Analytics overlay ────────────────────────────────────────────────
        `.n3-analytics-overlay{position:fixed;bottom:0;left:0;right:0;z-index:999995;background:rgba(15,23,42,.97);border-top:1px solid ${T.border};transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);max-height:50vh;overflow-y:auto;font:13px/1.5 system-ui,sans-serif;color:${T.text};backdrop-filter:blur(8px)}`,
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
        // ── Components panel ────────────────────────────────────────────────────
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
        // ── Mobile / narrow viewport overrides ──────────────────────────────
        `@media(max-width:767px){
          .n3-style-panel{width:100%!important;height:60vh!important;top:auto!important;bottom:0!important;border-left:none!important;border-top:1px solid ${T.border}!important;border-radius:12px 12px 0 0!important;}
          .n3-format-bar{overflow-x:auto;flex-wrap:nowrap;max-width:calc(100vw - 16px);}
          .n3-fab{bottom:16px!important;right:12px!important;}
          .n3-fab-toggle{width:40px!important;height:40px!important;font-size:14px!important;}
          .n3-toolbar{overflow-x:auto;flex-wrap:nowrap;}
          body.n3-editing{padding-top:48px!important;}
        }`,
      ].join('\n');
      document.head.appendChild(s);
    }

    /**
     * Create a button element.
     * @param {string} label  innerHTML
     * @param {string} cls    CSS classes
     * @param {string} [title]
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
     * Show a temporary toast notification.
     * @param {string} msg
     * @param {'info'|'success'|'error'} [type='info']
     * @param {number} [duration=2500]
     */
    static toast(msg, type = 'info', duration = 2500) {
      const icons = { success: '✓', error: '✕', info: 'ℹ' };
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
     * Show a confirm dialog and resolve to true/false.
     * @param {string} title
     * @param {string} msg
     * @returns {Promise<boolean>}
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
     * Returns true if the element is part of the editor chrome.
     * @param {Element} el
     * @returns {boolean}
     */
    static isEditorEl(el) {
      return !!(el && (
        el.closest('.n3-controls')        ||
        el.closest('.n3-format-bar')      ||
        el.closest('.n3-style-panel')     ||
        el.closest('.n3-toolbar')         ||
        el.closest('.n3-fab')              ||
        el.closest('.n3-analytics-overlay') ||
        el.closest('.n3-comp-panel')      ||
        el.closest('.n3-confirm-overlay') ||
        el.closest('.n3-toast')
      ));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3History — snapshot-based undo/redo
  // ═══════════════════════════════════════════════════════════════════════════
  class N3History {
    /**
     * @param {N3Events} events
     * @param {number} [maxDepth=100]
     */
    constructor(events, maxDepth = 100) {
      this._events   = events;
      this._maxDepth = maxDepth;
      /** @type {string[]} */
      this._stack = [];
      this._index = -1;
    }

    /**
     * Push a new HTML snapshot.
     * Truncates any forward history first.
     * @param {string} snapshot
     */
    push(snapshot) {
      if (this._stack[this._index] === snapshot) return;
      this._stack = this._stack.slice(0, this._index + 1);
      this._stack.push(snapshot);
      if (this._stack.length > this._maxDepth) this._stack.shift();
      else this._index++;
      this._events.emit('history:change', this._state());
    }

    /** @returns {boolean} */
    canUndo() { return this._index > 0; }

    /** @returns {boolean} */
    canRedo() { return this._index < this._stack.length - 1; }

    /**
     * Move back one step. Returns snapshot or null.
     * @returns {string|null}
     */
    undo() {
      if (!this.canUndo()) return null;
      this._index--;
      this._events.emit('history:change', this._state());
      return this._stack[this._index];
    }

    /**
     * Move forward one step. Returns snapshot or null.
     * @returns {string|null}
     */
    redo() {
      if (!this.canRedo()) return null;
      this._index++;
      this._events.emit('history:change', this._state());
      return this._stack[this._index];
    }

    /** @returns {string|null} current snapshot without moving */
    current() { return this._stack[this._index] ?? null; }

    /** Reset stack to empty. */
    reset() {
      this._stack = [];
      this._index = -1;
      this._events.emit('history:change', this._state());
    }

    /** @returns {{index:number, total:number}} */
    _state() { return { index: this._index, total: this._stack.length }; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Export — clean HTML generation, clipboard copy, JSON diff download
  // ═══════════════════════════════════════════════════════════════════════════
  class N3Export {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
    }

    /**
     * Clone the full document and strip all editor artifacts.
     * @returns {string} clean HTML string suitable for saving/copying
     */
    cleanHTML() {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-n3-ui]').forEach(e => e.remove());
      clone.querySelectorAll('#n3ware-styles').forEach(e => e.remove());
      clone.querySelectorAll('.n3-controls,.n3-format-bar,.n3-drop-line,.n3-toast').forEach(e => e.remove());
      clone.querySelectorAll('[data-n3-editable]').forEach(e => {
        e.removeAttribute('data-n3-editable');
        e.removeAttribute('contenteditable');
        e.removeAttribute('spellcheck');
      });
      clone.querySelectorAll('[data-n3-block]').forEach(e => e.removeAttribute('data-n3-block'));
      ['n3-hovered','n3-selected','n3-dragging'].forEach(c =>
        clone.querySelectorAll(`.${c}`).forEach(e => e.classList.remove(c))
      );
      clone.querySelector('body').classList.remove('n3-editing');
      return '<!DOCTYPE html>\n' + clone.outerHTML;
    }

    /**
     * Trigger a file download of the clean HTML.
     * @param {string} [filename]
     */
    downloadHTML(filename) {
      const html = this.cleanHTML();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = filename || (document.title || 'page') + '-edited.html';
      a.click();
      N3UI.toast('Downloaded!', 'success');
      this._events.emit('export:download');
    }

    /** Copy clean HTML to clipboard. */
    async copyHTML() {
      try {
        await navigator.clipboard.writeText(this.cleanHTML());
        N3UI.toast('HTML copied to clipboard', 'success');
        this._events.emit('export:copy');
      } catch (_) {
        N3UI.toast('Copy failed — try downloading instead', 'error');
      }
    }

    /**
     * Compute a structural diff between two HTML strings.
     * @param {string} before
     * @param {string} after
     * @returns {Array<{index:number,tag:string,before:string,after:string,styleChanged:boolean}>}
     */
    diff(before, after) {
      const parse = html => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('*');
      const bEls = parse(before), aEls = parse(after);
      const changes = [];
      for (let i = 0, len = Math.min(bEls.length, aEls.length); i < len; i++) {
        if (bEls[i].outerHTML !== aEls[i].outerHTML) {
          changes.push({
            index:        i,
            tag:          aEls[i].tagName.toLowerCase(),
            before:       bEls[i].textContent.trim().slice(0, 80),
            after:        aEls[i].textContent.trim().slice(0, 80),
            styleChanged: bEls[i].getAttribute('style') !== aEls[i].getAttribute('style'),
          });
        }
      }
      return changes;
    }

    /**
     * Download a JSON diff between `initialHTML` and current DOM.
     * @param {string} initialHTML
     */
    downloadDiff(initialHTML) {
      const changes = this.diff(initialHTML, this.cleanHTML());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(changes, null, 2)], { type: 'application/json' }));
      a.download = 'n3ware-diff.json';
      a.click();
      N3UI.toast(`${changes.length} change(s) exported`, 'info');
      this._events.emit('export:diff', changes);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3TextEditor — contentEditable management + floating formatting toolbar
  // ═══════════════════════════════════════════════════════════════════════════
  class N3TextEditor {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
      /** @type {HTMLElement|null} */
      this._bar = null;
      this._onSelChange  = this._updateFormatState.bind(this);
      this._onDocMouseDown = this._handleDocMouseDown.bind(this);
    }

    /** Mark all text-selector elements as contentEditable. */
    enable() {
      document.querySelectorAll(SEL.text).forEach(el => {
        if (N3UI.isEditorEl(el)) return;
        el.setAttribute('data-n3-editable', '1');
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
      });
    }

    /** Remove contentEditable from all elements and hide toolbar. */
    disable() {
      document.querySelectorAll('[data-n3-editable]').forEach(el => {
        el.removeAttribute('data-n3-editable');
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
      });
      this.hideToolbar();
    }

    /**
     * Build and show the floating formatting toolbar near `el`.
     * @param {HTMLElement} el
     */
    showToolbar(el) {
      this.hideToolbar();
      this._bar = this._buildBar(el);
      document.body.appendChild(this._bar);
      this._positionBar(el);
      this._updateFormatState();
      document.addEventListener('selectionchange', this._onSelChange);
      // Hide bar when user clicks outside both the bar and any editable element.
      document.addEventListener('mousedown', this._onDocMouseDown, true);
    }

    /** Remove the formatting toolbar. */
    hideToolbar() {
      if (this._bar) {
        this._bar.remove();
        this._bar = null;
        document.removeEventListener('selectionchange', this._onSelChange);
        document.removeEventListener('mousedown', this._onDocMouseDown, true);
      }
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _handleDocMouseDown(e) {
      if (!this._bar) return;
      // If click is inside the format bar or inside a contentEditable element, keep bar visible.
      if (this._bar.contains(e.target)) return;
      if (e.target.closest('[data-n3-editable]')) return;
      this.hideToolbar();
    }

    /**
     * Execute a document.execCommand formatting command.
     * @param {string} cmd
     * @param {string} [val]
     */
    execFormat(cmd, val) {
      document.execCommand(cmd, false, val || null);
      this._events.emit('text:format', { cmd, val });
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _buildBar(el) {
      const bar = document.createElement('div');
      bar.className = 'n3-format-bar';
      bar.setAttribute('data-n3-ui', '1');

      const exec = (cmd, val) => { el.focus(); this.execFormat(cmd, val); this._updateFormatState(); };
      const fBtn = (html, title, cb, id) => {
        const b = N3UI.btn(html, 'n3-fmt-btn', title);
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', cb);
        if (id) b.id = id;
        return b;
      };
      const sep = () => { const d = document.createElement('div'); d.className = 'n3-fmt-sep'; return d; };
      const fSel = (opts, title, cb, initVal) => {
        const s = document.createElement('select');
        s.className = 'n3-fmt-select'; s.title = title;
        opts.forEach(([label, val]) => { const o = document.createElement('option'); o.value = val; o.textContent = label; s.appendChild(o); });
        if (initVal !== undefined) s.value = initVal;
        s.addEventListener('mousedown', e => e.stopPropagation());
        s.onchange = () => cb(s.value);
        return s;
      };

      // Current tag for heading selector (h1–h6 or p; fall back to '—')
      const currentTag = el.tagName.toLowerCase();
      const headingTags = ['h1','h2','h3','h4','p'];
      const initTag = headingTags.includes(currentTag) ? currentTag : '';

      // Current computed font size (round to nearest option)
      const computedSize = Math.round(parseFloat(getComputedStyle(el).fontSize)) || 16;

      // Reliable block-tag changer: replaces the element in the DOM directly.
      const changeTag = v => {
        if (!v) return;
        const target = el.closest('h1,h2,h3,h4,h5,h6,p') || el;
        const newEl = document.createElement(v);
        const innerContent = target.innerHTML;
        newEl.innerHTML = innerContent;
        Array.from(target.attributes).forEach(a => newEl.setAttribute(a.name, a.value));
        target.replaceWith(newEl);
        newEl.focus();
      };

      bar.append(
        fBtn('<b>B</b>',  'Bold (Ctrl+B)',      () => exec('bold'),       'n3-fmt-bold'),
        fBtn('<i>I</i>',  'Italic (Ctrl+I)',     () => exec('italic'),     'n3-fmt-italic'),
        fBtn('<u>U</u>',  'Underline (Ctrl+U)',  () => exec('underline'),  'n3-fmt-underline'),
        sep(),
        fBtn('⇤', 'Align Left',   () => exec('justifyLeft')),
        fBtn('≡', 'Align Center', () => exec('justifyCenter')),
        fBtn('⇥', 'Align Right',  () => exec('justifyRight')),
        sep(),
        fSel([['—',''],['H1','h1'],['H2','h2'],['H3','h3'],['H4','h4'],['P','p']], 'Heading level',
          v => { if (v) changeTag(v); }, initTag),
        fSel([[12,12],[14,14],[16,16],[18,18],[20,20],[24,24],[28,28],[32,32],[36,36],[48,48],[64,64]].map(([l,v]) => [`${l}px`, v]),
          'Font size', v => { el.style.fontSize = v + 'px'; }, computedSize),
        sep(),
      );

      // Color picker
      const cw = document.createElement('div');
      cw.className = 'n3-color-btn'; cw.title = 'Text color';
      const ci = document.createElement('input'); ci.type = 'color'; ci.value = '#000000';
      const sw = document.createElement('div'); sw.className = 'n3-color-swatch'; sw.textContent = 'A';
      ci.oninput = () => { exec('foreColor', ci.value); sw.style.color = ci.value; };
      cw.append(ci, sw);
      bar.appendChild(cw);
      bar.appendChild(fBtn('🔗', 'Insert Link', () => { const u = prompt('Enter URL:'); if (u) exec('createLink', u); }));
      return bar;
    }

    _positionBar(el) {
      if (!this._bar) return;
      const rect    = el.getBoundingClientRect();
      const barH    = this._bar.offsetHeight || 46;
      const barW    = this._bar.offsetWidth  || 300;
      // Format bar is position:fixed — coords are viewport-relative, no scrollY needed.
      let top = rect.top - barH - 8;
      // If bar would go off-screen above (including below the toolbar), flip it below the element.
      if (top < 56) top = rect.bottom + 8;
      // Clamp to bottom of viewport with a margin.
      if (top + barH > window.innerHeight - 8) top = window.innerHeight - barH - 8;
      // Clamp left so bar stays within viewport.
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - barW - 16));
      this._bar.style.top  = top  + 'px';
      this._bar.style.left = left + 'px';
    }

    _updateFormatState() {
      if (!this._bar) return;
      [['n3-fmt-bold','bold'],['n3-fmt-italic','italic'],['n3-fmt-underline','underline']].forEach(([id, cmd]) => {
        const b = document.getElementById(id);
        if (b) b.classList.toggle('n3-active-fmt', document.queryCommandState(cmd));
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3DragManager — drag-and-drop block reordering with drop-line indicator
  // ═══════════════════════════════════════════════════════════════════════════
  class N3DragManager {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
      /** @type {HTMLElement|null} */
      this._dropLine   = null;
      /** @type {{el:HTMLElement,above:boolean}|null} */
      this._dropTarget = null;
    }

    /**
     * Begin a drag sequence initiated from `el`.
     * @param {MouseEvent} e
     * @param {HTMLElement} el   the element being dragged
     */
    startDrag(e, el) {
      e.preventDefault();
      el.classList.add('n3-dragging');
      this._events.emit('drag:start', el);

      const onMove = mv => this._onMove(mv, el);
      const onUp   = up => {
        this._onEnd(up, el);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    }

    /**
     * Begin a touch-initiated drag sequence.
     * @param {TouchEvent} e
     * @param {HTMLElement} el
     */
    startDragTouch(e, el) {
      e.preventDefault();
      el.classList.add('n3-dragging');
      this._events.emit('drag:start', el);

      const onMove = mv => {
        mv.preventDefault();
        const t = mv.touches[0];
        this._onMove({ clientX: t.clientX, clientY: t.clientY }, el);
      };
      const onEnd = up => {
        const t = up.changedTouches[0];
        this._onEnd({ clientX: t.clientX, clientY: t.clientY }, el);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend',  onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd);
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _onMove(e, dragged) { this._showDropLine(e.clientX, e.clientY, dragged); }

    _onEnd(e, dragged) {
      dragged.classList.remove('n3-dragging');
      if (this._dropTarget && this._dropTarget.el !== dragged)
        this._events.emit('drag:drop', { dragged, ...this._dropTarget });
      this._removeDropLine();
      this._dropTarget = null;
      this._events.emit('drag:end', dragged);
    }

    _showDropLine(x, y, dragged) {
      if (!this._dropLine) {
        this._dropLine = document.createElement('div');
        this._dropLine.className = 'n3-drop-line';
        this._dropLine.setAttribute('data-n3-ui', '1');
        document.body.appendChild(this._dropLine);
      }
      let best = null, bestDist = Infinity;
      const siblings = dragged.parentNode ? Array.from(dragged.parentNode.children) : [];
      siblings.forEach(sib => {
        if (sib === dragged || N3UI.isEditorEl(sib)) return;
        const rect = sib.getBoundingClientRect();
        const dist = Math.abs(y - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = { el: sib, above: y < rect.top + rect.height / 2, rect }; }
      });
      if (best) {
        // Drop line is position:fixed — coords are viewport-relative, no scrollY needed.
        const ly = best.above ? best.rect.top - 2 : best.rect.bottom + 1;
        this._dropLine.style.top   = ly + 'px';
        this._dropLine.style.left  = best.rect.left + 'px';
        this._dropLine.style.width = best.rect.width + 'px';
        this._dropTarget = best;
      }
    }

    _removeDropLine() {
      if (this._dropLine) { this._dropLine.remove(); this._dropLine = null; }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3ElementControls — hover overlay with type label, dup, delete, drag handle
  // ═══════════════════════════════════════════════════════════════════════════
  class N3ElementControls {
    /**
     * @param {N3Events}    events
     * @param {N3DragManager} drag
     */
    constructor(events, drag) {
      this._events  = events;
      this._drag    = drag;
      /** @type {HTMLElement|null} */
      this._overlay = null;
      /** @type {HTMLElement|null} */
      this._current = null;
      this._onHover = this._handleHover.bind(this);
      this._onOut   = this._handleOut.bind(this);
    }

    /** Attach document-level hover listeners. */
    enable() {
      document.addEventListener('mouseover', this._onHover);
      document.addEventListener('mouseout',  this._onOut);
    }

    /** Remove hover listeners and destroy active overlay. */
    disable() {
      document.removeEventListener('mouseover', this._onHover);
      document.removeEventListener('mouseout',  this._onOut);
      this._removeOverlay();
    }

    /** Programmatically destroy the current overlay. */
    removeOverlay() { this._removeOverlay(); }

    // ── Private ──────────────────────────────────────────────────────────────

    _handleHover(e) {
      if (N3UI.isEditorEl(e.target)) return;
      const el = e.target.closest('[data-n3-block]');
      if (!el || el === this._current) return;
      this._removeOverlay();
      this._current = el;
      el.classList.add('n3-hovered');
      this._showOverlay(el);
    }

    _handleOut(e) {
      if (e.relatedTarget && e.relatedTarget.closest('.n3-controls')) return;
      if (this._current) { this._current.classList.remove('n3-hovered'); this._current = null; }
      this._removeOverlay();
    }

    _showOverlay(el) {
      const overlay = document.createElement('div');
      overlay.className = 'n3-controls';
      overlay.setAttribute('data-n3-ui', '1');

      const typeLabel = document.createElement('span');
      typeLabel.className = 'n3-type-label';
      typeLabel.textContent = el.tagName.toLowerCase();

      const dragBtn = N3UI.btn('⠿', 'n3-ctrl-btn n3-drag-handle', 'Drag to reorder');
      dragBtn.addEventListener('mousedown', e => this._drag.startDrag(e, el));
      dragBtn.addEventListener('touchstart', e => this._drag.startDragTouch(e, el), { passive: false });

      const dupBtn = N3UI.btn('+', 'n3-ctrl-btn n3-dup', 'Duplicate');
      dupBtn.addEventListener('click', e => { e.stopPropagation(); this._events.emit('controls:duplicate', el); });

      const delBtn = N3UI.btn('×', 'n3-ctrl-btn n3-delete', 'Delete element');
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await N3UI.confirm('Delete element?', `Remove this <${el.tagName.toLowerCase()}>? Undoable with Ctrl+Z.`);
        if (ok) this._events.emit('controls:delete', el);
      });

      overlay.append(typeLabel, dragBtn, dupBtn, delBtn);
      this._overlay = overlay;
      document.body.appendChild(overlay);
      this._positionOverlay(el);

      const repos = () => this._positionOverlay(el);
      window.addEventListener('scroll', repos, { passive: true });
      window.addEventListener('resize', repos, { passive: true });
      overlay._cleanup = () => { window.removeEventListener('scroll', repos); window.removeEventListener('resize', repos); };
      overlay.addEventListener('mouseenter', () => el.classList.add('n3-hovered'));
      overlay.addEventListener('mouseleave', () => { el.classList.remove('n3-hovered'); this._current = null; this._removeOverlay(); });
    }

    _positionOverlay(el) {
      if (!this._overlay) return;
      const rect     = el.getBoundingClientRect();
      const overlayH = this._overlay.offsetHeight || 30;
      // Preferred: float above the element
      let absTop = rect.top + window.scrollY - overlayH - 4;
      // If that would put the overlay above the n3ware toolbar (48px) + a little margin,
      // fall back to inside the top of the element.
      const minTop = window.scrollY + 52;
      if (absTop < minTop) absTop = rect.top + window.scrollY + 4;
      this._overlay.style.top  = absTop + 'px';
      this._overlay.style.left = (rect.left + window.scrollX) + 'px';
    }

    _removeOverlay() {
      if (this._overlay) {
        if (this._overlay._cleanup) this._overlay._cleanup();
        this._overlay.remove();
        this._overlay = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3StylePanel — right-sidebar live style editor
  // ═══════════════════════════════════════════════════════════════════════════
  class N3StylePanel {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
      /** @type {HTMLElement|null} */
      this._panel  = null;
      /** @type {HTMLElement|null} */
      this._target = null;
    }

    /** Build and append the panel to <body>. */
    mount() {
      this._panel = this._build();
      document.body.appendChild(this._panel);
    }

    /** Remove panel from DOM. */
    unmount() { if (this._panel) { this._panel.remove(); this._panel = null; } }

    /**
     * Open the panel and sync controls to `el`.
     * @param {HTMLElement} el
     */
    open(el) {
      this._target = el;
      if (this._panel) { this._panel.classList.add('n3-panel-open'); this._sync(el); }
    }

    /** Close panel and clear target. */
    close() { this._target = null; if (this._panel) this._panel.classList.remove('n3-panel-open'); }

    /** @returns {boolean} */
    isOpen() { return !!(this._panel && this._panel.classList.contains('n3-panel-open')); }

    // ── Private ──────────────────────────────────────────────────────────────

    _build() {
      const p = document.createElement('div');
      p.className = 'n3-style-panel';
      p.setAttribute('data-n3-ui', '1');
      p.innerHTML = `
        <div class="n3-panel-header">
          <div><div class="n3-panel-title">Style</div></div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="n3-panel-tag" id="n3-sel-tag">—</span>
            <button class="n3-panel-close" id="n3-panel-close">✕</button>
          </div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">Colors</div>
          <div class="n3-field"><div class="n3-field-label">Background</div><input type="color" id="n3-bg-color" class="n3-panel-color"></div>
          <div class="n3-field"><div class="n3-field-label">Text Color</div><input type="color" id="n3-text-color" class="n3-panel-color"></div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">Spacing</div>
          <div class="n3-field"><div class="n3-field-label">Padding <span class="n3-field-value" id="n3-pad-val">0px</span></div><input type="range" class="n3-slider" id="n3-padding" min="0" max="80" value="0"></div>
          <div class="n3-field"><div class="n3-field-label">Margin <span class="n3-field-value" id="n3-mar-val">0px</span></div><input type="range" class="n3-slider" id="n3-margin" min="0" max="80" value="0"></div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">Appearance</div>
          <div class="n3-field"><div class="n3-field-label">Border Radius <span class="n3-field-value" id="n3-rad-val">0px</span></div><input type="range" class="n3-slider" id="n3-radius" min="0" max="50" value="0"></div>
          <div class="n3-field"><div class="n3-field-label">Opacity <span class="n3-field-value" id="n3-opa-val">100%</span></div><input type="range" class="n3-slider" id="n3-opacity" min="0" max="100" value="100"></div>
        </div>
        <div class="n3-panel-section">
          <div class="n3-section-title">CSS Classes</div>
          <div class="n3-field"><input type="text" class="n3-class-input" id="n3-classes" placeholder="container hero flex"></div>
        </div>`;

      p.querySelector('#n3-panel-close').onclick = () => this._events.emit('panel:close');
      this._wireColor(p, '#n3-bg-color',   v => this._apply('backgroundColor', v));
      this._wireColor(p, '#n3-text-color', v => this._apply('color', v));
      this._wireSlider(p, '#n3-padding', '#n3-pad-val', 'padding',      'px');
      this._wireSlider(p, '#n3-margin',  '#n3-mar-val', 'margin',       'px');
      this._wireSlider(p, '#n3-radius',  '#n3-rad-val', 'borderRadius', 'px');
      p.querySelector('#n3-opacity').oninput = e => {
        p.querySelector('#n3-opa-val').textContent = e.target.value + '%';
        if (this._target) { this._target.style.opacity = e.target.value / 100; this._events.emit('style:change'); }
      };
      p.querySelector('#n3-classes').oninput = e => {
        if (!this._target) return;
        const kept = Array.from(this._target.classList).filter(c => c.startsWith('n3-'));
        this._target.className = '';
        kept.forEach(c => this._target.classList.add(c));
        e.target.value.trim().split(/\s+/).filter(Boolean).forEach(c => this._target.classList.add(c));
        this._events.emit('style:change');
      };
      return p;
    }

    _wireColor(p, sel, setter) {
      p.querySelector(sel).oninput = e => { setter(e.target.value); this._events.emit('style:change'); };
    }

    _wireSlider(p, sliderId, valId, prop, unit) {
      p.querySelector(sliderId).oninput = e => {
        p.querySelector(valId).textContent = e.target.value + unit;
        if (this._target) { this._target.style[prop] = e.target.value + unit; this._events.emit('style:change'); }
      };
    }

    _apply(prop, val) { if (this._target) this._target.style[prop] = val; }

    _sync(el) {
      if (!this._panel) return;
      const cs = window.getComputedStyle(el);
      const tag = this._panel.querySelector('#n3-sel-tag');
      if (tag) tag.textContent = el.tagName.toLowerCase();

      const toHex = c => {
        if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return '#ffffff';
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const ctx = cv.getContext('2d'); ctx.fillStyle = c; ctx.fillRect(0,0,1,1);
        const d = ctx.getImageData(0,0,1,1).data;
        return '#' + [d[0],d[1],d[2]].map(x => x.toString(16).padStart(2,'0')).join('');
      };

      const sv = (id, v) => { const e = this._panel.querySelector(id); if (e) e.value = v; };
      const st = (id, v) => { const e = this._panel.querySelector(id); if (e) e.textContent = v; };

      sv('#n3-bg-color',   toHex(cs.backgroundColor));
      sv('#n3-text-color', toHex(cs.color));
      const pad = parseInt(cs.paddingTop)   || 0;
      const mar = parseInt(cs.marginTop)    || 0;
      const rad = parseInt(cs.borderRadius) || 0;
      const opa = Math.round((parseFloat(cs.opacity) || 1) * 100);
      sv('#n3-padding', pad); st('#n3-pad-val', pad + 'px');
      sv('#n3-margin',  mar); st('#n3-mar-val', mar + 'px');
      sv('#n3-radius',  rad); st('#n3-rad-val', rad + 'px');
      sv('#n3-opacity', opa); st('#n3-opa-val', opa + '%');
      const ci = this._panel.querySelector('#n3-classes');
      if (ci) ci.value = Array.from(el.classList).filter(c => !c.startsWith('n3-')).join(' ');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Toolbar — top toolbar in edit mode
  // ═══════════════════════════════════════════════════════════════════════════
  class N3Toolbar {
    /**
     * @param {N3Events} events
     * @param {{cloud:boolean}} [opts]
     */
    constructor(events, opts) {
      this._events = events;
      this._cloud  = !!(opts && opts.cloud);
      /** @type {HTMLElement|null} */
      this._el = null;
      /** @type {string|null} original body paddingTop before toolbar shown */
      this._origBodyPad = null;
    }

    /** Build and append toolbar to <body>. */
    mount() {
      this._el = document.createElement('div');
      this._el.className = 'n3-toolbar';
      this._el.setAttribute('data-n3-ui', '1');
      const saveBtn = this._cloud
        ? `<button class="n3-toolbar-btn n3-cloud-btn" data-action="cloud-save" title="Publish to cloud">☁ Publish</button>
           <button class="n3-toolbar-btn" data-action="cloud-revisions" title="Revision history">↺ History</button>
           <button class="n3-toolbar-btn" data-action="save-html" title="Download HTML backup">⬇ Download</button>`
        : `<button class="n3-toolbar-btn" data-action="save-html">⬇ Download</button>`;
      this._el.innerHTML = `
        <span class="n3-toolbar-logo">n3ware</span>
        <div class="n3-toolbar-sep"></div>
        <button class="n3-toolbar-btn" data-action="undo" title="Undo (Ctrl+Z)">↩ Undo</button>
        <button class="n3-toolbar-btn" data-action="redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
        <span class="n3-history-count">1/1</span>
        <div class="n3-toolbar-sep"></div>
        ${saveBtn}
        <button class="n3-toolbar-btn" data-action="copy-html">⎘ Copy HTML</button>
        <button class="n3-toolbar-btn" data-action="json-diff">{ } Diff</button>
        <div class="n3-toolbar-spacer"></div>
        <button class="n3-toolbar-btn n3-danger" data-action="exit-edit">✕ Exit Editor</button>`;
      this._el.addEventListener('click', e => {
        const b = e.target.closest('[data-action]');
        if (b) this._events.emit('toolbar:action', b.dataset.action);
      });
      document.body.appendChild(this._el);
    }

    /** Remove toolbar from DOM. */
    unmount() { if (this._el) { this._el.remove(); this._el = null; } }

    /** Slide toolbar into view and push body content down by 48 px. */
    show() {
      if (this._el) this._el.classList.add('n3-visible');
      if (this._origBodyPad === null) {
        this._origBodyPad = document.body.style.paddingTop;
        const cur = parseInt(getComputedStyle(document.body).paddingTop) || 0;
        // Save scroll position before padding change to prevent jump.
        const scrollY = window.scrollY;
        document.body.style.paddingTop = (cur + 48) + 'px';
        window.scrollTo({ top: scrollY + 48, behavior: 'instant' });
      }
    }

    /** Slide toolbar out of view and restore original body padding. */
    hide() {
      if (this._el) this._el.classList.remove('n3-visible');
      if (this._origBodyPad !== null) {
        const scrollY = window.scrollY;
        document.body.style.paddingTop = this._origBodyPad;
        // Restore scroll, compensating for the 48px padding we removed.
        window.scrollTo({ top: Math.max(0, scrollY - 48), behavior: 'instant' });
        this._origBodyPad = null;
      }
    }

    /**
     * Update the undo/redo counter badge.
     * @param {{index:number, total:number}} state
     */
    updateHistory(state) {
      const el = this._el && this._el.querySelector('.n3-history-count');
      if (el) el.textContent = `${state.index + 1}/${state.total}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Cloud — cloud save / revision integration
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // N3RevPanel — revision history side panel
  // ═══════════════════════════════════════════════════════════════════════════
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
      this._el = document.createElement('div');
      this._el.className = 'n3-rev-panel';
      this._el.setAttribute('data-n3-ui', '1');
      this._el.innerHTML = `
        <div class="n3-rev-header">
          <span>Revision History</span>
          <button class="n3-rev-close" title="Close">✕</button>
        </div>
        <div class="n3-rev-list"><p class="n3-rev-empty">Loading…</p></div>`;
      this._el.querySelector('.n3-rev-close').addEventListener('click', () => this.close());
      document.body.appendChild(this._el);
    }

    unmount() { if (this._el) { this._el.remove(); this._el = null; } }

    /** Open the panel and load revisions. */
    async open() {
      if (!this._el) return;
      this._el.classList.add('n3-rev-visible');
      this._open = true;
      await this._load();
    }

    close() {
      if (this._el) this._el.classList.remove('n3-rev-visible');
      this._open = false;
    }

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

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
  function _fmtDate(iso) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle:'short', timeStyle:'short' }); }
    catch { return iso || ''; }
  }
  function _fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }
  function _fmtDur(s) { if (!s) return '—'; if (s < 60) return Math.round(s) + 's'; return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's'; }
  function _svgArc(cx, cy, r, startDeg, endDeg, color) {
    const toRad = d => (d - 90) * Math.PI / 180;
    const inner = r * 0.56;
    const x1 = cx + r     * Math.cos(toRad(startDeg));
    const y1 = cy + r     * Math.sin(toRad(startDeg));
    const x2 = cx + r     * Math.cos(toRad(endDeg));
    const y2 = cy + r     * Math.sin(toRad(endDeg));
    const ix1= cx + inner * Math.cos(toRad(endDeg));
    const iy1= cy + inner * Math.sin(toRad(endDeg));
    const ix2= cx + inner * Math.cos(toRad(startDeg));
    const iy2= cy + inner * Math.sin(toRad(startDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `<path d="M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${ix1} ${iy1} A${inner} ${inner} 0 ${large} 0 ${ix2} ${iy2} Z" fill="${color}" opacity="0.9"/>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Components — drag-and-drop component library panel
  // ═══════════════════════════════════════════════════════════════════════════
  class N3Components {
    /**
     * @param {N3Events} events
     * @param {{ api: string, site: string, key: string }|null} cloudCfg
     */
    constructor(events, cloudCfg) {
      this._events       = events;
      this._apiBase      = cloudCfg ? cloudCfg.api : '';
      this._el           = null;
      this._open         = false;
      this._components   = [];
      this._loaded       = false;
      this._filter       = '';
      this._category     = 'all';
      this._dragging     = null;   // html string while dragging
      this._dropTarget   = null;   // highlighted block element
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

    toggle() { this._open ? this.close() : this.open(); }

    open() {
      if (!this._el) return;
      this._el.classList.add('n3-comp-open');
      this._open = true;
      if (!this._loaded) this._load();
    }

    close() {
      if (!this._el) return;
      this._el.classList.remove('n3-comp-open');
      this._open = false;
    }

    /** @returns {boolean} */
    isOpen() { return this._open; }

    // ── Private ────────────────────────────────────────────────────────────────

    _skeleton() {
      return [
        `<div class="n3-comp-hdr">`,
        `  <div class="n3-comp-title">🧩 Components</div>`,
        `  <button class="n3-comp-close" title="Close">✕</button>`,
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
        const res = await fetch(`${this._apiBase}/api/components`);
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
            <span class="n3-comp-thumb">${c.thumbnail || '🧩'}</span>
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
          // Insert after currently selected block, or at end of body
          const selected = document.querySelector('.n3-selected');
          this._insert(comp.html, selected);
          N3UI.toast(`Added: ${comp.name}`, 'success', 2000);
        });
      });
    }

    /**
     * Parse and insert the component HTML at/after a target block.
     * @param {string} html
     * @param {Element|null} target  — insert after this; null = append to body
     */
    _insert(html, target) {
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
        target.parentNode.insertBefore(node, target.nextSibling);
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
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Analytics — page-level analytics overlay
  // ═══════════════════════════════════════════════════════════════════════════
  class N3Analytics {
    /**
     * @param {{ api: string, site: string, key: string }|null} cloudCfg
     */
    constructor(cloudCfg) {
      this._cfg      = cloudCfg;
      this._el       = null;
      this._open     = false;
      this._tab      = 'page';
      this._period   = '7d';
      this._cache    = {};
      this._cacheTtl = 5 * 60 * 1000;
    }

    /** Append the overlay to the document body. */
    mount() {
      this._el = document.createElement('div');
      this._el.className = 'n3-analytics-overlay';
      this._el.setAttribute('data-n3-ui', '1');
      const skelHtml = this._skeleton();
      this._el.innerHTML = skelHtml;
      this._el.querySelector('.n3-an-close').addEventListener('click', () => this.close());
      this._el.querySelector('.n3-an-tabs').addEventListener('click', e => {
        const tab = e.target.closest('[data-tab]');
        if (tab) this._switchTab(tab.dataset.tab);
      });
      this._el.querySelector('.n3-an-periods').addEventListener('click', e => {
        const btn = e.target.closest('[data-period]');
        if (btn) this._setPeriod(btn.dataset.period);
      });
      document.body.appendChild(this._el);
    }

    toggle() { this._open ? this.close() : this.open(); }

    open() {
      if (!this._el) return;
      this._el.classList.add('n3-open');
      this._open = true;
      this._load();
    }

    close() {
      if (!this._el) return;
      this._el.classList.remove('n3-open');
      this._open = false;
    }

    /** @returns {boolean} */
    isOpen() { return this._open; }

    // ── Private ───────────────────────────────────────────────────────────────

    _skeleton() {
      return `<div class="n3-an-header">
        <div class="n3-an-tabs">
          <button class="n3-an-tab n3-an-active" data-tab="page">This Page</button>
          <button class="n3-an-tab" data-tab="all">All Pages</button>
        </div>
        <div class="n3-an-periods">
          <button class="n3-an-period n3-an-active" data-period="7d">7d</button>
          <button class="n3-an-period" data-period="30d">30d</button>
          <button class="n3-an-period" data-period="90d">90d</button>
        </div>
        <button class="n3-an-close" title="Close">✕</button>
      </div>
      <div class="n3-an-body"><p class="n3-an-loading">Loading analytics…</p></div>`;
    }

    _switchTab(tab) {
      this._tab = tab;
      this._el.querySelectorAll('.n3-an-tab').forEach(b => b.classList.toggle('n3-an-active', b.dataset.tab === tab));
      this._load();
    }

    _setPeriod(p) {
      this._period = p;
      this._el.querySelectorAll('.n3-an-period').forEach(b => b.classList.toggle('n3-an-active', b.dataset.period === p));
      this._load();
    }

    async _load() {
      const key    = `${this._tab}-${this._period}`;
      const cached = this._cache[key];
      if (cached && Date.now() - cached.ts < this._cacheTtl) { this._render(cached.data); return; }
      this._el.querySelector('.n3-an-body').innerHTML = '<p class="n3-an-loading">Loading…</p>';
      try {
        const data = await this._fetch();
        this._cache[key] = { data, ts: Date.now() };
        this._render(data);
      } catch (e) {
        this._el.querySelector('.n3-an-body').innerHTML = `<p class="n3-an-error">Error: ${_esc(e.message)}</p>`;
      }
    }

    async _fetch() {
      if (!this._cfg) return this._empty();
      const { api, site, key } = this._cfg;
      const h = key ? { 'X-API-Key': key } : {};
      const periodQ = `period=${this._period}`;

      if (this._tab === 'page') {
        const pagePath = window.location.pathname;
        const res = await fetch(`${api}/sites/${site}/ga/page?path=${encodeURIComponent(pagePath)}&${periodQ}`, { headers: h });
        if (res.status === 404) return this._fallback();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      } else {
        const res = await fetch(`${api}/sites/${site}/ga/stats?${periodQ}`, { headers: h });
        if (res.status === 404) return this._fallback();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }
    }

    async _fallback() {
      if (!this._cfg) return this._empty();
      const { api, site, key } = this._cfg;
      const h = key ? { 'X-API-Key': key } : {};
      const [stats, daily] = await Promise.all([
        fetch(`${api}/analytics/${site}?period=${this._period}`, { headers: h }).then(r => r.json()).catch(() => ({})),
        fetch(`${api}/analytics/${site}/daily?days=14`,          { headers: h }).then(r => r.json()).catch(() => ({})),
      ]);
      return { views: stats.views || 0, uniqueVisitors: stats.uniqueVisitors || 0, avgDuration: null, bounceRate: null, daily: (daily.daily || []).slice(-14), sources: [], devices: {}, topPages: stats.topPages || [], realtime: null, gaConnected: false };
    }

    _empty() { return { views: 0, uniqueVisitors: 0, avgDuration: null, bounceRate: null, daily: [], sources: [], devices: {}, topPages: [], realtime: null, gaConnected: false }; }

    _render(data) {
      const body = this._el.querySelector('.n3-an-body');

      // Stat cards
      const statsHtml = `<div class="n3-an-stats">
        <div class="n3-an-stat"><span class="n3-an-stat-val">${_fmtNum(data.views)}</span><span class="n3-an-stat-label">Views</span></div>
        <div class="n3-an-stat"><span class="n3-an-stat-val">${_fmtNum(data.uniqueVisitors)}</span><span class="n3-an-stat-label">Visitors</span></div>
        ${data.avgDuration != null ? `<div class="n3-an-stat"><span class="n3-an-stat-val">${_fmtDur(data.avgDuration)}</span><span class="n3-an-stat-label">Avg Time</span></div>` : ''}
        ${data.bounceRate  != null ? `<div class="n3-an-stat"><span class="n3-an-stat-val">${Math.round(data.bounceRate)}%</span><span class="n3-an-stat-label">Bounce</span></div>` : ''}
        ${data.realtime    != null ? `<div class="n3-an-stat"><span class="n3-an-stat-val"><span class="n3-an-pulse"></span>${data.realtime}</span><span class="n3-an-stat-label">Live Now</span></div>` : ''}
      </div>`;

      // SVG bar chart (14 days)
      let chartHtml = '';
      if (data.daily && data.daily.length) {
        const days = data.daily.slice(-14);
        const max  = Math.max(...days.map(d => d.views), 1);
        const W    = days.length * 14;
        const bars = days.map((d, i) => {
          const h = Math.max(Math.round((d.views / max) * 80), 2);
          return `<rect x="${i * 14 + 1}" y="${100 - h}" width="10" height="${h}" fill="${T.accent}" rx="2" opacity=".9"><title>${d.date}: ${d.views} views</title></rect>`;
        }).join('');
        chartHtml = `<div class="n3-an-chart-wrap"><p class="n3-an-chart-title">Daily Views (${days.length}d)</p><svg class="n3-an-chart" viewBox="0 0 ${W} 100" preserveAspectRatio="none" height="56">${bars}</svg></div>`;
      }

      // Traffic sources donut
      let sourcesHtml = '';
      if (data.sources && data.sources.length) {
        const total  = data.sources.reduce((s, x) => s + (x.sessions || 0), 0) || 1;
        const colors = [T.accent, '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];
        let   offset = 0;
        const slices = data.sources.slice(0, 5).map((src, i) => {
          const deg   = (src.sessions || 0) / total * 360;
          const slice = _svgArc(32, 32, 28, offset, offset + deg, colors[i % colors.length]);
          offset += deg;
          return `<g>${slice}<title>${_esc(src.source || src.medium)}: ${src.sessions}</title></g>`;
        }).join('');
        const legend = data.sources.slice(0, 5).map((src, i) =>
          `<div class="n3-an-legend-item"><span class="n3-an-legend-dot" style="background:${colors[i % colors.length]}"></span><span>${_esc(src.source || src.medium || 'Other')}</span><span class="n3-an-legend-val">${_fmtNum(src.sessions || 0)}</span></div>`
        ).join('');
        sourcesHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Traffic Sources</p><div class="n3-an-sources"><svg class="n3-an-donut" viewBox="0 0 64 64" width="72" height="72">${slices}</svg><div class="n3-an-legend">${legend}</div></div></div>`;
      }

      // Device breakdown
      let devHtml = '';
      if (data.devices && (data.devices.mobile || data.devices.desktop)) {
        const { mobile = 0, desktop = 0, tablet = 0 } = data.devices;
        const tot = mobile + desktop + tablet || 1;
        const mP = Math.round(mobile  / tot * 100);
        const dP = Math.round(desktop / tot * 100);
        const tP = 100 - mP - dP;
        devHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Devices</p>
          <div class="n3-an-device-bar">
            ${mP ? `<div class="n3-an-device-seg" style="width:${mP}%;background:${T.accent}" title="Mobile ${mP}%"></div>` : ''}
            ${dP ? `<div class="n3-an-device-seg" style="width:${dP}%;background:#10B981"   title="Desktop ${dP}%"></div>` : ''}
            ${tP ? `<div class="n3-an-device-seg" style="width:${tP}%;background:#F59E0B"   title="Tablet ${tP}%"></div>` : ''}
          </div>
          <div class="n3-an-device-labels">
            ${mP ? `<span style="color:${T.accent}">📱 ${mP}%</span>` : ''}
            ${dP ? `<span style="color:#10B981">🖥 ${dP}%</span>` : ''}
            ${tP ? `<span style="color:#F59E0B">⬜ ${tP}%</span>` : ''}
          </div></div>`;
      }

      // Top pages
      let topHtml = '';
      if (data.topPages && data.topPages.length) {
        const items = data.topPages.slice(0, 5).map(p =>
          `<div class="n3-an-top-item"><span class="n3-an-top-path">${_esc(p.path)}</span><span class="n3-an-top-count">${_fmtNum(p.views || p.count || 0)}</span></div>`
        ).join('');
        topHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Top Pages</p>${items}</div>`;
      }

      // GA4 connect prompt
      const connectHtml = !data.gaConnected && this._cfg
        ? `<div class="n3-an-connect-prompt"><span>📊</span><span>Connect Google Analytics for richer insights — available in dashboard settings</span></div>` : '';

      const renderedHtml = statsHtml + chartHtml + sourcesHtml + devHtml + topHtml + connectHtml;
      body.innerHTML = renderedHtml;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // N3Editor — main orchestrator + public-facing API
  // ═══════════════════════════════════════════════════════════════════════════
  class N3Editor {
    constructor() {
      this._editMode    = false;
      this._activeEl    = null;
      this._initialHTML = null;

      // Detect cloud config from script tag data attributes
      const scriptTag = document.currentScript ||
        (document.querySelectorAll('script[data-n3-site]').length
          ? [...document.querySelectorAll('script[data-n3-site]')].pop() : null);
      const cloudApi  = scriptTag && scriptTag.dataset.n3Api;
      const cloudSite = scriptTag && scriptTag.dataset.n3Site;
      const cloudKey  = scriptTag && scriptTag.dataset.n3Key;
      this._cloudCfg  = (cloudApi && cloudSite) ? { api: cloudApi, site: cloudSite, key: cloudKey || '' } : null;

      // Module instantiation
      this.events   = new N3Events();
      this.history  = new N3History(this.events);
      this.exporter = new N3Export(this.events);
      this.text     = new N3TextEditor(this.events);
      this.drag     = new N3DragManager(this.events);
      this.controls = new N3ElementControls(this.events, this.drag);
      this.panel    = new N3StylePanel(this.events);
      this.toolbar  = new N3Toolbar(this.events, { cloud: !!this._cloudCfg });
      this.cloud    = this._cloudCfg
        ? new N3Cloud(this._cloudCfg.api, this._cloudCfg.site, this._cloudCfg.key)
        : null;
      this.revPanel  = this.cloud ? new N3RevPanel(this.events, this.cloud) : null;
      this.analytics  = new N3Analytics(this._cloudCfg);
      this.components = new N3Components(this.events, this._cloudCfg);
      this._fab       = null;
      this._fabOpen   = false;

      this._onKeyDown = this._handleKeyDown.bind(this);
    }

    /** Initialize all editor chrome. Call once after DOM is ready. */
    init() {
      N3UI.injectStyles();
      this.toolbar.mount();
      this.panel.mount();
      if (this.revPanel) this.revPanel.mount();
      this.analytics.mount();
      this.components.mount();
      this._buildControlPanel();
      this._wireEvents();
      document.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * Toggle, force-enable, or force-disable edit mode.
     * @param {boolean} [force]
     */
    toggle(force) {
      const next = (force !== undefined) ? force : !this._editMode;
      if (next === this._editMode) return;
      this._editMode = next;
      if (next) {
        this._initialHTML = this.exporter.cleanHTML();
        this.history.reset();
        this.history.push(document.body.innerHTML);
        this._enter();
      } else {
        this._exit();
      }
      this.events.emit('editor:modeChange', next);
    }

    /** @returns {boolean} */
    isEditing() { return this._editMode; }

    /**
     * Returns the public API object attached to window.n3ware.
     * @returns {object}
     */
    publicAPI() {
      return {
        toggle:   ()       => this.toggle(),
        enable:   ()       => this.toggle(true),
        disable:  ()       => this.toggle(false),
        export:   ()       => this.exporter.downloadHTML(),
        copy:     ()       => this.exporter.copyHTML(),
        undo:     ()       => this._doUndo(),
        redo:     ()       => this._doRedo(),
        on:       (ev, cb) => this.events.on(ev, cb),
        off:      (ev, cb) => this.events.off(ev, cb),
        /** Exposed module references for testing / advanced usage. */
        _modules: {
          events: this.events, history: this.history, exporter: this.exporter,
          text: this.text, drag: this.drag, controls: this.controls,
          panel: this.panel, toolbar: this.toolbar, cloud: this.cloud,
          analytics: this.analytics, components: this.components,
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

      // Action buttons (hidden until expanded)
      const actions = document.createElement('div');
      actions.className = 'n3-fab-actions';

      // Analytics button
      const analyticsBtn = document.createElement('button');
      analyticsBtn.className = 'n3-fab-btn';
      analyticsBtn.innerHTML = CHART;
      analyticsBtn.title = 'Analytics';
      analyticsBtn.addEventListener('click', e => { e.stopPropagation(); this.analytics.toggle(); analyticsBtn.classList.toggle('n3-active', this.analytics.isOpen()); });

      // Components button
      const compBtn = document.createElement('button');
      compBtn.className = 'n3-fab-btn';
      compBtn.innerHTML = GRID;
      compBtn.title = 'Component Library';
      compBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.components.toggle();
        compBtn.classList.toggle('n3-active', this.components.isOpen());
      });

      // Edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'n3-fab-btn';
      editBtn.innerHTML = PENCIL;
      editBtn.title = 'Toggle Edit Mode (Ctrl+Shift+E)';
      editBtn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });

      actions.appendChild(analyticsBtn);
      actions.appendChild(compBtn);
      actions.appendChild(editBtn);
      this._editFabBtn      = editBtn;
      this._analyticsFabBtn = analyticsBtn;
      this._compFabBtn      = compBtn;

      // Main toggle ("n") button
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

    _enter() {
      this.text.enable();
      this._markBlocks();
      this.controls.enable();
      this.toolbar.show();
      document.body.classList.add('n3-editing');
      this._syncEditBtn(true);
      document.addEventListener('click', this._onClickEl = this._handleClick.bind(this), true);
      document.addEventListener('focus', this._onFocus   = this._handleFocus.bind(this), true);
      document.addEventListener('input', this._onInput   = this._handleInput.bind(this));
      N3UI.toast('Edit mode on — click any element to edit', 'success');
    }

    _exit() {
      this._deactivate();
      this.text.disable();
      this._unmarkBlocks();
      this.controls.disable();
      this.toolbar.hide();
      this.panel.close();
      document.body.classList.remove('n3-editing');
      this._syncEditBtn(false);
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
      this.panel.open(el);
    }

    _deactivate() {
      if (this._activeEl) { this._activeEl.classList.remove('n3-selected'); this._activeEl = null; }
      this.panel.close();
      this.text.hideToolbar();
    }

    _snapshot() { this.history.push(document.body.innerHTML); }

    _restore(snapshot) {
      if (!snapshot) return;
      document.body.innerHTML = snapshot;
      document.querySelectorAll('[data-n3-ui]').forEach(e => e.remove());
      this.toolbar.mount();
      this.panel.mount();
      this._buildControlPanel();
      if (this._editMode) {
        this._markBlocks();
        this.text.enable();
        this.controls.enable();
        this.toolbar.show();
        document.body.classList.add('n3-editing');
        this._syncEditBtn(true);
      }
    }

    _wireEvents() {
      this.events.on('history:change', s => this.toolbar.updateHistory(s));
      this.events.on('toolbar:action', action => {
        const map = {
          'undo':             () => this._doUndo(),
          'redo':             () => this._doRedo(),
          'save-html':        () => this.exporter.downloadHTML(),
          'copy-html':        () => this.exporter.copyHTML(),
          'json-diff':        () => this.exporter.downloadDiff(this._initialHTML || this.exporter.cleanHTML()),
          'exit-edit':        () => this.toggle(false),
          'cloud-save':       () => this._doCloudSave(),
          'cloud-revisions':  () => this.revPanel && this.revPanel.toggle(),
        };
        if (map[action]) map[action]();
      });
      this.events.on('panel:close', () => this._deactivate());
      this.events.on('controls:duplicate', el => this._duplicate(el));
      this.events.on('controls:delete', el => {
        this._snapshot(); el.remove(); this.controls.removeOverlay();
        N3UI.toast('Element deleted', 'info');
      });
      this.events.on('drag:drop', ({ dragged, el: target, above }) => {
        this._snapshot();
        if (above) target.parentNode.insertBefore(dragged, target);
        else       target.parentNode.insertBefore(dragged, target.nextSibling);
        this.controls.removeOverlay();
        N3UI.toast('Reordered', 'info', 1200);
      });
      this.events.on('style:change', () => {
        clearTimeout(this._styleTimer);
        this._styleTimer = setTimeout(() => this._snapshot(), 400);
      });
    }

    _handleClick(e) {
      if (!this._editMode || N3UI.isEditorEl(e.target)) return;
      const block = e.target.closest('[data-n3-block]');
      if (block) {
        // Clicking the already-active block a second time dismisses the panel.
        if (block === this._activeEl) {
          this._deactivate();
        } else {
          this._activate(block);
        }
      } else {
        // Clicked outside any editable block — deactivate selection and hide format bar.
        this._deactivate();
      }
      // Triple-click: select the full text content of the editable element
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
      if (ed) setTimeout(() => this.text.showToolbar(ed), 50);
    }

    _handleInput(e) {
      if (!this._editMode || !e.target.closest('[data-n3-editable]')) return;
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
      if (!this.cloud) return;
      const html = this.exporter.cleanHTML();
      N3UI.toast('Publishing…', 'info', 60000);
      try {
        await this.cloud.save(html, 'Saved from editor');
        // Dismiss the long-lived "Publishing…" toast by showing success
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

    _duplicate(el) {
      this._snapshot();
      const clone = el.cloneNode(true);
      ['data-n3-editable','contenteditable','spellcheck'].forEach(a => clone.removeAttribute(a));
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
  // ─── Bootstrap ─────────────────────────────────────────────────────────────
  const _editor = new N3Editor();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _editor.init());
  } else {
    _editor.init();
  }
  global.n3ware = _editor.publicAPI();

})(window);
