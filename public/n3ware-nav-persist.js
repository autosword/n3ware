/**
 * n3ware-nav-persist.js — Nav state load/save (localStorage + cloud API).
 * Attaches: window._n3wareNav.{loadState, saveState}
 *
 * Storage shape: localStorage key `n3_nav` → { [pathname]: navDataObject }
 */
(function () { 'use strict';
  window._n3wareNav = window._n3wareNav || {};

  /** Load nav state into inst._data. Priority: server-injected → localStorage → DOM parse. */
  window._n3wareNav.loadState = function loadState(inst, navEl) {
    if (window.__n3NavData) {
      inst._data = JSON.parse(JSON.stringify(window.__n3NavData));
      return;
    }
    try {
      const raw = localStorage.getItem('n3_nav');
      if (raw) {
        const all = JSON.parse(raw);
        const saved = all[location.pathname];
        if (saved) { inst._data = saved; return; }
      }
    } catch (_) {}
    inst._data = window._n3wareNav.parseNav(navEl || document.querySelector('nav'));
  };

  /**
   * Persist inst._data to localStorage and (if authenticated) to the cloud API.
   * Sends both the data model and the current rendered outerHTML of the <nav>.
   */
  window._n3wareNav.saveState = function saveState(inst) {
    try {
      const raw = localStorage.getItem('n3_nav');
      const all = raw ? JSON.parse(raw) : {};
      all[location.pathname] = inst._data;
      localStorage.setItem('n3_nav', JSON.stringify(all));
    } catch (_) {}

    if (inst._cloud) {
      const navEl = inst._navEl || document.querySelector('nav');
      const jwt   = document.cookie.match(/n3_token=([^;]+)/)?.[1]
                 || sessionStorage.getItem('n3_auth');
      const headers = { 'Content-Type': 'application/json' };
      if (jwt)              headers['Authorization'] = 'Bearer ' + jwt;
      else if (inst._cloud.key) headers['X-API-Key'] = inst._cloud.key;

      fetch(inst._cloud.api + '/sites/' + inst._cloud.site + '/nav', {
        method:      'PUT',
        headers,
        credentials: 'include',
        body:        JSON.stringify({ nav: inst._data, html: navEl ? navEl.outerHTML : '' }),
      }).catch(e => console.error('[n3-nav] cloud save failed:', e));
    }
  };

})();
