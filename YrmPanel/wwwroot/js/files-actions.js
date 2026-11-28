/* Files actions: one selection model and one action list, used in three places.
   The same actions are toolbar buttons, the toolbar's More menu and the right-click menu.
   Rows render no menu of their own; they only carry data-fm-* attributes (kind, path, rights,
   share and pin state) that this script reads. That holds for the rows of the list and for the
   entries of an expanded folder alike: an entry's data-fm-parent is the folder it lives in, and
   every action runs with that folder as its working folder. A selection never spans two folders.
   Dialogs that already exist (rename/copy/move, share) are opened through the yrm-panel:file-action
   event owned by panel.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const explorer = () => document.querySelector('.fm-explorer');
  const toolbar = () => $('yrm-b10-file-selection');
  const rows = () => Array.from(document.querySelectorAll('.fm-explorer [data-b10-file-row]'));
  const flag = (row, key) => row.dataset[key] === '1';
  const currentRoute = () => explorer()?.dataset.filesCurrentPath || '';
  // The folder a row lives in: the one on screen for the list, data-fm-parent for expanded entries.
  const parentOf = row => row.dataset.fmParent ?? currentRoute();
  const sameFolder = (a, b) => parentOf(a) === parentOf(b);

  // ---- selection: one row = one item. Ctrl toggles, Shift selects a range, Ctrl+A selects all.
  const chosen = new Set();
  let anchor = null;
  function selectedRows() {
    for (const row of chosen) if (!row.isConnected) chosen.delete(row);
    return rows().filter(row => chosen.has(row));
  }
  const bulkNames = list => list.map(row => row.dataset.b10Filename).filter(Boolean);

  // ---- the action list. `when` decides if an action applies to the current selection.
  // `button` ties an action to its toolbar button; actions without one live in More.
  const all = (list, test) => list.length > 0 && list.every(test);
  const one = list => list.length === 1;
  const ACTIONS = [
    {id: 'open', group: 1, label: 'Open', when: one, run: list => openEntry(list[0])},
    {id: 'download', group: 1, label: 'Download', button: '[data-b12-file-download]',
      when: list => list.length > 0, run: downloadSelection},
    {id: 'copy', group: 2, label: 'Copy To...', button: '[data-b12-file-copy]',
      when: list => all(list, row => flag(row, 'fmCopy')), run: list => fileDialog('copy', list)},
    {id: 'move', group: 2, label: 'Move To...', button: '[data-b10-file-move]',
      when: list => all(list, row => flag(row, 'fmWritable')), run: list => fileDialog('move', list)},
    {id: 'rename', group: 2, label: 'Rename', button: '[data-b10-file-rename]',
      when: list => one(list) && flag(list[0], 'fmWritable'), run: list => fileDialog('rename', list)},
    {id: 'pin', group: 3, when: list => one(list) && (flag(list[0], 'fmPinned') || flag(list[0], 'fmCanPin')),
      label: list => flag(list[0], 'fmPinned') ? 'Unpin shortcut' : 'Pin to Quick Access',
      run: list => submitWith(flag(list[0], 'fmPinned') ? '[data-fm-unpin-form]' : '[data-fm-pin-form]', 'folderPath', list[0].dataset.fmAbs)},
    {id: 'copypath', group: 3, label: 'Copy path', when: one,
      run: list => { const path = list[0].dataset.fmAbs || ''; if (path) void navigator.clipboard?.writeText(path).catch(() => {}); }},
    {id: 'share', group: 3, label: 'Share', when: list => one(list) && flag(list[0], 'fmCanShare'),
      run: list => window.dispatchEvent(new CustomEvent('yrm-panel:file-action', {detail: {kind: 'share', name: list[0].dataset.fmName,
        absolute: list[0].dataset.b10Absolute || (list[0].dataset.fmParent !== undefined ? list[0].dataset.fmAbs : '')}}))},
    {id: 'unshare', group: 3, label: 'Stop sharing', when: list => one(list) && !!list[0].dataset.fmShare,
      run: list => submitWith('[data-fm-unshare-form]', 'name', list[0].dataset.fmShare)},
    {id: 'enable', group: 3, label: 'Request management', when: list => one(list) && flag(list[0], 'fmCanEnable'),
      run: list => submitWith('[data-fm-enable-form]', 'name', list[0].dataset.fmName, parentOf(list[0]))},
    {id: 'delete', group: 4, label: 'Delete', danger: true, button: '[data-b10-file-delete]',
      when: list => all(list, row => flag(row, 'fmDeletable')), run: deleteSelection},
    {id: 'props', group: 5, label: 'Properties', when: one, run: list => showProperties(list[0])}
  ];
  const label = (action, list) => typeof action.label === 'function' ? action.label(list) : action.label;
  const applicable = list => ACTIONS.filter(action => action.when(list));
  const moreItems = list => applicable(list).filter(action => !action.button);

  // ---- running actions
  function openEntry(row) {
    if (row.dataset.fmKind === 'dir') {
      window.dispatchEvent(new CustomEvent('yrm-panel:navigate', {detail: '/Files?path=' + encodeURIComponent(row.dataset.fmRel || '')}));
    } else {
      // The Files preview script owns opening files; ask it exactly like a double-click does.
      row.querySelector('[data-open-file]')?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true, view: window}));
    }
  }
  // A form posts to the folder the entries live in and comes back to the view on screen.
  function workIn(form, parent) {
    const url = new URL(form.getAttribute('action') || location.pathname, location.origin);
    url.searchParams.set('path', parent);
    url.searchParams.set('return', currentRoute());
    form.setAttribute('action', url.pathname + url.search);
  }
  function submitWith(selector, field, value, parent = null) {
    const form = document.querySelector(selector);
    if (!(form instanceof HTMLFormElement)) return;
    if (parent !== null) workIn(form, parent);
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.value = value || '';
    form.requestSubmit();
  }
  function addNames(form, list) {
    form.querySelectorAll('input[name="names"]').forEach(node => node.remove());
    for (const name of bulkNames(list)) {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'names'; input.value = name;
      form.append(input);
    }
  }
  function downloadSelection(list) {
    const file = list.length === 1 && list[0].dataset.fmKind === 'file' ? list[0] : null;
    if (file) {
      // Same request the old Download link made; the server answers with an attachment. The link
      // is removed within the same task, so it is never on screen to hover.
      const link = document.createElement('a');
      link.hidden = true;
      link.setAttribute('data-yrm-transient', '');
      link.download = '';
      link.href = '/Files?handler=Download&path=' + encodeURIComponent(parentOf(file)) +
        '&name=' + encodeURIComponent(file.dataset.b10Filename || '');
      document.body.append(link);
      link.click();
      link.remove();
      return;
    }
    const form = document.querySelector('[data-bulk-download-form]');
    if (!(form instanceof HTMLFormElement)) return;
    workIn(form, parentOf(list[0]));
    addNames(form, list);
    form.requestSubmit();
  }
  function deleteSelection(list) {
    const form = document.querySelector('[data-bulk-delete-form]');
    if (!(form instanceof HTMLFormElement)) return;
    workIn(form, parentOf(list[0]));
    addNames(form, list);
    form.dataset.confirm = `Permanently delete ${list.length} selected item${list.length === 1 ? '' : 's'}? This cannot be undone.`;
    form.requestSubmit();
  }
  function fileDialog(kind, list) {
    const first = list[0];
    window.dispatchEvent(new CustomEvent('yrm-panel:file-action', {detail: {
      kind, name: first.dataset.fmName || '', source: first.dataset.b10Absolute || '', names: bulkNames(list),
      path: parentOf(first), returnTo: currentRoute()}}));
  }
  function showProperties(row) {
    const values = {name: row.dataset.fmName, path: row.dataset.fmAbs, type: row.dataset.fmType,
      size: row.dataset.fmSize, modified: row.dataset.fmModified};
    for (const [key, value] of Object.entries(values)) {
      const cell = $('yrm-b12-prop-' + key);
      if (cell) cell.textContent = value || '—';
    }
    const dialog = $('yrm-b12-file-properties');
    if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
  }

  // ---- toolbar state follows the selection
  function refresh() {
    const current = selectedRows();
    for (const row of rows()) {
      const isChosen = chosen.has(row);
      row.classList.toggle('is-selected', isChosen);
      row.setAttribute('aria-selected', String(isChosen));
    }
    const bar = toolbar();
    if (!bar) return;
    bar.classList.toggle('has-selection', current.length > 0);
    for (const action of ACTIONS) {
      const button = action.button ? bar.querySelector(action.button) : null;
      if (button) button.disabled = !action.when(current);
    }
    const more = bar.querySelector('[data-fm-more]');
    if (more) more.disabled = moreItems(current).length === 0;
    if (menu && current.length === 0) closeMenu();
  }
  function select(row, {toggle = false, range = false, add = false} = {}) {
    const everything = rows();
    if (!row || !everything.includes(row)) { chosen.clear(); anchor = null; refresh(); return; }
    // A selection never spans two folders: choosing an entry of another folder starts over.
    const held = selectedRows();
    if (held.length && !sameFolder(held[0], row)) { chosen.clear(); anchor = null; }
    const list = everything.filter(candidate => sameFolder(candidate, row));
    if (range && anchor && list.includes(anchor)) {
      if (!add) chosen.clear();
      const a = list.indexOf(anchor), b = list.indexOf(row);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) chosen.add(list[i]);
    } else if (toggle) {
      if (chosen.has(row)) chosen.delete(row); else chosen.add(row);
      anchor = row;
    } else { chosen.clear(); chosen.add(row); anchor = row; }
    refresh();
  }

  // ---- the menu (More and right-click): one element, built from the action list
  let menu = null;
  let menuOpener = null;
  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    menuOpener?.setAttribute?.('aria-expanded', 'false');
    menuOpener = null;
  }
  function openMenu(actions, list, at, {opener = null, focus = false} = {}) {
    closeMenu();
    if (!actions.length) return;
    const element = document.createElement('div');
    element.className = 'explorer-actions-popover fm-menu';
    element.setAttribute('role', 'menu');
    // The menu lives on <body>, outside .fm-explorer, so it copies the Files control height token.
    const rowHeight = explorer() ? getComputedStyle(explorer()).getPropertyValue('--fm-control-height') : '';
    if (rowHeight) element.style.setProperty('--fm-control-height', rowHeight);
    let group = null;
    for (const action of actions) {
      if (group !== null && action.group !== group) {
        const divider = document.createElement('hr');
        divider.className = 'yrm-menu-divider';
        element.append(divider);
      }
      group = action.group;
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.fmAction = action.id;
      item.textContent = label(action, list);
      if (action.danger) item.className = 'danger';
      element.append(item);
    }
    element.addEventListener('click', event => {
      const item = event.target instanceof Element ? event.target.closest('[data-fm-action]') : null;
      if (!item) return;
      const action = ACTIONS.find(candidate => candidate.id === item.dataset.fmAction);
      const current = selectedRows();
      closeMenu();
      if (action && action.when(current)) action.run(current);
    });
    document.body.append(element);
    menu = element;
    menuOpener = opener;
    opener?.setAttribute?.('aria-expanded', 'true');
    const width = element.offsetWidth, height = element.offsetHeight;
    let left = at.alignRight ? at.x - width : at.x;
    let top = at.y;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    if (top + height > innerHeight - 8) top = Math.max(8, (at.flipY ?? top) - height);
    element.style.left = left + 'px';
    element.style.top = top + 'px';
    if (focus) element.querySelector('button')?.focus();
  }
  function openMoreMenu(button, byKeyboard) {
    if (menu && menuOpener === button) { closeMenu(); return; }
    const current = selectedRows();
    const rect = button.getBoundingClientRect();
    openMenu(moreItems(current), current, {x: rect.right, y: rect.bottom + 4, alignRight: true, flipY: rect.top - 4},
      {opener: button, focus: byKeyboard});
  }

  // ---- events
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('.fm-menu')) return;
    const more = target.closest('[data-fm-more]');
    if (more) { event.preventDefault(); openMoreMenu(more, event.detail === 0); return; }
    closeMenu();
    const row = target.closest('[data-b10-file-row]');
    if (row && !target.closest('.explorer-item-menu,form,details,summary,input,textarea,select,[data-fm-expand]')) {
      select(row, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, add: event.ctrlKey || event.metaKey});
      return;
    }
    if (target.closest('.explorer-table tbody') && !row) select(null);
    const bar = target.closest('#yrm-b10-file-selection');
    if (!bar) return;
    const current = selectedRows();
    const action = ACTIONS.find(candidate => candidate.button && target.closest(candidate.button));
    if (action && current.length && action.when(current)) action.run(current);
  }, true);

  document.addEventListener('contextmenu', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.fm-explorer') || target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const row = target.closest('[data-b10-file-row]');
    if (!row) return; // other places keep their existing behaviour
    event.preventDefault();
    if (!chosen.has(row)) select(row);
    const current = selectedRows();
    openMenu(applicable(current), current, {x: event.clientX, y: event.clientY});
  });

  document.addEventListener('keydown', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (menu && target && menu.contains(target)) {
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const at = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
      else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
      else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus(); }
      else if (event.key === 'Tab') closeMenu();
    }
    if (event.key === 'Escape' && menu) {
      const opener = menuOpener;
      closeMenu();
      event.preventDefault();
      opener?.focus?.();
      return;
    }
    if (!explorer() || document.querySelector('dialog[open]')) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const row = target?.closest('[data-b10-file-row]');
      if (!row) return;
      event.preventDefault();
      if (!chosen.has(row)) select(row);
      const rect = row.getBoundingClientRect();
      const current = selectedRows();
      openMenu(applicable(current), current, {x: rect.left + 48, y: rect.bottom - 4, flipY: rect.top + 4}, {focus: true});
      return;
    }
    if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      const list = rows().filter(row => row.dataset.fmParent === undefined); // the list, not expanded entries
      if (!list.length) return;
      event.preventDefault();
      chosen.clear();
      list.forEach(row => chosen.add(row));
      anchor = list[0];
      refresh();
    } else if (event.key === 'Escape') { select(null); }
    else if (event.key === 'Delete' && selectedRows().length) {
      event.preventDefault();
      toolbar()?.querySelector('[data-b10-file-delete]:not(:disabled)')?.click();
    } else if (target?.matches('[data-b10-file-row]') && event.key === ' ') {
      event.preventDefault();
      select(target, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey});
    }
  }, true);

  document.addEventListener('pointerdown', event => {
    if (menu && event.target instanceof Element && !event.target.closest('.fm-menu,[data-fm-more]')) closeMenu();
  }, true);
  window.addEventListener('scroll', event => { if (menu && !(event.target instanceof Node && menu.contains(event.target))) closeMenu(); }, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);

  // Properties dialog close button.
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-b12-props-close]')) $('yrm-b12-file-properties')?.close();
  }, true);

  // Rows that leave the page (navigation, refresh) leave the selection with them.
  new MutationObserver(() => {
    if (Array.from(chosen).some(row => !row.isConnected)) {
      for (const row of chosen) if (!row.isConnected) chosen.delete(row);
      if (anchor && !anchor.isConnected) anchor = null;
      refresh();
    }
  }).observe(document.body, {childList: true, subtree: true});
})();
