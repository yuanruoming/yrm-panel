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

  async function drawFolderTree(relative,tree) {
    if (!tree) return;
    try {
      const params = new URLSearchParams({handler:'Tree',path:relative});
      const response = await fetch(`/Files?${params}`,{credentials:'same-origin',cache:'no-store'});
      if (!response.ok) throw new Error('Cannot browse the selected location.');
      const data = await response.json();
      tree.replaceChildren();
      function button(label,path) {
        const node = document.createElement('button');node.type='button';node.className='explorer-tree-item';
        node.textContent=label;
        node.addEventListener('click',()=>{chooseParent(path);void drawFolderTree(path,tree);});
        tree.append(node);
      }
      if (data.path) button('↰  ..', data.path.split('/').slice(0,-1).join('/'));
      for (const folder of data.folders || [])
        button(`📁  ${folder}`, data.path ? `${data.path}/${folder}` : folder);
      if (!data.folders?.length) tree.append(document.createTextNode('No subfolders.'));
    } catch (error) { tree.replaceChildren(document.createTextNode(error.message)); }
  }
  function chooseParent(path) {
    const parent=get('new-folder-parent'),tree=get('new-folder-tree');
    if (!(parent instanceof HTMLInputElement)) return;
    parent.value=path;
    if (tree) tree.dataset.initialFolder=path;
    const name=document.querySelector('#new-folder-dialog input[name="name"]');
    const display=get('new-folder-full-path');
    if (display) display.textContent=`/${path ? `${path}/` : ''}${name?.value || ''}`;
    const volume=get('yrm-folder-volume');
    if (volume instanceof HTMLSelectElement) {
      const known=Array.from(volume.options).filter(o=>o.value && (path===o.value||path.startsWith(o.value+'/')));
      known.sort((a,b)=>b.value.length-a.value.length);
      if (known.length) volume.value=known[0].value;
      else if (!path) volume.selectedIndex=0;
      else volume.selectedIndex=-1;
    }
  }
  document.addEventListener('change',event => {
    const node=event.target;
    if (!(node instanceof HTMLSelectElement) || node.id!=='yrm-folder-volume') return;
    chooseParent(node.value);
    void drawFolderTree(node.value,get('new-folder-tree'));
  },true);

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
