'use strict';

/**
 * tracker-scripts.js — third-party tracking/analytics script templates.
 *
 * Each entry:
 *   key          — unique identifier used in site integrations config
 *   name         — human-readable name
 *   category     — 'analytics' | 'social' | 'advertising' | 'other'
 *   icon         — emoji
 *   description  — one-liner shown in the dashboard
 *   fields       — array of { name, label, placeholder, type:'id'|'code', required }
 *   generateScript(config) — returns the raw HTML to inject into <head>
 */

const INTEGRATIONS = [
  // ── Analytics ──────────────────────────────────────────────────────────────
  {
    key: 'google-analytics',
    name: 'Google Analytics (GA4)',
    category: 'analytics',
    icon: '📊',
    lucideIcon: 'chart-bar',
    description: 'Track visitors, page views, and conversions',
    fields: [{ name: 'measurementId', label: 'Measurement ID', placeholder: 'G-XXXXXXXXXX', type: 'id', required: true }],
    generateScript(c) {
      return `<script async src="https://www.googletagmanager.com/gtag/js?id=${c.measurementId}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${c.measurementId}');</script>`;
    },
  },
  {
    key: 'google-tag-manager',
    name: 'Google Tag Manager',
    category: 'analytics',
    icon: '🏷️',
    lucideIcon: 'tag',
    description: 'Manage all your tags in one place',
    fields: [{ name: 'containerId', label: 'Container ID', placeholder: 'GTM-XXXXXXX', type: 'id', required: true }],
    generateScript(c) {
      return `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${c.containerId}');</script>`;
    },
  },
  {
    key: 'clarity',
    name: 'Microsoft Clarity',
    category: 'analytics',
    icon: '🔍',
    lucideIcon: 'search',
    description: 'Heatmaps, session recordings, and user behavior insights',
    fields: [{ name: 'projectId', label: 'Project ID', placeholder: 'abc123xyz', type: 'id', required: true }],
    generateScript(c) {
      return `<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${c.projectId}");</script>`;
    },
  },
  {
    key: 'plausible',
    name: 'Plausible Analytics',
    category: 'analytics',
    icon: '📈',
    lucideIcon: 'trending-up',
    description: 'Privacy-friendly analytics, no cookies',
    fields: [{ name: 'domain', label: 'Domain', placeholder: 'yourdomain.com', type: 'id', required: true }],
    generateScript(c) {
      return `<script defer data-domain="${c.domain}" src="https://plausible.io/js/script.js"></script>`;
    },
  },
  {
    key: 'hotjar',
    name: 'Hotjar',
    category: 'analytics',
    icon: '🔥',
    lucideIcon: 'flame',
    description: 'Heatmaps, recordings, and user feedback',
    fields: [{ name: 'siteId', label: 'Site ID', placeholder: '1234567', type: 'id', required: true }],
    generateScript(c) {
      return `<script>(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${c.siteId},hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');</script>`;
    },
  },

  // ── Social Media Pixels ────────────────────────────────────────────────────
  {
    key: 'meta-pixel',
    name: 'Meta (Facebook) Pixel',
    category: 'social',
    icon: '📘',
    lucideIcon: 'facebook',
    description: 'Track conversions from Facebook & Instagram ads',
    fields: [{ name: 'pixelId', label: 'Pixel ID', placeholder: '123456789012345', type: 'id', required: true }],
    generateScript(c) {
      return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${c.pixelId}');fbq('track','PageView');</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${c.pixelId}&ev=PageView&noscript=1"/></noscript>`;
    },
  },
  {
    key: 'tiktok-pixel',
    name: 'TikTok Pixel',
    category: 'social',
    icon: '🎵',
    lucideIcon: 'music',
    description: 'Track conversions from TikTok ads',
    fields: [{ name: 'pixelId', label: 'Pixel ID', placeholder: 'CXXXXXXXXXXXXXXXXX', type: 'id', required: true }],
    generateScript(c) {
      return `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${c.pixelId}');ttq.page();}(window,document,'ttq');</script>`;
    },
  },
  {
    key: 'twitter-pixel',
    name: 'X (Twitter) Pixel',
    category: 'social',
    icon: '🐦',
    lucideIcon: 'twitter',
    description: 'Track conversions from X/Twitter ads',
    fields: [{ name: 'pixelId', label: 'Pixel ID', placeholder: 'xxxxx', type: 'id', required: true }],
    generateScript(c) {
      return `<script>!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','${c.pixelId}');</script>`;
    },
  },
  {
    key: 'pinterest-tag',
    name: 'Pinterest Tag',
    category: 'social',
    icon: '📌',
    lucideIcon: 'pin',
    description: 'Track conversions from Pinterest ads',
    fields: [{ name: 'tagId', label: 'Tag ID', placeholder: '1234567890123', type: 'id', required: true }],
    generateScript(c) {
      return `<script>!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk('load','${c.tagId}');pintrk('page');</script>`;
    },
  },
  {
    key: 'linkedin-insight',
    name: 'LinkedIn Insight Tag',
    category: 'social',
    icon: '💼',
    lucideIcon: 'briefcase',
    description: 'Track conversions from LinkedIn ads',
    fields: [{ name: 'partnerId', label: 'Partner ID', placeholder: '123456', type: 'id', required: true }],
    generateScript(c) {
      return `<script type="text/javascript">_linkedin_partner_id="${c.partnerId}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);</script><script type="text/javascript">(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})(window.lintrk);</script>`;
    },
  },
  {
    key: 'snapchat-pixel',
    name: 'Snapchat Pixel',
    category: 'social',
    icon: '👻',
    lucideIcon: 'ghost',
    description: 'Track conversions from Snapchat ads',
    fields: [{ name: 'pixelId', label: 'Pixel ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', type: 'id', required: true }],
    generateScript(c) {
      return `<script type='text/javascript'>(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${c.pixelId}',{});snaptr('track','PAGE_VIEW');</script>`;
    },
  },

  // ── Advertising ────────────────────────────────────────────────────────────
  {
    key: 'google-ads',
    name: 'Google Ads Conversion',
    category: 'advertising',
    icon: '💰',
    lucideIcon: 'dollar-sign',
    description: 'Track Google Ads conversions',
    fields: [
      { name: 'conversionId',    label: 'Conversion ID',              placeholder: 'AW-123456789', type: 'id', required: true  },
      { name: 'conversionLabel', label: 'Conversion Label (optional)', placeholder: 'AbCdEfGh',    type: 'id', required: false },
    ],
    generateScript(c) {
      return `<script async src="https://www.googletagmanager.com/gtag/js?id=${c.conversionId}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${c.conversionId}');</script>`;
    },
  },

  // ── Other ──────────────────────────────────────────────────────────────────
  {
    key: 'custom-script',
    name: 'Custom Script',
    category: 'other',
    icon: '🔧',
    lucideIcon: 'code',
    description: 'Paste any custom script tag',
    fields: [{ name: 'code', label: 'Script Code', placeholder: '<script>...</script>', type: 'code', required: true }],
    generateScript(c) {
      return c.code;
    },
  },
];

/** Map for O(1) lookup by key. */
const INTEGRATIONS_MAP = Object.fromEntries(INTEGRATIONS.map(i => [i.key, i]));

/**
 * Wrap a script HTML string with n3 comment markers.
 * Format: <!-- n3:script:KEY:start --> ... <!-- n3:script:KEY:end -->
 * @param {string} key
 * @param {string} scriptHtml
 * @returns {string}
 */
function wrapScript(key, scriptHtml) {
  return `<!-- n3:script:${key}:start -->\n${scriptHtml}\n<!-- n3:script:${key}:end -->`;
}

/**
 * Generate all enabled script tags for a site's integrations config.
 * Each script is wrapped with n3 comment markers for editor detection.
 * @param {Object} integrationsConfig  e.g. { 'google-analytics': { enabled: true, measurementId: 'G-XXX' } }
 * @returns {string}  concatenated HTML to inject into <head>
 */
function generateScripts(integrationsConfig) {
  if (!integrationsConfig) return '';
  const parts = [];
  for (const [key, cfg] of Object.entries(integrationsConfig)) {
    if (!cfg || !cfg.enabled) continue;
    const integration = INTEGRATIONS_MAP[key];
    if (!integration) continue;
    try {
      parts.push(wrapScript(key, integration.generateScript(cfg)));
    } catch (e) {
      console.warn(`[integrations] generateScript failed for ${key}:`, e.message);
    }
  }
  return parts.join('\n');
}

module.exports = { INTEGRATIONS, INTEGRATIONS_MAP, generateScripts, wrapScript };
