/* Files folder navigation: one static folder icon, one row, two deliberate actions.
   Single click toggles its children; double click navigates to that folder.
   Preserve native links for navigation in the desktop shell and without JavaScript. */
(() => {
  'use strict';
  const cache = new Map();
  const pending = new Map();
  const clickDelay = 240; // Hold the first click until a possible double-click is ruled out.
  const route = (path, library = false) => {
    const url = new URL('/Files', location.origin);
    url.searchParams.set('path', path);
    if (library) url.searchParams.set('nav', 'library');
    return url.pathname + url.search;
  };
  async function loadFolders(path) {
    if (cache.has(path)) return cache.get(path);
    const url = new URL('/Files', location.origin);
    url.searchParams.set('handler', 'Tree');
    url.searchParams.set('path', path);
    const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', headers: {'Accept': 'application/json'}});
    if (!response.ok || response.redirected) throw new Error(`Could not read folder (HTTP ${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data?.folders)) throw new Error('Invalid folder response.');
    const folders = (Array.isArray(data.folderNodes) ? data.folderNodes : data.folders.map(name => ({name})))
      .filter(item => item && typeof item.name === 'string' && item.name && item.name !== '.' && item.name !== '..');
    cache.set(path, folders);
    return folders;
  }
  function folderNode(path, name, library) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fm-tree-node';
    wrapper.dataset.fmTreeRoot = path;
    const header = document.createElement('div');
    header.className = 'fm-tree-node-header';
    const link = document.createElement('a');
    link.className = 'fm-location-link fm-tree-folder';
    link.href = route(path, library);
    link.dataset.fmTreeFolder = '';
    link.dataset.fmTreePath = path;
    link.setAttribute('aria-expanded', 'false');
    link.title = 'Click to expand or collapse; double-click to open';
    const chevron = document.createElementNS('http://www.w3.org/2000/svg','svg');
    chevron.classList.add('ui-icon', 'fm-folder-chevron');
    chevron.setAttribute('aria-hidden','true');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg','use');
    arrow.setAttribute('href','#i-chevron');
    chevron.append(arrow);
    const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.classList.add('ui-icon', 'fm-folder-icon');
    icon.setAttribute('aria-hidden','true');
    const use = document.createElementNS('http://www.w3.org/2000/svg','use');
    use.setAttribute('href','#i-folder');
    icon.append(use);
    const label = document.createElement('span');
    label.textContent = name;
    link.append(chevron,icon,label);
    header.append(link);
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
      console.warn('Files folder preview could not load:', error);
    }
  }
  async function toggleNested(link) {
    const wrapper = link.closest('.fm-tree-node');
    const children = wrapper?.querySelector(':scope > .fm-tree-descendants');
    if (!children) return;
    const expanding = link.getAttribute('aria-expanded') !== 'true';
    link.setAttribute('aria-expanded', String(expanding));
    children.hidden = !expanding;
    if (!expanding || children.dataset.loaded === '1') {
      if (expanding && children.dataset.hasChildren === '0') children.hidden = true;
      return;
    }
    try {
      const folders = await loadFolders(link.dataset.fmTreePath || '');
      if (!children.isConnected || link.getAttribute('aria-expanded') !== 'true') return;
      renderChildren(children, folders, link.dataset.fmTreePath || '', false);
      children.dataset.hasChildren = folders.length ? '1' : '0';
      children.dataset.loaded = '1';
      children.hidden = !folders.length;
    } catch (error) {
      link.setAttribute('aria-expanded', 'false');
      children.hidden = true;
      console.warn('Files nested folder preview could not load:', error);
    }
  }
  function actionFrom(target) {
    if (!(target instanceof Element) || !target.closest('.fm-explorer')) return null;
    if (target.closest('.explorer-item-menu,details,summary,form,input,textarea,select,[data-open-file],[data-b12-open-file],button,[contenteditable="true"]')) return null;
    const nested = target.closest('[data-fm-tree-folder]');
    if (nested) return {surface:nested, anchor:nested, toggle:()=>toggleNested(nested)};
    const row = target.closest('tr[data-fm-inline-root]');
    if (!row?.dataset.fmInlineRoot) return null;
    const anchor = row.querySelector('[data-fm-inline-folder]');
    if (!anchor) return null;
    return {surface:row, anchor, toggle:()=>toggleInline(row)};
  }
  function cancelClick(surface) {
    const timer = pending.get(surface);
    if (timer !== undefined) clearTimeout(timer);
    pending.delete(surface);
  }
  document.addEventListener('click', event => {
    const action = actionFrom(event.target);
    if (!action || action.anchor.dataset.fmNavigate === '1') return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); // The link opens on double-click, never on a single click.
    if (event.detail > 1) {cancelClick(action.surface);return;}
    cancelClick(action.surface);
    if (!event.detail) {void action.toggle();return;} // Keyboard activation.
    pending.set(action.surface, setTimeout(() => {
      pending.delete(action.surface);
      if (action.surface.isConnected) void action.toggle();
    }, clickDelay));
  }, true);
  document.addEventListener('dblclick', event => {
    const action = actionFrom(event.target);
    if (!action || event.button !== 0) return;
    event.preventDefault();
    cancelClick(action.surface);
    // Dispatch a normal native link click: the existing desktop shell handles
    // internal navigation without reloading the entire panel or changing its URL.
    action.anchor.dataset.fmNavigate = '1';
    try {action.anchor.click();} finally {delete action.anchor.dataset.fmNavigate;}
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== ' ' || !(event.target instanceof Element)) return;
    const action = actionFrom(event.target);
    if (!action || event.target !== action.anchor) return;
    event.preventDefault();
    cancelClick(action.surface);
    void action.toggle();
  }, true);
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.fm-history-refresh')) cache.clear();
  });
})();
