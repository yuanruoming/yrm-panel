/* Files folder navigation: immediate chevron expand, static folder icon.
   Clicking a folder selects it; double-click navigates without a fixed delay.
   Folder labels carry data-fm-href instead of href, so hovering never shows a
   browser status-bar URL; the desktop shell performs the navigation. */
(() => {
  'use strict';
  const cache = new Map();
  const pendingLoads = new Map();
  const route = (path, library = false) => {
    const url = new URL('/Files', location.origin);
    url.searchParams.set('path', path);
    if (library) url.searchParams.set('nav', 'library');
    return url.pathname + url.search;
  };
  async function loadFolders(path) {
    const cached = cache.get(path);
    if (cached && Date.now() - cached.at < 6000) return cached.folders;
    if (pendingLoads.has(path)) return pendingLoads.get(path);
    const task = (async () => {
      const url = new URL('/Files', location.origin);
      url.searchParams.set('handler', 'Tree');
      url.searchParams.set('path', path);
      const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', headers: {'Accept': 'application/json'}});
      if (!response.ok || response.redirected) throw new Error(`Could not read folder (HTTP ${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data?.folders)) throw new Error('Invalid folder response.');
      const folders = (Array.isArray(data.folderNodes) ? data.folderNodes : data.folders.map(name => ({name})))
        .filter(item => item && typeof item.name === 'string' && item.name && item.name !== '.' && item.name !== '..');
      cache.set(path, {folders, at:Date.now()});
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return folders;
    })();
    pendingLoads.set(path, task);
    try {return await task;} finally {if(pendingLoads.get(path) === task) pendingLoads.delete(path);}
  }
  function folderNode(path, name, library) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fm-tree-node';
    wrapper.dataset.fmTreeRoot = path;
    const header = document.createElement('div');
    header.className = 'fm-tree-node-header';
    const link = document.createElement('a');
    link.className = 'fm-location-link fm-tree-folder';
    link.dataset.fmHref = route(path, library);
    link.dataset.fmTreeFolder = '';
    link.dataset.fmTreePath = path;
    link.setAttribute('role', 'link');
    link.tabIndex = 0;
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'fm-folder-expand';
    expand.dataset.fmExpand = '';
    expand.dataset.fmTreePath = path;
    expand.setAttribute('aria-expanded', 'false');
    expand.setAttribute('aria-label', 'Expand or collapse ' + name);
    const chevron = document.createElementNS('http://www.w3.org/2000/svg','svg');
    chevron.classList.add('ui-icon', 'fm-folder-chevron');
    chevron.setAttribute('aria-hidden','true');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg','use');
    arrow.setAttribute('href','#i-chevron');
    chevron.append(arrow);
    expand.append(chevron);
    const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.classList.add('ui-icon', 'fm-folder-icon');
    icon.setAttribute('aria-hidden','true');
    const use = document.createElementNS('http://www.w3.org/2000/svg','use');
    use.setAttribute('href','#i-folder');
    icon.append(use);
    const label = document.createElement('span');
    label.textContent = name;
    link.append(icon,label);
    header.append(expand,link);
    const descendants = document.createElement('div');
    descendants.className = 'fm-tree-descendants';
    descendants.hidden = true;
    wrapper.append(header, descendants);
    return wrapper;
  }
  function renderChildren(host, folders, path, library) {
    host.replaceChildren();
    for (const item of folders) {
      const childPath = path ? path.replace(/\/$/, '') + '/' + item.name : item.name;
      host.append(folderNode(childPath, item.name, library));
    }
  }
  async function toggleInline(row) {
    const path = row.dataset.fmInlineRoot;
    if (!path) return;
    const expanding = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(expanding));
    row.querySelector(':scope > .explorer-name [data-fm-expand]')?.setAttribute('aria-expanded', String(expanding));
    let preview = row.nextElementSibling;
    if (!expanding) {
      if (preview?.classList.contains('fm-tree-preview-row')) preview.hidden = true;
      return;
    }
    if (preview?.classList.contains('fm-tree-preview-row') && preview.dataset.loaded === '1') {
      preview.hidden = false;
      return;
    }
    try {
      const folders = await loadFolders(path);
      if (!row.isConnected || row.getAttribute('aria-expanded') !== 'true' || !folders.length) return;
      preview = row.nextElementSibling;
      if (!preview?.classList.contains('fm-tree-preview-row')) {
        preview = document.createElement('tr');
        preview.className = 'fm-tree-preview-row';
        const td = document.createElement('td');
        td.colSpan = row.querySelectorAll(':scope > td').length;
        const host = document.createElement('div');
        host.className = 'fm-inline-preview';
        td.append(host);
        preview.append(td);
        row.after(preview);
      }
      renderChildren(preview.querySelector('.fm-inline-preview'), folders, path, false);
      preview.dataset.loaded = '1';
      preview.hidden = false;
    } catch (error) {
      row.setAttribute('aria-expanded', 'false');
      row.querySelector(':scope > .explorer-name [data-fm-expand]')?.setAttribute('aria-expanded', 'false');
      console.warn('Files folder preview could not load:', error);
    }
  }
  async function toggleNested(expand) {
    const wrapper = expand.closest('.fm-tree-node');
    const children = wrapper?.querySelector(':scope > .fm-tree-descendants');
    if (!children) return;
    const expanding = expand.getAttribute('aria-expanded') !== 'true';
    expand.setAttribute('aria-expanded', String(expanding));
    children.hidden = !expanding;
    if (!expanding || children.dataset.loaded === '1') {
      if (expanding && children.dataset.hasChildren === '0') children.hidden = true;
      return;
    }
    try {
      const folders = await loadFolders(expand.dataset.fmTreePath || '');
      if (!children.isConnected || expand.getAttribute('aria-expanded') !== 'true') return;
      renderChildren(children, folders, expand.dataset.fmTreePath || '', false);
      children.dataset.hasChildren = folders.length ? '1' : '0';
      children.dataset.loaded = '1';
      children.hidden = !folders.length;
    } catch (error) {
      expand.setAttribute('aria-expanded', 'false');
      children.hidden = true;
      console.warn('Files nested folder preview could not load:', error);
    }
  }
  // Intercept only the exact folder link whose single click must select.
  // Do not cancel clicks on other links, controls or empty row space: the
  // existing desktop shell and Files selection handler already own them.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.fm-explorer')) return;
    const expand = target.closest('[data-fm-expand]');
    if (expand) {
      if (event.button !== 0) return;
      event.preventDefault();
      const row = expand.closest('tr[data-fm-inline-root]');
      if (row) void toggleInline(row);
      else void toggleNested(expand);
      return;
    }
    const folderLink = target.closest('a[data-fm-inline-folder],a[data-fm-tree-folder]');
    if (folderLink && folderLink.dataset.fmNavigate !== '1' && event.button === 0 &&
        !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey)
      event.preventDefault(); // Only a folder label needs double-click to navigate.
  }, true);
  function navigateFolder(anchor) {
    const href = anchor?.dataset.fmHref;
    if (!href) return false;
    window.dispatchEvent(new CustomEvent('yrm-panel:navigate', {detail: href}));
    return true;
  }
  document.addEventListener('dblclick', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.fm-explorer') || event.button !== 0 ||
        target.closest('[data-fm-expand],.explorer-item-menu,details,summary,form,input,textarea,select,button,[contenteditable="true"]')) return;
    const anchor = target.closest('[data-fm-href]') ||
      target.closest('.fm-tree-node-header')?.querySelector('[data-fm-href]') ||
      target.closest('tr[data-fm-inline-root]')?.querySelector('[data-fm-href]');
    if (!anchor) return;
    event.preventDefault();
    anchor.dataset.fmNavigate = '1';
    try {
      if (!navigateFolder(anchor)) anchor.click();
    } finally {
      delete anchor.dataset.fmNavigate;
    }
  }, true);
  // Keyboard parity with the removed href: Enter opens the selected folder.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest('[data-fm-href]');
    if (!anchor || !anchor.closest('.fm-explorer')) return;
    event.preventDefault();
    navigateFolder(anchor);
  }, true);
  // Prefetch child names on intent so first expansion can paint immediately.
  // No rendering, icon rotation or loading animation happens on hover.
  let hoverTimer = null;
  document.addEventListener('pointerover', event => {
    if (!(event.target instanceof Element)) return;
    const folder = event.target.closest('[data-fm-tree-folder],tr[data-fm-inline-root]');
    if (!folder || (event.relatedTarget instanceof Node && folder.contains(event.relatedTarget))) return;
    const path = folder.dataset.fmTreePath || folder.dataset.fmInlineRoot;
    if (!path) return;
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      void loadFolders(path).catch(() => {});
    }, 110);
  }, true);
  document.addEventListener('pointerout', event => {
    if (hoverTimer === null || !(event.target instanceof Element)) return;
    const folder = event.target.closest('[data-fm-tree-folder],tr[data-fm-inline-root]');
    if (folder && !(event.relatedTarget instanceof Node && folder.contains(event.relatedTarget))) {
      clearTimeout(hoverTimer); hoverTimer = null;
    }
  }, true);
  window.addEventListener('yrm-panel:files-data-changed', () => cache.clear());
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.fm-history-refresh')) cache.clear();
  });
})();
