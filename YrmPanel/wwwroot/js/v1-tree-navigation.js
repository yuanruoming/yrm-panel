/* Files folder tree: immediate chevron expand, static folder icon.
   Entries of an expanded folder are rows like any other: they carry the same data-fm-* state, so
   files-actions.js selects them and offers the same actions. Double-click opens them without a fixed
   delay (folders navigate, files preview or download). Folder labels carry data-fm-href instead of
   href, so hovering never shows a browser status-bar URL; the desktop shell performs the navigation.
   Expanded folders stay expanded when the same folder is refreshed (an action ran, or a reload). */
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
  // The children of a folder: entries (folders first) with everything the actions need to know.
  async function loadChildren(path) {
    const cached = cache.get(path);
    if (cached && Date.now() - cached.at < 6000) return cached.children;
    if (pendingLoads.has(path)) return pendingLoads.get(path);
    const task = (async () => {
      const url = new URL('/Files', location.origin);
      url.searchParams.set('handler', 'Tree');
      url.searchParams.set('path', path);
      const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', headers: {'Accept': 'application/json'}});
      if (!response.ok || response.redirected) throw new Error(`Could not read folder (HTTP ${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data?.folders)) throw new Error('Invalid folder response.');
      const usable = name => typeof name === 'string' && name !== '' && name !== '.' && name !== '..';
      const base = path ? path.replace(/\/$/, '') + '/' : '';
      const entries = (Array.isArray(data.entries) ? data.entries : [
        ...data.folders.map(name => ({name, isDirectory: true})),
        ...(Array.isArray(data.files) ? data.files : []).map(name => ({name, isDirectory: false}))])
        .filter(entry => entry && usable(entry.name))
        .map(entry => ({relative: base + entry.name, absolute: '', size: '', modified: '', writable: false,
          pinned: false, canPin: false, shareName: '', canShare: false, canEnable: false, ...entry}));
      const children = {entries};
      cache.set(path, {children, at:Date.now()});
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return children;
    })();
    pendingLoads.set(path, task);
    try {return await task;} finally {if(pendingLoads.get(path) === task) pendingLoads.delete(path);}
  }
  // The state files-actions.js reads from a row, for an entry of an expanded folder. `parent` is the
  // folder the entry lives in: every action runs with it as the working folder.
  function describeRow(header, entry, parent) {
    const flag = value => value ? '1' : '0';
    Object.assign(header.dataset, {
      b10FileRow: '', b10Filename: entry.name, fmKind: entry.isDirectory ? 'dir' : 'file', fmName: entry.name,
      fmRel: entry.relative, fmAbs: entry.absolute, fmParent: parent,
      fmType: entry.isDirectory ? 'Folder' : 'File', fmSize: entry.size || '—', fmModified: entry.modified || '—',
      fmCopy: '1', fmWritable: flag(entry.writable), fmDeletable: flag(entry.writable),
      fmPinned: flag(entry.pinned), fmCanPin: flag(entry.canPin), fmShare: entry.shareName || '',
      fmCanShare: flag(entry.canShare), fmCanEnable: flag(entry.canEnable)
    });
    header.setAttribute('aria-selected', 'false');
  }
  // depth 1 = directly below the expanded folder row; the CSS indents each level inside the row,
  // so the hover/selection band always spans the full width of the table.
  function folderNode(entry, parent, library, depth) {
    const path = entry.relative;
    const name = entry.name;
    const wrapper = document.createElement('div');
    wrapper.className = 'fm-tree-node';
    wrapper.dataset.fmTreeRoot = path;
    const header = document.createElement('div');
    header.className = 'fm-tree-node-header';
    header.style.setProperty('--tree-depth', String(depth));
    describeRow(header, entry, parent);
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
  // A file has no arrow; a spacer keeps its icon aligned with the folders around it.
  // Opening is owned by the Files preview script (double-click on [data-open-file]).
  function fileNode(entry, parent, depth) {
    const name = entry.name;
    const wrapper = document.createElement('div');
    wrapper.className = 'fm-tree-node';
    const header = document.createElement('div');
    header.className = 'fm-tree-node-header';
    header.style.setProperty('--tree-depth', String(depth));
    describeRow(header, entry, parent);
    const spacer = document.createElement('span');
    spacer.className = 'fm-tree-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'fm-file-open fm-tree-file';
    open.dataset.openFile = name;
    open.dataset.openDir = parent;
    const icon = document.createElement('span');
    icon.className = 'explorer-file-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u25A4';
    const label = document.createElement('span');
    label.textContent = name;
    open.append(icon, label);
    header.append(spacer, open);
    wrapper.append(header);
    return wrapper;
  }
  function renderChildren(host, children, path, library, depth) {
    host.replaceChildren();
    for (const entry of children.entries.filter(item => item.isDirectory)) host.append(folderNode(entry, path, library, depth));
    for (const entry of children.entries.filter(item => !item.isDirectory)) host.append(fileNode(entry, path, depth));
  }
  // Expanded folders survive a refresh of the same folder. The set holds the paths that are open
  // under the folder being shown; moving to another folder starts it over.
  const openPaths = new Set();
  let openFor = null;
  const currentFolder = () => document.querySelector('.fm-explorer')?.dataset.filesCurrentPath ?? '';
  function remember(path, open) {
    if (openFor === null) openFor = currentFolder();
    if (open) { openPaths.add(path); return; }
    for (const known of Array.from(openPaths)) if (known === path || known.startsWith(path + '/')) openPaths.delete(known);
  }
  async function restoreNested(host) {
    for (const expand of host.querySelectorAll(':scope > .fm-tree-node > .fm-tree-node-header [data-fm-expand]')) {
      if (openPaths.has(expand.dataset.fmTreePath || '') && expand.getAttribute('aria-expanded') !== 'true')
        await toggleNested(expand);
    }
  }
  async function restoreOpen() {
    const here = currentFolder();
    if (openFor !== here) { openPaths.clear(); openFor = here; return; }
    if (!openPaths.size) return;
    cache.clear(); // the folder just changed on disk; listings from before may be stale
    for (const row of document.querySelectorAll('tr[data-fm-inline-root]')) {
      if (openPaths.has(row.dataset.fmInlineRoot) && row.getAttribute('aria-expanded') !== 'true') await toggleInline(row);
    }
  }
  async function toggleInline(row) {
    const path = row.dataset.fmInlineRoot;
    if (!path) return;
    const expanding = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(expanding));
    row.querySelector(':scope > .explorer-name [data-fm-expand]')?.setAttribute('aria-expanded', String(expanding));
    remember(path, expanding);
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
      const children = await loadChildren(path);
      if (!row.isConnected || row.getAttribute('aria-expanded') !== 'true' || !children.entries.length) return;
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
      renderChildren(preview.querySelector('.fm-inline-preview'), children, path, false, 1);
      preview.dataset.loaded = '1';
      preview.hidden = false;
      await restoreNested(preview.querySelector('.fm-inline-preview'));
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
    remember(expand.dataset.fmTreePath || '', expanding);
    children.hidden = !expanding;
    if (!expanding || children.dataset.loaded === '1') {
      if (expanding && children.dataset.hasChildren === '0') children.hidden = true;
      return;
    }
    try {
      const loaded = await loadChildren(expand.dataset.fmTreePath || '');
      if (!children.isConnected || expand.getAttribute('aria-expanded') !== 'true') return;
      const depth = Number(wrapper.querySelector(':scope > .fm-tree-node-header')?.style.getPropertyValue('--tree-depth') || 1) + 1;
      renderChildren(children, loaded, expand.dataset.fmTreePath || '', false, depth);
      const any = loaded.entries.length > 0;
      children.dataset.hasChildren = any ? '1' : '0';
      children.dataset.loaded = '1';
      children.hidden = !any;
      await restoreNested(children);
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
  // Keyboard parity with the removed href: Enter opens the selected folder or file.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const file = target?.closest('.fm-inline-preview [data-open-file]');
    if (file) {
      // The Files preview script owns opening; Enter asks it exactly like a double-click does.
      event.preventDefault();
      file.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true, view: window}));
      return;
    }
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
      void loadChildren(path).catch(() => {});
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
  window.addEventListener('yrm-panel:files-view-updated', () => { void restoreOpen(); });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.fm-history-refresh')) cache.clear();
  });
})();
