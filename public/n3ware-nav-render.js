/**
 * n3ware-nav-render.js — Nav render: data model → full fixed <nav> with mobile drawer.
 * Attaches: window._n3wareNav.{esc, parseNav, renderedHtml, render, _wireMobileNav}
 */
(function () { 'use strict';
  window._n3wareNav = window._n3wareNav || {};

  const MENU_SVG  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;
  const CLOSE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  /** HTML-escape a value for attribute or text content. */
  window._n3wareNav.esc = function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  /**
   * Bootstrap a nav data model by parsing the existing <nav> element's DOM.
   * Prefers [data-n3-primary-nav], skips [data-n3-sub-nav], falls back to first plain <nav>.
   */
  window._n3wareNav.parseNav = function parseNav(hintEl) {
    const brand = { text: '', logoUrl: '', href: '/' };
    const items = [];

    // Prefer the primary-nav attribute; skip sub-navs
    let navEl = hintEl;
    if (navEl && navEl.hasAttribute('data-n3-sub-nav')) navEl = null;
    if (!navEl) navEl = document.querySelector('[data-n3-primary-nav]');
    if (!navEl) {
      const all = Array.from(document.querySelectorAll('nav'));
      navEl = all.find(n => !n.hasAttribute('data-n3-sub-nav')) || null;
    }

    if (!navEl) {
      return { brand, items, cta: { label: 'Get Started', href: '#', enabled: false } };
    }

    const links = Array.from(navEl.querySelectorAll('a'));
    const brandLink = navEl.querySelector('a.font-bold,a[class*="brand"],a[class*="logo"]') || links[0];
    if (brandLink) {
      const img = brandLink.querySelector('img');
      brand.href = brandLink.getAttribute('href') || '/';
      if (img) {
        brand.logoUrl = img.src || '';
        brand.text    = (brandLink.textContent || '').replace(img.alt || '', '').trim();
      } else {
        brand.text = (brandLink.textContent || '').trim();
      }
    }

    const navLinks = brandLink ? links.filter(l => l !== brandLink) : links;
    navLinks.forEach((a, i) => {
      const label = (a.textContent || '').trim();
      if (label) {
        items.push({
          id:    'item-' + Date.now() + '-' + i,
          label,
          href:  a.getAttribute('href') || '#',
          type:  'link',
        });
      }
    });

    return { brand, items, cta: { label: 'Get Started', href: '#', enabled: false } };
  };

  /**
   * Generate the full outer <nav> HTML string from inst._data.
   * Returns a fixed top nav with desktop layout + mobile hamburger + slide-in drawer.
   */
  window._n3wareNav.renderedHtml = function renderedHtml(inst) {
    const d = inst._data;
    const e = window._n3wareNav.esc;

    const brandContent = d.brand.logoUrl
      ? `<img src="${e(d.brand.logoUrl)}" alt="${e(d.brand.text)}" class="h-8 w-auto">`
      : `<span class="font-bold text-xl tracking-tight">${e(d.brand.text)}</span>`;

    const desktopItems = d.items.map(item => {
      if (item.type === 'button') {
        return `<a href="${e(item.href)}" class="px-4 py-1.5 rounded bg-primary text-white text-sm font-medium hover:opacity-90 transition">${e(item.label)}</a>`;
      }
      return `<a href="${e(item.href)}" class="text-sm font-medium hover:text-primary transition">${e(item.label)}</a>`;
    }).join('\n      ');

    const mobileItems = d.items.map(item => {
      if (item.type === 'button') {
        return `<a href="${e(item.href)}" class="block px-4 py-3 rounded bg-primary text-white text-sm font-medium text-center">${e(item.label)}</a>`;
      }
      return `<a href="${e(item.href)}" class="block px-4 py-3 text-sm font-medium border-b border-stone-100 hover:bg-stone-50 transition">${e(item.label)}</a>`;
    }).join('\n        ');

    const ctaDesktop = (d.cta && d.cta.enabled)
      ? `<a href="${e(d.cta.href)}" class="hidden md:inline-flex px-4 py-1.5 rounded bg-primary text-white text-sm font-semibold hover:opacity-90 transition">${e(d.cta.label)}</a>`
      : '';

    const ctaMobile = (d.cta && d.cta.enabled)
      ? `<a href="${e(d.cta.href)}" class="block mx-4 mt-3 px-4 py-2.5 rounded bg-primary text-white text-sm font-semibold text-center hover:opacity-90 transition">${e(d.cta.label)}</a>`
      : '';

    return `<nav data-n3-primary-nav data-n3-block="1" class="fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-b border-stone-200 transition-shadow h-16">
  <div class="container mx-auto px-6 flex items-center justify-between h-full">
    <a href="${e(d.brand.href)}" class="flex items-center gap-2 shrink-0">
      ${brandContent}
    </a>
    <div class="hidden md:flex items-center gap-6">
      ${desktopItems}
    </div>
    <div class="hidden md:flex items-center gap-3">
      ${ctaDesktop}
    </div>
    <button class="n3-nav-hamburger md:hidden flex items-center justify-center w-9 h-9 rounded hover:bg-stone-100 text-current transition" aria-label="Open menu" aria-expanded="false">
      ${MENU_SVG}
    </button>
  </div>

  <!-- Mobile backdrop -->
  <div class="n3-nav-backdrop fixed inset-0 z-40 bg-black/40 opacity-0 pointer-events-none transition-opacity duration-200" aria-hidden="true"></div>

  <!-- Mobile drawer -->
  <div class="n3-nav-drawer fixed top-0 right-0 bottom-0 z-50 w-72 max-w-full bg-white shadow-xl flex flex-col translate-x-full transition-transform duration-300 ease-in-out">
    <div class="flex items-center justify-between px-4 py-4 border-b border-stone-100">
      <span class="font-semibold text-sm">${e(d.brand.text || 'Menu')}</span>
      <button class="n3-nav-close flex items-center justify-center w-8 h-8 rounded hover:bg-stone-100 transition" aria-label="Close menu">
        ${CLOSE_SVG}
      </button>
    </div>
    <nav class="flex-1 overflow-y-auto py-2">
      ${mobileItems}
    </nav>
    ${ctaMobile ? `<div class="pb-6">${ctaMobile}</div>` : ''}
  </div>
</nav>`;
  };

  /** Wire hamburger / backdrop / close / link-click behaviour on the primary nav. */
  window._n3wareNav._wireMobileNav = function _wireMobileNav(navEl) {
    if (!navEl) return;
    const hamburger = navEl.querySelector('.n3-nav-hamburger');
    const backdrop  = navEl.querySelector('.n3-nav-backdrop');
    const drawer    = navEl.querySelector('.n3-nav-drawer');
    const closeBtn  = navEl.querySelector('.n3-nav-close');
    if (!hamburger || !drawer) return;

    function openDrawer() {
      drawer.classList.remove('translate-x-full');
      drawer.classList.add('translate-x-0');
      if (backdrop) {
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
        backdrop.classList.add('opacity-100');
      }
      hamburger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      drawer.classList.add('translate-x-full');
      drawer.classList.remove('translate-x-0');
      if (backdrop) {
        backdrop.classList.add('opacity-0', 'pointer-events-none');
        backdrop.classList.remove('opacity-100');
      }
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', e => { e.stopPropagation(); openDrawer(); });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    // Close when any nav link in the drawer is clicked
    drawer.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => { setTimeout(closeDrawer, 150); });
    });
  };

  /** Replace the live primary nav with freshly rendered HTML, wire mobile, add pt-16 to <main>. */
  window._n3wareNav.render = function render(inst) {
    const html = window._n3wareNav.renderedHtml(inst);

    // Swap existing nav or insert at top of <body>
    let navEl = inst._navEl || document.querySelector('[data-n3-primary-nav]');
    if (!navEl) navEl = Array.from(document.querySelectorAll('nav')).find(n => !n.hasAttribute('data-n3-sub-nav'));

    if (navEl) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const newNav = tmp.firstElementChild;
      navEl.replaceWith(newNav);
      inst._navEl = newNav;
    } else {
      document.body.insertAdjacentHTML('afterbegin', html);
      inst._navEl = document.querySelector('[data-n3-primary-nav]');
    }

    window._n3wareNav._wireMobileNav(inst._navEl);

    // Ensure <main> has top padding to clear the fixed nav
    const main = document.querySelector('main');
    if (main && !main.classList.contains('pt-16')) {
      main.classList.add('pt-16');
    }

    // Trigger Tailwind CDN to pick up any new utility classes in the rendered nav
    setTimeout(() => { try { window.tailwind && window.tailwind.refresh && window.tailwind.refresh(); } catch (_) {} }, 0);
  };

})();
