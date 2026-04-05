/**
 * n3ware-text — Text editing, drag-and-drop, and element controls.
 * N3TextEditor, N3DragManager, N3ElementControls
 * Registers on window._n3wareModules.
 */
(function() { 'use strict';
  const { T, SEL, _esc, _fmtDate, _fmtNum, _fmtDur, _svgArc, N3UI } = window._n3wareModules;

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

      // Current computed font size in whole px.
      const computedSize = Math.round(parseFloat(getComputedStyle(el).fontSize)) || 16;

      // Standard size options (expanded per spec).
      const SIZE_OPTIONS = [12,14,16,18,20,24,28,32,36,40,48,56,64,72,96];
      // If the actual size isn't in the list, insert it in sorted order so the
      // dropdown always shows the real current value instead of going blank.
      if (!SIZE_OPTIONS.includes(computedSize)) {
        const idx = SIZE_OPTIONS.findIndex(n => n > computedSize);
        if (idx === -1) SIZE_OPTIONS.push(computedSize);
        else SIZE_OPTIONS.splice(idx, 0, computedSize);
      }
      const sizeOpts = SIZE_OPTIONS.map(n => [`${n}px`, n]);

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
        fSel(sizeOpts, 'Font size', v => { el.style.fontSize = v + 'px'; }, computedSize),
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
      const _icLink = (window._n3wareModules||{}).icon;
      bar.appendChild(fBtn(_icLink ? _icLink('link', {size: 14}) : 'Link', 'Insert Link', () => { const u = prompt('Enter URL:'); if (u) exec('createLink', u); }));
      return bar;
    }

    _positionBar(el) {
      if (!this._bar) return;
      const rect = el.getBoundingClientRect();
      const barH = this._bar.offsetHeight || 46;
      const barW = this._bar.offsetWidth  || 300;
      // position:fixed — getBoundingClientRect() already returns viewport-relative coords.
      // Clamp above element; 52px minimum keeps bar below the n3ware toolbar.
      const top  = Math.max(52, Math.min(rect.top - barH - 8, window.innerHeight - barH - 8));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - barW - 8));
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

      const upBtn = N3UI.btn('↑', 'n3-ctrl-btn', 'Move up');
      upBtn.addEventListener('click', e => { e.stopPropagation(); this._events.emit('controls:move-up', el); });

      const downBtn = N3UI.btn('↓', 'n3-ctrl-btn', 'Move down');
      downBtn.addEventListener('click', e => { e.stopPropagation(); this._events.emit('controls:move-down', el); });

      const delBtn = N3UI.btn('×', 'n3-ctrl-btn n3-delete', 'Delete element');
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await N3UI.confirm('Delete element?', `Remove this <${el.tagName.toLowerCase()}>? Undoable with Ctrl+Z.`);
        if (ok) this._events.emit('controls:delete', el);
      });

      overlay.append(typeLabel, dragBtn, upBtn, downBtn, dupBtn, delBtn);
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

  Object.assign(window._n3wareModules, { N3TextEditor, N3DragManager, N3ElementControls });
})();
