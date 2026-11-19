/* Small stability improvements: independent Files navigation, mount-location picker,
   and non-sensitive workspace state. This file runs after panel.js. */
(() => {
  'use strict';
  const key = 'yrm-panel:last-workspace-route';
  const allowed = /^\/(?:Files|Settings|Docker|Applications|Features|Shares|Services)(?:\?|$)/;
  const get = id => document.getElementById(id);
  const saveRoute = () => {
    const route = location.pathname + location.search;
    if (!allowed.test(route)) return;
    try { sessionStorage.setItem(key, route); } catch { /* unavailable in private mode */ }
  };
  const push = history.pushState;
  history.pushState = function (...args) { const out = push.apply(this,args); saveRoute(); return out; };
  const replace = history.replaceState;
  history.replaceState = function (...args) { const out = replace.apply(this,args); saveRoute(); return out; };
  window.addEventListener('popstate', saveRoute);
  const fileNavKey = 'yrm-panel:system-files-open';

  function restoreDisclosure() {
    document.querySelectorAll('details[data-persist-disclosure]').forEach(node => {
      if (!(node instanceof HTMLDetailsElement) || node.dataset.restored === '1') return;
      node.dataset.restored = '1';
      try { node.open = sessionStorage.getItem(fileNavKey) === '1'; } catch { node.open = false; }
    });
  }
  document.addEventListener('toggle', event => {
    const node = event.target;
    if (!(node instanceof HTMLDetailsElement) || !node.isConnected ||
        !node.matches('details[data-persist-disclosure]')) return;
    try { sessionStorage.setItem(fileNavKey,node.open ? '1' : '0'); } catch {}
  },true);
  restoreDisclosure();

  const observer = new MutationObserver(restoreDisclosure);
  observer.observe(document.body,{childList:true,subtree:true});

  // Restore the last in-tab application after login or a hard refresh.
  // Only route names known to the Panel shell are accepted, never arbitrary URLs.
  const initial=location.pathname;
  if (initial==='/' || initial==='/Index') {
    try {
      const last=sessionStorage.getItem(key);
      if (last && allowed.test(last)) {
        const link=document.createElement('a');link.href=last;
        document.body.append(link);
        requestAnimationFrame(()=>{link.click();link.remove();});
      }
    } catch { /* not essential */ }
  } else saveRoute();
})();
