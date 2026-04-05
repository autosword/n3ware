/**
 * n3ware-theme-css.js — Theme panel CSS injection.
 * Attaches: window._n3wareTheme.injectStyles
 */
(function () { 'use strict';
  window._n3wareTheme = window._n3wareTheme || {};

  window._n3wareTheme.injectStyles = function injectStyles() {
    if (document.getElementById('n3-theme-panel-css')) return;
    const style = document.createElement('style');
    style.id = 'n3-theme-panel-css';
    style.textContent = [
      '.n3-theme-panel{position:fixed;top:0;right:0;bottom:0;width:280px;z-index:99999;',
      'background:#111111;border-left:1px solid #2A2A2A;display:flex;flex-direction:column;',
      'transform:translateX(110%);transition:transform 0.3s ease;',
      'font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#E5E5E5;',
      'box-shadow:-4px 0 24px rgba(0,0,0,.5);}',

      '.n3-theme-open{transform:translateX(0) !important;}',

      '.n3-theme-panel h3{font-size:11px;font-weight:600;letter-spacing:.08em;',
      'text-transform:uppercase;color:#888888;margin:0 0 10px;}',

      '.n3-theme-header{display:flex;align-items:center;justify-content:space-between;',
      'padding:14px 16px;border-bottom:1px solid #2A2A2A;flex-shrink:0;}',

      '.n3-theme-title{font-size:13px;font-weight:600;color:#E5E5E5;margin:0;}',

      '.n3-theme-close-btn{background:none;border:none;color:#888888;cursor:pointer;',
      'padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;line-height:1;}',
      '.n3-theme-close-btn:hover{background:#2A2A2A;color:#E5E5E5;}',

      '.n3-theme-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px;}',
      '.n3-theme-body::-webkit-scrollbar{width:4px;}',
      '.n3-theme-body::-webkit-scrollbar-track{background:transparent;}',
      '.n3-theme-body::-webkit-scrollbar-thumb{background:#2A2A2A;border-radius:2px;}',

      '.n3-theme-section{display:flex;flex-direction:column;gap:10px;}',

      '.n3-theme-color-row{display:flex;align-items:center;gap:8px;}',
      '.n3-theme-color-label{flex:1;font-size:12px;color:#888888;}',
      '.n3-theme-color-swatch{width:28px;height:28px;border-radius:6px;border:1px solid #2A2A2A;',
      'cursor:pointer;padding:2px;background:#111111;flex-shrink:0;}',
      '.n3-theme-color-input{background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;',
      'color:#E5E5E5;font-size:12px;padding:4px 8px;width:80px;font-family:monospace;}',
      '.n3-theme-color-input:focus{outline:none;border-color:#E31337;}',

      '.n3-theme-select-row{display:flex;align-items:center;gap:8px;}',
      '.n3-theme-select-label{flex:1;font-size:12px;color:#888888;}',
      '.n3-theme-select{background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;',
      'color:#E5E5E5;font-size:12px;padding:4px 8px;flex:2;max-width:150px;}',
      '.n3-theme-select:focus{outline:none;border-color:#E31337;}',

      '.n3-theme-slider-row{display:grid;grid-template-columns:28px 1fr 40px;align-items:center;gap:8px;}',
      '.n3-theme-slider-tag{font-size:11px;font-weight:600;color:#888888;text-align:right;}',
      '.n3-theme-slider{-webkit-appearance:none;appearance:none;width:100%;height:4px;',
      'border-radius:2px;background:#2A2A2A;cursor:pointer;}',
      '.n3-theme-slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;',
      'border-radius:50%;background:#E31337;cursor:pointer;}',
      '.n3-theme-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;',
      'background:#E31337;cursor:pointer;border:none;}',
      '.n3-theme-slider-val{font-size:11px;color:#888888;text-align:right;}',

      '.n3-theme-upload-slot{border:1px dashed #2A2A2A;border-radius:8px;padding:12px;',
      'text-align:center;cursor:pointer;transition:border-color .15s;position:relative;overflow:hidden;}',
      '.n3-theme-upload-slot:hover{border-color:#E31337;}',
      '.n3-theme-upload-slot input[type="file"]{position:absolute;inset:0;opacity:0;cursor:pointer;}',
      '.n3-theme-upload-preview{max-height:48px;max-width:100%;border-radius:4px;',
      'margin-bottom:4px;display:none;}',
      '.n3-theme-upload-label{font-size:11px;color:#888888;}',

      '.n3-theme-footer{padding:12px 16px;border-top:1px solid #2A2A2A;',
      'display:flex;gap:8px;flex-shrink:0;}',
      '.n3-theme-save-btn{flex:1;background:#E31337;color:#fff;border:none;border-radius:6px;',
      'padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;}',
      '.n3-theme-save-btn:hover{background:#B91C2C;}',
      '.n3-theme-save-btn:disabled{opacity:.5;cursor:default;}',
      '.n3-theme-reset-btn{background:#1A1A1A;color:#888888;border:1px solid #2A2A2A;',
      'border-radius:6px;padding:8px 12px;font-size:13px;cursor:pointer;',
      'transition:background .15s,color .15s;}',
      '.n3-theme-reset-btn:hover{background:#2A2A2A;color:#E5E5E5;}',
    ].join('');
    document.head.appendChild(style);
  };

})();
