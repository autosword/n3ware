/**
 * n3ware-content-css.js — Content panel CSS injection.
 * Attaches: window._n3wareModules.injectContentCSS
 */
(function () { 'use strict';
  window._n3wareModules = window._n3wareModules || {};

  window._n3wareModules.injectContentCSS = function injectContentCSS() {
    if (document.getElementById('n3-content-style')) return;
    const style = document.createElement('style');
    style.id = 'n3-content-style';
    style.textContent = [
      /* Panel base */
      '.n3-content-panel{position:fixed;top:0;right:0;bottom:0;',
      'width:264px;background:#111111;',
      'border-left:1px solid #2A2A2A;',
      'z-index:2147483640;display:flex;flex-direction:column;',
      'transform:translateX(110%);transition:transform 0.3s ease;',
      'font-family:system-ui,sans-serif;color:#E5E5E5;}',

      '.n3-content-panel.n3-panel-open{transform:translateX(0) !important;}',

      /* Panel header */
      '.n3-content-header{display:flex;align-items:center;gap:8px;',
      'padding:16px 16px 12px;border-bottom:1px solid #2A2A2A;flex-shrink:0;}',
      '.n3-content-header h2{flex:1;font-size:14px;font-weight:700;margin:0;color:#E5E5E5;}',
      '.n3-content-btn{background:none;border:none;color:#888;cursor:pointer;',
      'padding:4px;border-radius:6px;display:flex;align-items:center;transition:color 0.15s;}',
      '.n3-content-btn:hover{color:#E5E5E5;}',

      /* Scrollable body */
      '.n3-content-body{flex:1;overflow-y:auto;padding:12px 12px 80px;}',

      /* Collection cards */
      '.n3-collection-card{background:#1A1A1A;border:1px solid #2A2A2A;',
      'border-radius:10px;padding:12px;margin-bottom:8px;',
      'cursor:pointer;transition:border-color 0.15s;}',
      '.n3-collection-card:hover{border-color:#444;}',
      '.n3-collection-card-name{font-size:13px;font-weight:600;margin-bottom:2px;}',
      '.n3-collection-card-meta{font-size:11px;color:#888;}',

      /* Entry rows */
      '.n3-entry-row{display:flex;align-items:center;gap:10px;',
      'padding:10px 0;border-bottom:1px solid #1A1A1A;cursor:pointer;}',
      '.n3-entry-row:hover .n3-entry-label{color:#E31337;}',
      '.n3-entry-thumb{width:36px;height:36px;border-radius:6px;',
      'background:#2A2A2A;flex-shrink:0;overflow:hidden;',
      'display:flex;align-items:center;justify-content:center;font-size:16px;}',
      '.n3-entry-thumb img{width:100%;height:100%;object-fit:cover;}',
      '.n3-entry-label{font-size:13px;font-weight:500;flex:1;}',
      '.n3-entry-sub{font-size:11px;color:#888;}',

      /* Form fields */
      '.n3-field-row{margin-bottom:14px;}',
      '.n3-field-label{display:block;font-size:11px;font-weight:600;',
      'color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;}',
      '.n3-field-required{color:#E31337;}',
      '.n3-field-input{width:100%;background:#1A1A1A;border:1px solid #2A2A2A;',
      'border-radius:8px;padding:8px 10px;color:#E5E5E5;',
      'font-size:13px;box-sizing:border-box;outline:none;transition:border-color 0.15s;}',
      '.n3-field-input:focus{border-color:#444;}',
      '.n3-field-textarea{min-height:80px;resize:vertical;font-family:inherit;}',
      '.n3-field-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;}',
      '.n3-toggle-track{width:36px;height:20px;border-radius:10px;background:#2A2A2A;',
      'position:relative;transition:background 0.15s;flex-shrink:0;}',
      '.n3-toggle-track.on{background:#E31337;}',
      '.n3-toggle-thumb{position:absolute;top:2px;left:2px;',
      'width:16px;height:16px;border-radius:50%;background:white;transition:transform 0.15s;}',
      '.n3-toggle-track.on .n3-toggle-thumb{transform:translateX(16px);}',

      /* Bottom sticky action bar */
      '.n3-content-actions{position:absolute;bottom:0;left:0;right:0;',
      'padding:12px;background:#111;border-top:1px solid #2A2A2A;display:flex;gap:8px;}',
      '.n3-btn-primary{flex:1;background:#E31337;color:white;border:none;',
      'border-radius:8px;padding:10px;font-size:13px;font-weight:600;',
      'cursor:pointer;transition:background 0.15s;}',
      '.n3-btn-primary:hover{background:#c0102a;}',
      '.n3-btn-danger{background:none;border:1px solid #E31337;color:#E31337;',
      'border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;',
      'cursor:pointer;transition:background 0.15s;}',
      '.n3-btn-danger:hover{background:rgba(227,19,55,0.1);}',

      /* Badge */
      '.n3-badge{background:#2A2A2A;color:#888;border-radius:999px;',
      'padding:2px 7px;font-size:11px;font-weight:600;}',

      /* Empty state */
      '.n3-empty{text-align:center;padding:32px 16px;color:#888;font-size:13px;line-height:1.5;}',

      /* Create collection modal */
      '.n3-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);',
      'z-index:2147483645;display:flex;align-items:center;justify-content:center;}',
      '.n3-modal{background:#111;border:1px solid #2A2A2A;border-radius:16px;',
      'padding:24px;width:480px;max-width:calc(100vw - 32px);',
      'max-height:80vh;overflow-y:auto;}',
      '.n3-modal h3{font-size:16px;font-weight:700;margin:0 0 16px;}',
      '.n3-field-builder-row{display:grid;grid-template-columns:1fr 120px 32px;',
      'gap:6px;margin-bottom:6px;align-items:start;}',
      '.n3-field-builder-row input,.n3-field-builder-row select{',
      'background:#1A1A1A;border:1px solid #2A2A2A;',
      'border-radius:8px;padding:7px 9px;color:#E5E5E5;',
      'font-size:12px;outline:none;width:100%;box-sizing:border-box;}',
      '.n3-remove-field{background:none;border:none;color:#555;cursor:pointer;',
      'font-size:16px;padding:4px;border-radius:4px;',
      'display:flex;align-items:center;justify-content:center;}',
      '.n3-remove-field:hover{color:#E31337;}',
    ].join('');
    document.head.appendChild(style);
  };

})();
