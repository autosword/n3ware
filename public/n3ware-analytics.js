/**
 * n3ware-analytics — Analytics overlay and script placeholder management.
 * N3Analytics, N3ScriptPlaceholders
 * Registers on window._n3wareModules.
 */
(function() { 'use strict';
  const { T, SEL, _esc, _fmtDate, _fmtNum, _fmtDur, _svgArc, N3UI } = window._n3wareModules;
  let N3Chart; // loaded by n3ware-charts.js — resolved lazily

  class N3ScriptPlaceholders {
    /** @param {N3Events} events */
    constructor(events) {
      this._events = events;
      /**
       * @type {Array<{key:string,startNode:Comment,endNode:Comment,
       *               scripts:HTMLScriptElement[],ph:HTMLElement}>}
       */
      this._entries = [];
      /** @type {HTMLElement|null} */
      this._modal = null;
    }

    /** Scan DOM and insert placeholder cards. Called when edit mode activates. */
    enable() {
      this._scan();
    }

    /** Remove all placeholder cards (comments and scripts stay). */
    disable() {
      this._entries.forEach(({ ph }) => { if (ph.parentNode) ph.remove(); });
      this._entries = [];
      if (this._modal) { this._modal.remove(); this._modal = null; }
    }

    // ── Private ────────────────────────────────────────────────────────────

    _scan() {
      const walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_COMMENT, null
      );
      /** @type {Map<string, Comment>} */
      const starts = new Map();
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue.trim();
        const sm = text.match(/^n3:script:(.+):start$/);
        const em = text.match(/^n3:script:(.+):end$/);
        if (sm) {
          starts.set(sm[1], node);
        } else if (em) {
          const startNode = starts.get(em[1]);
          if (startNode) {
            starts.delete(em[1]);
            this._insertCard(em[1], startNode, node);
          }
        }
      }
    }

    /**
     * @param {string}  key
     * @param {Comment} startNode
     * @param {Comment} endNode
     */
    _insertCard(key, startNode, endNode) {
      // Collect <script> elements that live between the two comment nodes
      const scripts = [];
      let cur = startNode.nextSibling;
      while (cur && cur !== endNode) {
        if (cur.nodeName === 'SCRIPT') scripts.push(cur);
        cur = cur.nextSibling;
      }

      // Build placeholder card
      const ph = document.createElement('div');
      ph.className = 'n3-script-ph';
      ph.setAttribute('data-n3-ui', '1');

      const icon = document.createElement('span');
      icon.className = 'n3-script-ph-icon';
      icon.textContent = '{}';

      const label = document.createElement('span');
      label.className = 'n3-script-ph-name';
      label.textContent = key;

      const actions = document.createElement('div');
      actions.className = 'n3-script-ph-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'n3-script-ph-btn';
      editBtn.textContent = 'Edit';
      editBtn.title = 'Edit script code';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'n3-script-ph-btn n3-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.title = 'Delete script and its comment wrappers';

      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);
      ph.appendChild(icon);
      ph.appendChild(label);
      ph.appendChild(actions);

      // Insert card immediately after the start comment
      startNode.parentNode.insertBefore(ph, startNode.nextSibling);

      const entry = { key, startNode, endNode, scripts, ph };
      this._entries.push(entry);

      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        this._openEditor(entry);
      });

      removeBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await N3UI.confirm(
          'Remove script', `Remove "${_esc(key)}" and its comment wrappers from the page?`
        );
        if (!ok) return;
        entry.scripts.forEach(s => s.remove());
        entry.startNode.remove();
        entry.endNode.remove();
        entry.ph.remove();
        const idx = this._entries.indexOf(entry);
        if (idx !== -1) this._entries.splice(idx, 1);
        this._events.emit('scripts:remove', key);
        N3UI.toast(`Script "${key}" removed`, 'info');
      });
    }

    /** Open the code-editor modal for an entry. */
    _openEditor(entry) {
      if (this._modal) this._modal.remove();

      // Serialise existing script content for display in editor
      const code = entry.scripts.map(s =>
        s.src ? `<script src="${s.src}"><\/script>` : s.textContent.trim()
      ).join('\n\n');

      // ── Build modal DOM ────────────────────────────────────────────────
      const overlay = document.createElement('div');
      overlay.className = 'n3-script-modal-overlay';
      overlay.setAttribute('data-n3-ui', '1');

      const modal = document.createElement('div');
      modal.className = 'n3-script-modal';

      // Header
      const hdr = document.createElement('div');
      hdr.className = 'n3-script-modal-header';
      const ttl = document.createElement('span');
      ttl.className = 'n3-script-modal-title';
      ttl.textContent = `Edit Script — ${entry.key}`;
      const closeBtn = document.createElement('button');
      closeBtn.className = 'n3-script-modal-close';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.title = 'Close';
      hdr.appendChild(ttl);
      hdr.appendChild(closeBtn);

      // Textarea
      const ta = document.createElement('textarea');
      ta.className = 'n3-script-modal-editor';
      ta.value = code;
      ta.spellcheck = false;
      ta.placeholder = '// Enter JavaScript here (inline code or full <script> tag)';
      // Prevent the editor's contenteditable machinery from touching this element
      ta.setAttribute('data-n3-no-edit', '1');

      // Footer
      const ftr = document.createElement('div');
      ftr.className = 'n3-script-modal-footer';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'n3-script-modal-cancel';
      cancelBtn.textContent = 'Cancel';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'n3-script-modal-save';
      saveBtn.textContent = 'Save';
      ftr.appendChild(cancelBtn);
      ftr.appendChild(saveBtn);

      modal.appendChild(hdr);
      modal.appendChild(ta);
      modal.appendChild(ftr);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      this._modal = overlay;
      ta.focus();

      // ── Wire close / save ──────────────────────────────────────────────
      const close = () => { overlay.remove(); this._modal = null; };
      closeBtn.addEventListener('click', close);
      cancelBtn.addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

      // Tab-key indentation in the textarea
      ta.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const { selectionStart: ss, selectionEnd: se } = ta;
          ta.value = ta.value.slice(0, ss) + '  ' + ta.value.slice(se);
          ta.selectionStart = ta.selectionEnd = ss + 2;
        }
      });

      saveBtn.addEventListener('click', () => {
        const newCode = ta.value;
        // Remove existing script elements
        entry.scripts.forEach(s => s.remove());
        entry.scripts.length = 0;
        // Insert replacement script before end comment
        if (newCode.trim()) {
          const newScript = document.createElement('script');
          newScript.textContent = newCode;
          entry.endNode.parentNode.insertBefore(newScript, entry.endNode);
          entry.scripts.push(newScript);
        }
        close();
        this._events.emit('scripts:change', entry.key);
        N3UI.toast(`Script "${entry.key}" saved`, 'success');
      });
    }
  }

  class N3Analytics {
    /**
     * @param {{ api: string, site: string, key: string }|null} cloudCfg
     */
    constructor(cloudCfg) {
      this._cfg      = cloudCfg;
      this._el       = null;
      this._open     = false;
      this._tab      = 'page';
      this._period   = '14d';
      this._cache    = {};
      this._cacheTtl = 5 * 60 * 1000;
      this._charts   = [];
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

    /** Toggle open/closed state. */
    toggle() { this._open ? this.close() : this.open(); }

    /** Open the analytics overlay and load data. */
    open() {
      if (!this._el) return;
      this._el.classList.add('n3-open');
      this._open = true;
      this._load();
    }

    /** Close the analytics overlay and destroy chart instances. */
    close() {
      if (!this._el) return;
      this._el.classList.remove('n3-open');
      this._open = false;
      this._charts.forEach(c => c.destroy());
      this._charts = [];
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
          <button class="n3-an-period" data-period="7d">7d</button>
          <button class="n3-an-period n3-an-active" data-period="14d">14d</button>
          <button class="n3-an-period" data-period="30d">30d</button>
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
      if (!this._cfg) return this._demoData(this._period);
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

    _demoData(period) {
      const numDays = period === '7d' ? 7 : period === '30d' ? 30 : 14;
      const daily = [];
      const now = new Date();
      const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 5 || dow === 6;
        const base = isWeekend ? 118 : 72;
        const jitter = Math.floor(Math.sin(i * 13.7) * 18 + Math.cos(i * 7.3) * 12);
        const views = Math.max(base + jitter, 30);
        const dayLabel = DAY_LABELS[dow];
        daily.push({ date: d.toISOString().slice(0, 10), views, label: dayLabel });
      }
      const totalViews = daily.reduce((s, d) => s + d.views, 0);
      const prevViews = Math.round(totalViews * 0.87);
      const totalVisitors = Math.round(totalViews * 0.33);
      const prevVisitors  = Math.round(prevViews  * 0.33);
      const scale = totalViews / 1247; // normalize to 14-day ~1247
      return {
        views:          totalViews,
        viewsPrev:      prevViews,
        uniqueVisitors: totalVisitors,
        visitorsPrev:   prevVisitors,
        avgDuration:    154,
        bounceRate:     38,
        realtime:       3,
        daily,
        sources: [
          { source: 'Google Maps',   sessions: Math.round(420 * scale) },
          { source: 'Google Search', sessions: Math.round(298 * scale) },
          { source: 'Direct',        sessions: Math.round(242 * scale) },
          { source: 'Instagram',     sessions: Math.round(124 * scale) },
          { source: 'Yelp',          sessions: Math.round(63  * scale) },
          { source: 'Other',         sessions: Math.round(62  * scale) },
        ],
        devices: {
          mobile:  Math.round(totalViews * 0.65),
          desktop: Math.round(totalViews * 0.30),
          tablet:  Math.round(totalViews * 0.05),
        },
        topPages: [
          { path: '/',             views: Math.round(totalViews * 0.40), avgTime: 185 },
          { path: '/menu',         views: Math.round(totalViews * 0.28), avgTime: 142 },
          { path: '/reservations', views: Math.round(totalViews * 0.16), avgTime: 203 },
          { path: '/about',        views: Math.round(totalViews * 0.09), avgTime: 98  },
          { path: '/our-chef',     views: Math.round(totalViews * 0.07), avgTime: 76  },
        ],
        events: [
          { icon: '📞', label: 'Phone Number Tapped',        count: Math.round(47 * scale), prev: Math.round(39 * scale), trend: 1  },
          { icon: '📅', label: 'Reservation Button Clicked', count: Math.round(23 * scale), prev: Math.round(18 * scale), trend: 1  },
          { icon: '🍽',  label: 'Menu Viewed',                count: Math.round(89 * scale), prev: Math.round(94 * scale), trend: -1 },
          { icon: '🗺',  label: 'Directions Clicked',          count: Math.round(31 * scale), prev: Math.round(24 * scale), trend: 1  },
          { icon: '✉',  label: 'Contact Form Submitted',      count: Math.round(8  * scale), prev: Math.round(5  * scale), trend: 1  },
        ],
        referrers: [
          { domain: 'maps.google.com', visits: Math.round(420 * scale) },
          { domain: 'google.com',      visits: Math.round(298 * scale) },
          { domain: 'instagram.com',   visits: Math.round(124 * scale) },
          { domain: 'yelp.com',        visits: Math.round(63  * scale) },
          { domain: 'facebook.com',    visits: Math.round(48  * scale) },
        ],
        cities: [
          { city: 'South Kingstown', count: Math.round(totalVisitors * 0.28) },
          { city: 'Narragansett',    count: Math.round(totalVisitors * 0.18) },
          { city: 'Wakefield',       count: Math.round(totalVisitors * 0.14) },
          { city: 'Providence',      count: Math.round(totalVisitors * 0.12) },
          { city: 'Westerly',        count: Math.round(totalVisitors * 0.09) },
          { city: 'Newport',         count: Math.round(totalVisitors * 0.07) },
        ],
        gaConnected: false,
      };
    }

    _empty() { return { views: 0, uniqueVisitors: 0, avgDuration: null, bounceRate: null, daily: [], sources: [], devices: {}, topPages: [], realtime: null, gaConnected: false }; }

    _makeChart(canvasId, config) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ChartClass = window._n3wareModules.N3Chart;
      if (!ChartClass) return;
      const chart = new ChartClass(canvas, config);
      this._charts.push(chart);
      return chart;
    }

    _render(data) {
      // Destroy any existing charts before re-rendering
      this._charts.forEach(c => c.destroy());
      this._charts = [];

      const body = this._el.querySelector('.n3-an-body');

      // % change badge helper
      const changeBadge = (curr, prev) => {
        if (prev == null || prev === 0) return '';
        const p = Math.round((curr - prev) / prev * 100);
        const cls = p >= 0 ? 'n3-up' : 'n3-dn';
        const arrow = p >= 0 ? '↑' : '↓';
        return `<span class="n3-an-stat-change ${cls}">${arrow}${Math.abs(p)}%</span>`;
      };

      // ── Stat cards ────────────────────────────────────────────────────────
      const viewsBadge    = changeBadge(data.views, data.viewsPrev);
      const visitorsBadge = changeBadge(data.uniqueVisitors, data.visitorsPrev);
      const statsHtml = `<div class="n3-an-stats">
        <div class="n3-an-stat">
          <span class="n3-an-stat-val">${_fmtNum(data.views)}${viewsBadge}</span>
          <span class="n3-an-stat-label">Page Views</span>
        </div>
        <div class="n3-an-stat">
          <span class="n3-an-stat-val">${_fmtNum(data.uniqueVisitors)}${visitorsBadge}</span>
          <span class="n3-an-stat-label">Visitors</span>
        </div>
        ${data.avgDuration != null ? `<div class="n3-an-stat"><span class="n3-an-stat-val">${_fmtDur(data.avgDuration)}</span><span class="n3-an-stat-label">Avg Time</span></div>` : ''}
        ${data.bounceRate  != null ? `<div class="n3-an-stat"><span class="n3-an-stat-val">${Math.round(data.bounceRate)}%</span><span class="n3-an-stat-label">Bounce</span></div>` : ''}
        ${data.realtime    != null ? `<div class="n3-an-stat"><span class="n3-an-stat-val"><span class="n3-an-pulse"></span> ${data.realtime}</span><span class="n3-an-stat-label">Right Now</span></div>` : ''}
      </div>`;

      // ── Bar chart (Chart.js) ──────────────────────────────────────────────
      let chartHtml = '';
      if (data.daily && data.daily.length) {
        chartHtml = `<div class="n3-an-chart-wrap"><p class="n3-an-chart-title">Daily Traffic — ${data.daily.length}-Day View</p><div style="position:relative;height:110px"><canvas id="n3-chart-traffic"></canvas></div></div>`;
      }

      // ── Customer Actions (events) — money section ─────────────────────────
      let eventsHtml = '';
      if (data.events && data.events.length) {
        const evRows = data.events.map(ev => {
          const trendCls   = ev.trend >= 0 ? 'n3-an-trend-up' : 'n3-an-trend-dn';
          const trendArrow = ev.trend >= 0 ? '↑' : '↓';
          const trendPct   = ev.prev ? Math.abs(Math.round((ev.count - ev.prev) / ev.prev * 100)) : 0;
          return `<div class="n3-an-event"><span class="n3-an-event-icon">${ev.icon}</span><span class="n3-an-event-label">${_esc(ev.label)}</span><span class="n3-an-event-count">${ev.count}</span><span class="n3-an-event-trend ${trendCls}">${trendArrow}${trendPct}%</span></div>`;
        }).join('');
        eventsHtml = `<div class="n3-an-section"><p class="n3-an-section-title">⚡ Customer Actions</p><div class="n3-an-events">${evRows}</div></div>`;
      }

      // ── Traffic Sources (Chart.js horizontal bar) ─────────────────────────
      let sourcesHtml = '';
      if (data.sources && data.sources.length) {
        const srcH = Math.max(data.sources.length * 28 + 10, 80);
        sourcesHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Traffic Sources</p><div style="position:relative;height:${srcH}px"><canvas id="n3-chart-sources"></canvas></div></div>`;
      }

      // ── Devices — Chart.js doughnut + stacked bar side-by-side ──────────
      let devHtml = '';
      if (data.devices && (data.devices.mobile || data.devices.desktop)) {
        const mobile  = data.devices.mobile  || 0;
        const desktop = data.devices.desktop || 0;
        const tablet  = data.devices.tablet  || 0;
        const tot = mobile + desktop + tablet || 1;
        const mP = Math.round(mobile  / tot * 100);
        const dP = Math.round(desktop / tot * 100);
        const tP = 100 - mP - dP;
        const devLegend = [
          mP ? `<div class="n3-an-legend-item"><span class="n3-an-legend-dot" style="background:${T.accent}"></span><span>Mobile</span><span class="n3-an-legend-val">${mP}% · ${_fmtNum(mobile)}</span></div>` : '',
          dP ? `<div class="n3-an-legend-item"><span class="n3-an-legend-dot" style="background:#22C55E"></span><span>Desktop</span><span class="n3-an-legend-val">${dP}% · ${_fmtNum(desktop)}</span></div>` : '',
          tP ? `<div class="n3-an-legend-item"><span class="n3-an-legend-dot" style="background:#EAB308"></span><span>Tablet</span><span class="n3-an-legend-val">${tP}% · ${_fmtNum(tablet)}</span></div>` : '',
        ].join('');
        const devBarMob  = mP ? `<div class="n3-an-device-seg" style="width:${mP}%;background:${T.accent}"></div>` : '';
        const devBarDesk = dP ? `<div class="n3-an-device-seg" style="width:${dP}%;background:#22C55E"></div>` : '';
        const devBarTab  = tP ? `<div class="n3-an-device-seg" style="width:${tP}%;background:#EAB308"></div>` : '';
        devHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Devices</p>
          <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
            <div style="position:relative;width:120px;height:120px;flex-shrink:0"><canvas id="n3-chart-devices"></canvas></div>
            <div style="flex:1;min-width:140px">
              <div class="n3-an-device-bar" style="margin-bottom:10px">${devBarMob}${devBarDesk}${devBarTab}</div>
              <div class="n3-an-legend">${devLegend}</div>
            </div>
          </div>
        </div>`;
      }

      // ── Top Pages ─────────────────────────────────────────────────────────
      let topHtml = '';
      if (data.topPages && data.topPages.length) {
        const maxPV  = Math.max(...data.topPages.map(p => p.views || p.count || 0), 1);
        const pgRows = data.topPages.map(p => {
          const v = p.views || p.count || 0;
          const w = Math.round(v / maxPV * 100);
          const avgT = p.avgTime ? ` <span style="color:${T.muted};font-size:10px">${_fmtDur(p.avgTime)}</span>` : '';
          return `<div class="n3-an-bar-row"><span class="n3-an-bar-label">${_esc(p.path)}${avgT}</span><div class="n3-an-bar-track"><div class="n3-an-bar-fill" style="width:${w}%;background:${T.accent}"></div></div><span class="n3-an-bar-val">${_fmtNum(v)}</span></div>`;
        }).join('');
        topHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Top Pages</p>${pgRows}</div>`;
      }

      // ── Referrers + Cities (2-col on desktop) ─────────────────────────────
      let refHtml = '';
      if (data.referrers && data.referrers.length) {
        const maxRef = Math.max(...data.referrers.map(r => r.visits), 1);
        const refRows = data.referrers.map(r => {
          const w = Math.round(r.visits / maxRef * 100);
          return `<div class="n3-an-bar-row"><span class="n3-an-bar-label">${_esc(r.domain)}</span><div class="n3-an-bar-track"><div class="n3-an-bar-fill" style="width:${w}%;background:#10B981"></div></div><span class="n3-an-bar-val">${_fmtNum(r.visits)}</span></div>`;
        }).join('');
        refHtml = `<div class="n3-an-section"><p class="n3-an-section-title">Referrers</p>${refRows}</div>`;
      }

      let citiesHtml = '';
      if (data.cities && data.cities.length) {
        const citH = Math.max(data.cities.length * 28 + 10, 80);
        citiesHtml = `<div class="n3-an-section"><p class="n3-an-section-title">📍 Top Cities</p><div style="position:relative;height:${citH}px"><canvas id="n3-chart-cities"></canvas></div></div>`;
      }

      const geoBlock = (refHtml || citiesHtml)
        ? `<div class="n3-an-2col">${refHtml}${citiesHtml}</div>` : '';

      const connectHtml = !data.gaConnected && this._cfg
        ? `<div class="n3-an-connect-prompt"><span>📊</span><span>Connect Google Analytics for real-time data — available in dashboard settings</span></div>` : '';

      const allHtml = statsHtml + chartHtml + eventsHtml + sourcesHtml + devHtml + topHtml + geoBlock + connectHtml;
      body.innerHTML = allHtml;

      // ── Init N3Chart instances after DOM is ready ─────────────────────────

      // 1. Traffic bar chart
      if (data.daily && data.daily.length) {
        this._makeChart('n3-chart-traffic', {
          type: 'bar',
          data: {
            labels:   data.daily.map(d => d.label || d.date.slice(5)),
            datasets: [{ data: data.daily.map(d => d.views), backgroundColor: T.accent }],
          },
          options: { indexAxis: 'x', scales: { y: { beginAtZero: true } } },
        });
      }

      // 2. Device doughnut
      if (data.devices && (data.devices.mobile || data.devices.desktop)) {
        const mobile  = data.devices.mobile  || 0;
        const desktop = data.devices.desktop || 0;
        const tablet  = data.devices.tablet  || 0;
        const tot = mobile + desktop + tablet || 1;
        const domLabel = mobile >= desktop ? 'Mobile' : 'Desktop';
        const domPct   = Math.round((mobile >= desktop ? mobile : desktop) / tot * 100);
        this._makeChart('n3-chart-devices', {
          type: 'doughnut',
          data: {
            labels:   ['Mobile', 'Desktop', 'Tablet'],
            datasets: [{ data: [mobile, desktop, tablet], backgroundColor: [T.accent, '#22C55E', '#EAB308'] }],
          },
          options: { centerText: domPct + '%', centerSubtext: domLabel },
        });
      }

      // 3. Traffic sources horizontal bar
      if (data.sources && data.sources.length) {
        const srcColors = [T.accent, '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', T.muted];
        this._makeChart('n3-chart-sources', {
          type: 'bar',
          data: {
            labels:   data.sources.map(s => s.source),
            datasets: [{ data: data.sources.map(s => s.sessions), backgroundColor: data.sources.map((_, i) => srcColors[i % srcColors.length]) }],
          },
          options: { indexAxis: 'y', scales: { x: { beginAtZero: true } } },
        });
      }

      // 4. Cities horizontal bar
      if (data.cities && data.cities.length) {
        this._makeChart('n3-chart-cities', {
          type: 'bar',
          data: {
            labels:   data.cities.map(c => c.city),
            datasets: [{ data: data.cities.map(c => c.count), backgroundColor: '#8B5CF6' }],
          },
          options: { indexAxis: 'y', scales: { x: { beginAtZero: true } } },
        });
      }
    }
  }

  Object.assign(window._n3wareModules, { N3Analytics, N3ScriptPlaceholders });
})();
