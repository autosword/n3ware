/**
 * n3ware-image — Image replacement flow.
 * N3ImageEditor — modal for swapping <img> src via URL or file upload.
 * Registers on window._n3wareModules.
 */
(function () { 'use strict';

  const { T, N3UI } = window._n3wareModules;
  const _ic = (name, opts) => {
    const fn = (window._n3wareModules || {}).icon;
    return fn ? fn(name, opts || { size: 16 }) : '';
  };

  // ── CSS injection (idempotent) ─────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('n3-image-style')) return;
    const s = document.createElement('style');
    s.id = 'n3-image-style';
    s.textContent = [
      `.n3-img-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999997;display:flex;align-items:center;justify-content:center;animation:n3-fade-in .15s ease}`,
      `.n3-img-modal{background:#0B1120;border:1px solid ${T.border};border-radius:14px;width:min(480px,94vw);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}`,
      `.n3-img-header{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid ${T.border};flex-shrink:0}`,
      `.n3-img-icon{width:32px;height:32px;border-radius:8px;background:rgba(227,19,55,.15);border:1px solid rgba(227,19,55,.25);display:flex;align-items:center;justify-content:center;color:#E31337;flex-shrink:0}`,
      `.n3-img-title{flex:1;font:600 14px/1 system-ui,sans-serif;color:${T.text}}`,
      `.n3-img-close{background:transparent;border:none;color:${T.muted};cursor:pointer;width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;transition:all .12s;flex-shrink:0}`,
      `.n3-img-close:hover{background:rgba(255,255,255,.1);color:${T.text}}`,
      `.n3-img-body{padding:18px;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:14px}`,
      `.n3-img-section-label{font:700 11px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:${T.muted};margin-bottom:8px}`,
      `.n3-img-divider{border:none;border-top:1px solid ${T.border};margin:0}`,
      `.n3-img-or{text-align:center;font:12px/1 system-ui,sans-serif;color:${T.muted}}`,
      `.n3-img-url-row{display:flex;gap:8px;align-items:center}`,
      `.n3-img-url-input{flex:1;background:rgba(255,255,255,.05);border:1px solid ${T.border};color:${T.text};border-radius:7px;padding:8px 12px;font:13px/1 system-ui,sans-serif;outline:none;box-sizing:border-box;transition:border-color .15s}`,
      `.n3-img-url-input:focus{border-color:${T.accent}}`,
      `.n3-img-url-input::placeholder{color:${T.muted}}`,
      `.n3-img-hint{font:12px/1.4 system-ui,sans-serif;color:${T.muted};margin-top:4px}`,
      `.n3-img-url-prev{width:100%;max-height:140px;object-fit:contain;border-radius:8px;border:1px solid ${T.border};margin-top:8px;display:none}`,
      `.n3-img-url-err{font:12px/1.4 system-ui,sans-serif;color:#F87171;margin-top:6px;display:none}`,
      `.n3-img-url-btn{flex-shrink:0;background:rgba(255,255,255,.07);border:1px solid ${T.border};color:${T.text};padding:8px 14px;border-radius:7px;cursor:pointer;font:600 12px/1 system-ui,sans-serif;white-space:nowrap;transition:all .12s}`,
      `.n3-img-url-btn:hover{background:rgba(255,255,255,.14)}`,
      `.n3-img-dropzone{border:2px dashed ${T.border};border-radius:8px;padding:22px 18px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;position:relative}`,
      `.n3-img-dropzone:hover,.n3-img-dropzone.n3-img-drag-over{border-color:${T.accent};background:rgba(227,19,55,.05)}`,
      `.n3-img-dropzone-label{font:13px/1.5 system-ui,sans-serif;color:${T.muted};margin-top:8px}`,
      `.n3-img-dropzone-label span{color:${T.accent};text-decoration:underline;cursor:pointer}`,
      `.n3-img-dropzone input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}`,
      `.n3-img-upload-prev{width:100%;max-height:140px;object-fit:contain;border-radius:8px;border:1px solid ${T.border};margin-top:10px;display:none}`,
      `.n3-img-upload-btn{width:100%;background:${T.accent};border:1px solid ${T.accent};color:#fff;padding:9px 16px;border-radius:7px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;transition:all .12s;display:none;align-items:center;justify-content:center;gap:6px;margin-top:8px;box-sizing:border-box}`,
      `.n3-img-upload-btn:hover{background:${T.accentDark};border-color:${T.accentDark}}`,
      `.n3-img-alt-input{width:100%;background:rgba(255,255,255,.05);border:1px solid ${T.border};color:${T.text};border-radius:7px;padding:8px 12px;font:13px/1 system-ui,sans-serif;outline:none;box-sizing:border-box;transition:border-color .15s}`,
      `.n3-img-alt-input:focus{border-color:${T.accent}}`,
      `.n3-img-alt-input::placeholder{color:${T.muted}}`,
      `.n3-img-footer{display:flex;align-items:center;gap:8px;padding:14px 18px;border-top:1px solid ${T.border};flex-shrink:0}`,
      `.n3-img-spacer{flex:1}`,
      `.n3-img-cancel{background:rgba(255,255,255,.07);border:1px solid ${T.border};color:${T.text};padding:8px 18px;border-radius:7px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;transition:all .12s}`,
      `.n3-img-cancel:hover{background:rgba(255,255,255,.14)}`,
      `.n3-img-replace{background:${T.accent};border:1px solid ${T.accent};color:#fff;padding:8px 18px;border-radius:7px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;transition:all .12s}`,
      `.n3-img-replace:hover{background:${T.accentDark};border-color:${T.accentDark}}`,
      `.n3-img-replace:disabled{opacity:.4;cursor:not-allowed}`,
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── N3ImageEditor ──────────────────────────────────────────────────────────
  class N3ImageEditor {
    /**
     * @param {N3Events} events
     * @param {{ api:string, site:string, key:string }|null} cloudCfg
     */
    constructor(events, cloudCfg) {
      this._events      = events;
      this._cloudCfg    = cloudCfg;
      this._backdrop    = null;
      this._targetImg   = null;
      this._pendingUrl  = null;   // resolved URL or data URL
      this._pendingType = null;   // 'url' | 'upload'
      this._pendingFile = null;   // File object for GCS upload
    }

    mount() {
      _injectStyles();
    }

    /** Open the replace-image modal for a specific <img> element. */
    open(imgEl) {
      if (this._backdrop) this.close();
      this._targetImg   = imgEl;
      this._pendingUrl  = null;
      this._pendingType = null;
      this._pendingFile = null;
      this._buildModal();
    }

    close() {
      if (this._backdrop) {
        this._backdrop.remove();
        this._backdrop = null;
      }
      this._targetImg   = null;
      this._pendingUrl  = null;
      this._pendingType = null;
      this._pendingFile = null;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _buildModal() {
      const img = this._targetImg;

      // Backdrop — dismiss on click-outside
      const backdrop = document.createElement('div');
      backdrop.className = 'n3-img-backdrop';
      backdrop.setAttribute('data-n3-ui', '1');
      backdrop.addEventListener('click', e => { if (e.target === backdrop) this.close(); });
      this._backdrop = backdrop;

      // Modal shell
      const modal = document.createElement('div');
      modal.className = 'n3-img-modal';

      // ── Header ──────────────────────────────────────────────────────────────
      const header = document.createElement('div');
      header.className = 'n3-img-header';
      const iconEl = document.createElement('div');
      iconEl.className = 'n3-img-icon';
      iconEl.innerHTML = _ic('image', { size: 16 });
      const titleEl = document.createElement('div');
      titleEl.className = 'n3-img-title';
      titleEl.textContent = 'Replace image';
      const closeBtn = N3UI.btn(_ic('x', { size: 14 }), 'n3-img-close', 'Close');
      closeBtn.addEventListener('click', () => this.close());
      header.append(iconEl, titleEl, closeBtn);

      // ── Body ────────────────────────────────────────────────────────────────
      const body = document.createElement('div');
      body.className = 'n3-img-body';

      // Footer replace button (declared early so sections can reference it)
      const replaceBtn = document.createElement('button');
      replaceBtn.className = 'n3-img-replace';
      replaceBtn.textContent = 'Replace';
      replaceBtn.disabled = true;

      // §1 — Paste a URL
      const urlSection = document.createElement('div');

      const urlLbl = document.createElement('div');
      urlLbl.className = 'n3-img-section-label';
      urlLbl.textContent = 'Paste a URL';

      const urlRow = document.createElement('div');
      urlRow.className = 'n3-img-url-row';

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.className = 'n3-img-url-input';
      urlInput.placeholder = 'https://example.com/image.jpg';

      const urlBtn = document.createElement('button');
      urlBtn.className = 'n3-img-url-btn';
      urlBtn.textContent = 'Use URL →';

      urlRow.append(urlInput, urlBtn);

      const urlHint = document.createElement('p');
      urlHint.className = 'n3-img-hint';
      urlHint.textContent = 'Any public image URL. Unsplash, your CDN, wherever.';

      const urlPrev = document.createElement('img');
      urlPrev.className = 'n3-img-url-prev';
      urlPrev.alt = '';

      const urlErr = document.createElement('p');
      urlErr.className = 'n3-img-url-err';
      urlErr.textContent = "Couldn't load that URL — make sure it's a public image.";

      const tryUrl = () => {
        const v = urlInput.value.trim();
        if (v) this._validateUrl(v, urlPrev, urlErr, replaceBtn);
      };
      urlBtn.addEventListener('click', tryUrl);
      urlInput.addEventListener('blur', tryUrl);
      urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryUrl(); });

      urlSection.append(urlLbl, urlRow, urlHint, urlPrev, urlErr);

      // Divider + or
      const divider = document.createElement('hr');
      divider.className = 'n3-img-divider';
      const orEl = document.createElement('div');
      orEl.className = 'n3-img-or';
      orEl.textContent = 'or';

      // §2 — Upload a file
      const uploadSection = document.createElement('div');

      const uploadLbl = document.createElement('div');
      uploadLbl.className = 'n3-img-section-label';
      uploadLbl.textContent = 'Upload a file';

      const dropzone = document.createElement('div');
      dropzone.className = 'n3-img-dropzone';

      const dropIcon = document.createElement('div');
      dropIcon.style.color = T.muted;
      dropIcon.innerHTML = _ic('upload-cloud', { size: 28 });

      const dropLabel = document.createElement('p');
      dropLabel.className = 'n3-img-dropzone-label';
      dropLabel.innerHTML = 'Drop an image here or <span>browse</span>';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';

      dropzone.append(dropIcon, dropLabel, fileInput);

      const uploadPrev = document.createElement('img');
      uploadPrev.className = 'n3-img-upload-prev';
      uploadPrev.alt = '';

      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'n3-img-upload-btn';
      uploadBtn.innerHTML = _ic('check', { size: 14 }) + ' Use this image →';

      const onFile = (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = ev => {
          const dataUrl = ev.target.result;
          uploadPrev.src = dataUrl;
          uploadPrev.style.display = 'block';
          uploadBtn.style.display = 'flex';
          // Clear any URL selection — upload takes priority
          urlPrev.style.display = 'none';
          urlErr.style.display = 'none';
          this._pendingUrl  = dataUrl;
          this._pendingType = 'upload';
          this._pendingFile = file;
          replaceBtn.disabled = false;
        };
        reader.readAsDataURL(file);
      };

      fileInput.addEventListener('change', () => onFile(fileInput.files[0]));
      dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('n3-img-drag-over'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('n3-img-drag-over'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('n3-img-drag-over');
        onFile(e.dataTransfer.files[0]);
      });
      uploadBtn.addEventListener('click', () => { if (this._pendingType === 'upload') this._doReplace(altInput, replaceBtn); });

      uploadSection.append(uploadLbl, dropzone, uploadPrev, uploadBtn);

      // §3 — Alt text
      const altSection = document.createElement('div');

      const altLbl = document.createElement('div');
      altLbl.className = 'n3-img-section-label';
      altLbl.textContent = 'Alt text (for accessibility)';

      const altInput = document.createElement('input');
      altInput.type = 'text';
      altInput.className = 'n3-img-alt-input';
      altInput.placeholder = 'Describe the image…';
      altInput.value = img.getAttribute('alt') || '';

      altSection.append(altLbl, altInput);

      body.append(urlSection, divider, orEl, uploadSection, altSection);

      // ── Footer ───────────────────────────────────────────────────────────────
      const footer = document.createElement('div');
      footer.className = 'n3-img-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'n3-img-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.close());

      const spacer = document.createElement('div');
      spacer.className = 'n3-img-spacer';

      replaceBtn.addEventListener('click', () => this._doReplace(altInput, replaceBtn));

      footer.append(cancelBtn, spacer, replaceBtn);

      modal.append(header, body, footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
    }

    /**
     * Probe a URL with an off-DOM image — shows preview on success, error on fail.
     */
    _validateUrl(url, prevImg, errEl, replaceBtn) {
      prevImg.style.display = 'none';
      errEl.style.display   = 'none';
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => {
        prevImg.src = url;
        prevImg.style.display = 'block';
        errEl.style.display   = 'none';
        this._pendingUrl  = url;
        this._pendingType = 'url';
        this._pendingFile = null;
      };
      probe.onerror = () => {
        // CORS-only failure: some valid images reject the anonymous probe.
        // Accept the URL anyway but show a softer warning.
        prevImg.style.display = 'none';
        errEl.style.display   = 'block';
        errEl.textContent     = "Couldn't preview that URL (CORS or invalid). It may still work — try replacing.";
        // Still allow replace attempt with the raw URL
        this._pendingUrl  = url;
        this._pendingType = 'url';
        this._pendingFile = null;
      };
      probe.src = url;
      // Enable replace once the user has typed a URL value
      replaceBtn.disabled = false;
    }

    async _doReplace(altInput, replaceBtn) {
      if (!this._pendingUrl || !this._targetImg) return;
      replaceBtn.disabled = true;

      let finalUrl = this._pendingUrl;

      // For file uploads with a cloud config, try to get a stable GCS URL
      if (this._pendingType === 'upload' && this._cloudCfg && this._pendingFile) {
        try {
          finalUrl = await this._uploadToGCS(this._pendingFile);
        } catch (e) {
          // Fall back to base64 data URL
          // TODO: image blobs in saved HTML are large — long-term, require auth upload
          console.warn('n3ware-image: GCS upload failed, using base64 data URL', e);
          finalUrl = this._pendingUrl;
        }
      }

      const img = this._targetImg;
      img.src = finalUrl;
      img.setAttribute('alt', altInput.value.trim());

      // Push onto history stack so Ctrl+Z can revert
      const hist = window.n3ware && window.n3ware._modules && window.n3ware._modules.history;
      if (hist) hist.push(document.body.innerHTML);

      // Tailwind may need to re-scan new DOM state
      window.tailwind && window.tailwind.refresh && window.tailwind.refresh();

      this.close();
    }

    async _uploadToGCS(file) {
      const { api, site } = this._cloudCfg;
      const token = sessionStorage.getItem('n3_auth') || localStorage.getItem('n3_token') || '';
      const form  = new FormData();
      form.append('file', file);
      const res = await fetch(`${api.replace(/\/$/, '')}/api/uploads/${site}/upload`, {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed: ' + res.status);
      const data = await res.json();
      return data.file.url;
    }
  }

  window._n3wareModules.N3ImageEditor = N3ImageEditor;

})();
