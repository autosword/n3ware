/**
 * n3ware-charts — Zero-dependency canvas charting library (Chart.js-compatible API).
 * N3Chart: supports bar (vertical/horizontal) and doughnut chart types.
 * Registers on window._n3wareModules.
 */
(function() { 'use strict';
  const { T, SEL, _esc, _fmtDate, _fmtNum, _fmtDur, _svgArc, N3UI } = window._n3wareModules;

  class N3Chart {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{ type:string, data:object, options:object }} config
     */
    constructor(canvas, config) {
      this._canvas  = canvas;
      this._cfg     = config;
      this._ctx     = canvas.getContext('2d');
      this._tooltip = null;
      this._animPct = 0;
      this._animId  = null;
      this._onMove  = this._handleMouseMove.bind(this);
      this._onLeave = this._handleMouseLeave.bind(this);
      this._ro      = null;

      this._setup();
      this._animate();
      canvas.addEventListener('mousemove', this._onMove);
      canvas.addEventListener('mouseleave', this._onLeave);
    }

    /** Destroy the chart instance, cancel animation, and clean up listeners. */
    destroy() {
      if (this._animId) cancelAnimationFrame(this._animId);
      if (this._ro)     this._ro.disconnect();
      this._canvas.removeEventListener('mousemove', this._onMove);
      this._canvas.removeEventListener('mouseleave', this._onLeave);
      if (this._tooltip) { this._tooltip.remove(); this._tooltip = null; }
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }

    // ── Private ────────────────────────────────────────────────────────────

    _setup() {
      const dpr = window.devicePixelRatio || 1;
      const w   = this._canvas.parentElement ? this._canvas.parentElement.clientWidth  || 300 : 300;
      const h   = this._canvas.parentElement ? this._canvas.parentElement.clientHeight || 160 : 160;
      this._canvas.width  = w * dpr;
      this._canvas.height = h * dpr;
      this._canvas.style.width  = w + 'px';
      this._canvas.style.height = h + 'px';
      this._ctx.scale(dpr, dpr);
      this._dpr = dpr;
      this._w   = w;
      this._h   = h;

      // ResizeObserver for responsiveness
      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => {
          const nw = this._canvas.parentElement ? this._canvas.parentElement.clientWidth || 300 : 300;
          const nh = this._canvas.parentElement ? this._canvas.parentElement.clientHeight || 160 : 160;
          if (nw === this._w && nh === this._h) return;
          this._w = nw; this._h = nh;
          this._canvas.width  = nw * this._dpr;
          this._canvas.height = nh * this._dpr;
          this._canvas.style.width  = nw + 'px';
          this._canvas.style.height = nh + 'px';
          this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
          this._draw(1);
        });
        this._ro.observe(this._canvas.parentElement || this._canvas);
      }
    }

    _animate() {
      const start = performance.now();
      const dur   = 500;
      const tick  = now => {
        const p = Math.min((now - start) / dur, 1);
        // ease-out cubic
        this._animPct = 1 - Math.pow(1 - p, 3);
        this._draw(this._animPct);
        if (p < 1) this._animId = requestAnimationFrame(tick);
        else        this._animId = null;
      };
      this._animId = requestAnimationFrame(tick);
    }

    _draw(pct) {
      const type = this._cfg.type;
      const horiz = type === 'bar' && this._cfg.options && this._cfg.options.indexAxis === 'y';
      const ctx = this._ctx;
      ctx.clearRect(0, 0, this._w, this._h);

      if (type === 'doughnut') { this._drawDoughnut(pct); return; }
      if (horiz)                { this._drawHBar(pct);     return; }
      this._drawBar(pct);
    }

    // ── Bar chart (vertical) ───────────────────────────────────────────────
    _drawBar(pct) {
      const { data, options = {} } = this._cfg;
      const labels  = data.labels || [];
      const dataset = data.datasets[0] || {};
      const values  = dataset.data || [];
      if (!values.length) return;

      const ctx      = this._ctx;
      const PAD_L    = 36;
      const PAD_R    = 8;
      const PAD_T    = 10;
      const PAD_B    = 28;
      const chartW   = this._w - PAD_L - PAD_R;
      const chartH   = this._h - PAD_T - PAD_B;
      const maxVal   = Math.max(...values, 1);
      const barW     = Math.max(chartW / values.length - 3, 2);
      const gridClr  = '#2A2A2A';
      const txtClr   = '#888888';
      const gridLines = 4;

      // Grid lines + Y labels
      ctx.strokeStyle = gridClr;
      ctx.lineWidth   = 1;
      ctx.fillStyle   = txtClr;
      ctx.font        = '10px system-ui,sans-serif';
      ctx.textAlign   = 'right';
      for (let i = 0; i <= gridLines; i++) {
        const y   = PAD_T + chartH - (i / gridLines) * chartH;
        const val = Math.round((i / gridLines) * maxVal);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + chartW, y);
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val, PAD_L - 4, y + 3);
      }

      // Bars
      values.forEach((v, i) => {
        const bh     = Math.max((v / maxVal) * chartH * pct, 2);
        const x      = PAD_L + i * (chartW / values.length) + (chartW / values.length - barW) / 2;
        const y      = PAD_T + chartH - bh;
        const color  = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[i] : (dataset.backgroundColor || '#E31337');
        // Rounded top
        const r = Math.min(3, barW / 2, bh / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + bh);
        ctx.lineTo(x, y + bh);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // X label
        if (labels[i]) {
          ctx.fillStyle   = txtClr;
          ctx.textAlign   = 'center';
          ctx.font        = '10px system-ui,sans-serif';
          ctx.fillText(String(labels[i]).slice(0, 4), x + barW / 2, PAD_T + chartH + 14);
        }
      });

      // Store bar geometry for hover
      this._barRects = values.map((v, i) => {
        const bh = Math.max((v / maxVal) * chartH, 2);
        const x  = PAD_L + i * (chartW / values.length) + (chartW / values.length - barW) / 2;
        return { x, y: PAD_T + chartH - bh, w: barW, h: bh, label: labels[i], value: v };
      });
      this._padL = PAD_L; this._padT = PAD_T; this._chartH = chartH;
    }

    // ── Horizontal bar chart ───────────────────────────────────────────────
    _drawHBar(pct) {
      const { data, options = {} } = this._cfg;
      const labels  = data.labels || [];
      const dataset = data.datasets[0] || {};
      const values  = dataset.data || [];
      if (!values.length) return;

      const ctx    = this._ctx;
      const PAD_L  = 90;
      const PAD_R  = 36;
      const PAD_T  = 6;
      const PAD_B  = 6;
      const chartW = this._w - PAD_L - PAD_R;
      const chartH = this._h - PAD_T - PAD_B;
      const maxVal = Math.max(...values, 1);
      const rowH   = chartH / values.length;
      const barH   = Math.max(rowH * 0.5, 4);
      const txtClr = '#888888';

      values.forEach((v, i) => {
        const bw    = Math.max((v / maxVal) * chartW * pct, 2);
        const y     = PAD_T + i * rowH + (rowH - barH) / 2;
        const color = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[i] : (dataset.backgroundColor || '#E31337');
        const r     = Math.min(3, barH / 2);

        // Label
        ctx.fillStyle   = txtClr;
        ctx.font        = '11px system-ui,sans-serif';
        ctx.textAlign   = 'right';
        ctx.fillText(String(labels[i] || '').slice(0, 14), PAD_L - 6, y + barH / 2 + 4);

        // Bar with rounded right end
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + bw - r, y);
        ctx.quadraticCurveTo(PAD_L + bw, y, PAD_L + bw, y + r);
        ctx.lineTo(PAD_L + bw, y + barH - r);
        ctx.quadraticCurveTo(PAD_L + bw, y + barH, PAD_L + bw - r, y + barH);
        ctx.lineTo(PAD_L, y + barH);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // Value at right
        const fullBw = (v / maxVal) * chartW;
        ctx.fillStyle = txtClr;
        ctx.textAlign = 'left';
        ctx.font      = '10px system-ui,sans-serif';
        ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v, PAD_L + fullBw + 5, y + barH / 2 + 4);
      });

      this._hBarRects = values.map((v, i) => {
        const bw = (v / maxVal) * chartW;
        const y  = PAD_T + i * rowH + (rowH - barH) / 2;
        return { x: PAD_L, y, w: bw, h: barH, label: labels[i], value: v };
      });
    }

    // ── Doughnut chart ─────────────────────────────────────────────────────
    _drawDoughnut(pct) {
      const { data, options = {} } = this._cfg;
      const dataset = data.datasets[0] || {};
      const values  = dataset.data || [];
      const colors  = dataset.backgroundColor || ['#E31337', '#22C55E', '#EAB308'];
      const labels  = data.labels || [];
      if (!values.length) return;

      const ctx   = this._ctx;
      const cx    = this._w / 2;
      const cy    = this._h / 2;
      const r     = Math.min(cx, cy) * 0.82;
      const inner = r * 0.6;
      const total = values.reduce((s, v) => s + v, 0) || 1;

      let startAngle = -Math.PI / 2;
      this._arcs = [];
      values.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2 * pct;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
        ctx.arc(cx, cy, inner, startAngle + sweep, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        this._arcs.push({ start: startAngle, end: startAngle + sweep, label: labels[i], value: v });
        startAngle += sweep;
      });

      // Center text
      const centerText    = options.centerText    || '';
      const centerSubtext = options.centerSubtext || '';
      if (centerText) {
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle    = '#E5E5E5';
        ctx.font         = `700 ${Math.round(r * 0.32)}px system-ui,sans-serif`;
        ctx.fillText(centerText, cx, cy - (centerSubtext ? r * 0.12 : 0));
        if (centerSubtext) {
          ctx.fillStyle = '#888888';
          ctx.font      = `${Math.round(r * 0.21)}px system-ui,sans-serif`;
          ctx.fillText(centerSubtext, cx, cy + r * 0.18);
        }
        ctx.textBaseline = 'alphabetic';
      }

      this._cx = cx; this._cy = cy; this._r = r; this._inner = inner;
    }

    // ── Tooltip & hover ────────────────────────────────────────────────────
    _getTooltip() {
      if (!this._tooltip) {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;z-index:9999999;background:#1A1A1A;border:1px solid #333;color:#E5E5E5;font:12px/1.4 system-ui,sans-serif;padding:5px 10px;border-radius:6px;pointer-events:none;opacity:0;transition:opacity .12s;white-space:nowrap';
        document.body.appendChild(t);
        this._tooltip = t;
      }
      return this._tooltip;
    }

    _showTooltip(x, y, label, value) {
      const t = this._getTooltip();
      t.textContent = `${label}: ${value}`;
      t.style.left    = (x + 12) + 'px';
      t.style.top     = (y - 10) + 'px';
      t.style.opacity = '1';
    }

    _hideTooltip() {
      if (this._tooltip) this._tooltip.style.opacity = '0';
    }

    _handleMouseMove(e) {
      const rect   = this._canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const type   = this._cfg.type;
      const horiz  = type === 'bar' && this._cfg.options && this._cfg.options.indexAxis === 'y';

      if (type === 'doughnut' && this._arcs) {
        const dx   = mx - this._cx;
        const dy   = my - this._cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= this._inner && dist <= this._r) {
          let angle = Math.atan2(dy, dx);
          if (angle < -Math.PI / 2) angle += Math.PI * 2;
          const hit = this._arcs.find(a => angle >= a.start && angle <= a.end);
          if (hit) { this._showTooltip(e.clientX, e.clientY, hit.label, hit.value); return; }
        }
        this._hideTooltip();
        return;
      }

      if (horiz && this._hBarRects) {
        const hit = this._hBarRects.find(b => mx >= b.x && mx <= b.x + b.w + 40 && my >= b.y - 4 && my <= b.y + b.h + 4);
        if (hit) { this._showTooltip(e.clientX, e.clientY, hit.label, hit.value); return; }
        this._hideTooltip();
        return;
      }

      if (this._barRects) {
        const hit = this._barRects.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
        if (hit) { this._showTooltip(e.clientX, e.clientY, hit.label, hit.value); return; }
        this._hideTooltip();
      }
    }

    _handleMouseLeave() { this._hideTooltip(); }
  }

  Object.assign(window._n3wareModules, { N3Chart });
})();
