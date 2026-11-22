/* Small stability improvements: independent Files navigation, mount-location picker,
   and non-sensitive workspace state. This file runs after panel.js. */
(() => {
  'use strict';
  // Desktop shell owns route persistence. This module owns only Files UI.
  const get = id => document.getElementById(id);

  const disclosureState = new Map();
  function restoreDisclosure() {
    document.querySelectorAll('details[data-persist-disclosure]').forEach(node => {
      if (!(node instanceof HTMLDetailsElement) || node.dataset.restored === '1') return;
      const key = node.dataset.persistDisclosure;
      if (!key) return;
      node.dataset.restored = '1';
      let open = disclosureState.get(key);
      if (open === undefined) {
        try { const saved = sessionStorage.getItem(key); if (saved !== null) open = saved === '1'; }
        catch { /* In-memory state remains available. */ }
      }
      if (open !== undefined) node.open = open;
    });
  }
  document.addEventListener('toggle', event => {
    const node = event.target;
    if (!(node instanceof HTMLDetailsElement) || !node.isConnected ||
        !node.matches('details[data-persist-disclosure]')) return;
    const key = node.dataset.persistDisclosure;
    if (!key) return;
    disclosureState.set(key,node.open);
    try { sessionStorage.setItem(key,node.open ? '1' : '0'); } catch {}
  },true);
  restoreDisclosure();

  const observer = new MutationObserver(restoreDisclosure);
  observer.observe(document.body,{childList:true,subtree:true});

  /* BETA9: one floating Files menu. Portal avoids row stacking/clipping and
     does not rely on CSS z-index battles between neighboring table rows. */
  let floatingMenu=null;
  function closeFloatingMenu() {
    if (!floatingMenu) return;
    const {owner,proxy}=floatingMenu;
    floatingMenu=null;
    proxy.remove();
    if (owner.isConnected)owner.open=false;
  }
  function positionFloatingMenu() {
    if (!floatingMenu) return;
    const {owner,proxy,anchor}=floatingMenu;
    if (!owner.isConnected) {closeFloatingMenu();return;}
    const rect=anchor ? {left:anchor.x,right:anchor.x,top:anchor.y,bottom:anchor.y} : owner.querySelector('summary')?.getBoundingClientRect();
    if (!rect) {closeFloatingMenu();return;}
    const width=proxy.offsetWidth||174,height=proxy.offsetHeight;
    proxy.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.right-width))}px`;
    proxy.style.top=`${innerHeight-rect.bottom>=height+12 || innerHeight-rect.bottom>=rect.top
      ?rect.bottom+5:Math.max(8,rect.top-height-5)}px`;
  }
  let contextMenuAnchor=null;
  // Use visual proxies, not detached real forms: original forms must stay inside
  // #window-page so existing CSRF, sudo authorization and AJAX handlers work.
  document.addEventListener('click',event=>{
    const el=event.target;
    if (!(el instanceof Element))return;
    const action=el.closest('body > .explorer-actions-popover [data-b9-proxy-index]');
    if (action && floatingMenu) {
      event.preventDefault();
      const index=Number(action.dataset.b9ProxyIndex);
      const source=floatingMenu.owner.querySelectorAll('.explorer-actions-popover button,.explorer-actions-popover a')[index];
      closeFloatingMenu();
      if (source instanceof HTMLElement && source.isConnected)source.click();
      return;
    }
    const summary=el.closest('.explorer-item-menu > summary');
    if (summary) {
      event.preventDefault();
      const owner=summary.parentElement;
      if (floatingMenu?.owner===owner) {closeFloatingMenu();return;}
      closeFloatingMenu();
      const original=owner?.querySelector('.explorer-actions-popover');
      if (!original)return;
      const proxy=document.createElement('div');
      proxy.className='explorer-actions-popover';
      original.querySelectorAll('button,a').forEach((source,index)=>{
        const button=document.createElement('button');
        button.type='button';
        button.dataset.b9ProxyIndex=String(index);
        button.textContent=source.textContent;
        button.className=source.className;
        button.disabled=source.disabled||false;
        proxy.append(button);
      });
      owner.open=true;
      document.body.append(proxy);
      floatingMenu={owner,proxy,anchor:contextMenuAnchor};
      contextMenuAnchor=null;
      positionFloatingMenu();
      return;
    }
    if (floatingMenu && !floatingMenu.proxy.contains(el))closeFloatingMenu();
  },true);
  document.addEventListener('contextmenu',event=>{
    const target=event.target instanceof Element?event.target:null;
    if (!target || !target.closest('.fm-explorer'))return;
    // Preserve browser text editing and form controls, but use the same
    // existing menu for both More and right-click on folder/file entries.
    if (target.closest('input,textarea,select,[contenteditable="true"]'))return;
    const item=target.closest('[data-b10-file-row],.fm-library-row,.yrm-b11-quick-item');
    const summary=item?.querySelector('.explorer-item-menu > summary');
    if (!summary){event.preventDefault();return;}
    event.preventDefault();
    if (item?.matches('[data-b10-file-row]'))setFileSelection(item);
    closeFloatingMenu();
    contextMenuAnchor={x:event.clientX,y:event.clientY};
    summary.click();
    contextMenuAnchor=null;
  });
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape' && floatingMenu){closeFloatingMenu();event.preventDefault();return;}
    if (!(event.key==='ContextMenu' || (event.shiftKey && event.key==='F10')))return;
    const target=event.target instanceof Element?event.target:null;
    const item=target?.closest('[data-b10-file-row],.fm-library-row,.yrm-b11-quick-item');
    const summary=item?.querySelector('.explorer-item-menu > summary');
    if (summary){event.preventDefault();summary.click();}
  },true);
  window.addEventListener('scroll',positionFloatingMenu,true);
  window.addEventListener('resize',positionFloatingMenu);
  const menuObserver=new MutationObserver(()=>{
    if (floatingMenu && !floatingMenu.owner.isConnected)closeFloatingMenu();
  });
  menuObserver.observe(document.body,{childList:true,subtree:true});

  // Single styled provider picker. The real select remains the source of
  // truth, so BETA9 preset logic and non-JS form fallback are preserved.
  document.documentElement.classList.add('b10-js-ready');
  function closeProviderPicker(){
    document.querySelectorAll('[data-b10-provider-options]').forEach(el=>el.hidden=true);
    document.querySelectorAll('[data-b10-provider-toggle]').forEach(el=>el.setAttribute('aria-expanded','false'));
  }
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    if (!node)return;
    const picker=node.closest('[data-b10-provider-picker]');
    const trigger=node.closest('[data-b10-provider-toggle]');
    if (trigger && picker){
      const menu=picker.querySelector('[data-b10-provider-options]');
      const open=Boolean(menu?.hidden);
      closeProviderPicker();
      if(menu)menu.hidden=!open;
      trigger.setAttribute('aria-expanded',String(open));
      return;
    }
    const option=node.closest('[data-b10-provider-option]');
    if(option && picker){
      const select=picker.querySelector('#yrm-ddns-provider-preset');
      if(select){
        select.value=option.dataset.b10ProviderOption;
        select.dispatchEvent(new Event('change',{bubbles:true}));
      }
      picker.querySelector('[data-b10-provider-toggle]').firstChild.textContent=option.textContent+' ';
      picker.querySelectorAll('[data-b10-provider-option]').forEach(el=>
        el.setAttribute('aria-selected',String(el===option)));
      closeProviderPicker();
      return;
    }
    if(!picker)closeProviderPicker();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProviderPicker();});
  // IPv4 and IPv6 source controls live inside a single provider editor.
  document.addEventListener('change',event=>{
    const node=event.target;
    if (!(node instanceof Element))return;
    const family=node.closest('[data-b10-family]');
    if (family && node.matches('[data-b10-source-select]')) {
      const source=node.value;
      family.querySelectorAll('[data-b10-source-field]').forEach(field=>{
        field.hidden=field.dataset.b10SourceField!==source;
      });
    }
    if (node.id==='yrm-ddns-provider-preset') {
      const form=node.closest('form');
      const choices=form?.querySelector('.yrm-b10-add-families');
      if (choices)choices.hidden=node.value==='custom';
      const name=form?.elements.namedItem('name');
      if (name instanceof HTMLInputElement && /^(Dynu IPv4|Cloudflare IPv4|Custom DDNS)$/.test(name.value))
        name.value=node.value==='dynu4'?'Dynu':node.value==='cloudflare4'?'Cloudflare':'Custom DDNS';
    }
  },true);
  // Native desktop selection: one row = one item, not independent cells.
  // Ctrl toggles, Shift selects a range, Ctrl+A selects the current folder.
  const selectedFileRows = new Set();
  let selectionAnchor = null;
  const fileRows = () => Array.from(document.querySelectorAll('.fm-explorer [data-b10-file-row]'));
  function selectedRows(){
    for (const row of selectedFileRows) if(!row.isConnected)selectedFileRows.delete(row);
    return fileRows().filter(row=>selectedFileRows.has(row));
  }
  function updateFileSelection(){
    const current = selectedRows();
    for (const row of fileRows()){
      const chosen=selectedFileRows.has(row);
      row.classList.toggle('is-selected',chosen);
      row.setAttribute('aria-selected',String(chosen));
    }
    const toolbar=get('yrm-b10-file-selection');
    if(!toolbar)return;
    toolbar.classList.toggle('has-selection',current.length>0);
    const writable=current.length>0&&current.every(row=>row.querySelector('[data-b10-row-delete]'));
    for(const attr of ['data-b10-file-delete','data-b10-file-move']){
      const button=toolbar.querySelector(`[${attr}]`);if(button)button.disabled=!writable;
    }
    const copy=toolbar.querySelector('[data-b12-file-copy]');
    if(copy)copy.disabled=current.length===0;
    const rename=toolbar.querySelector('[data-b10-file-rename]');
    if(rename)rename.disabled=current.length!==1||!writable;
    const download=toolbar.querySelector('[data-b12-file-download]');
    if(download)download.disabled=current.length===0;
  }
  function setFileSelection(row,{toggle=false,range=false,add=false}={}){
    const rows=fileRows();
    if(!row||!rows.includes(row)){selectedFileRows.clear();selectionAnchor=null;updateFileSelection();return;}
    if(range&&selectionAnchor&&rows.includes(selectionAnchor)){
      if(!add)selectedFileRows.clear();
      const a=rows.indexOf(selectionAnchor),b=rows.indexOf(row);
      for(let i=Math.min(a,b);i<=Math.max(a,b);i++)selectedFileRows.add(rows[i]);
    } else if(toggle){
      if(selectedFileRows.has(row))selectedFileRows.delete(row);else selectedFileRows.add(row);
      selectionAnchor=row;
    } else {selectedFileRows.clear();selectedFileRows.add(row);selectionAnchor=row;}
    updateFileSelection();
  }
  function bulkNames(){return selectedRows().map(row=>row.dataset.b10Filename).filter(Boolean);}
  document.addEventListener('click',event=>{
    const target=event.target;
    if (!(target instanceof Element))return;
    const row=target.closest('[data-b10-file-row]');
    if(row&&!target.closest('.explorer-item-menu,form,details,summary,input,textarea,select,[data-fm-expand]')){
      setFileSelection(row,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey,add:event.ctrlKey||event.metaKey});
      return;
    }
    if(target.closest('.explorer-table tbody')&&!row)setFileSelection(null);
    const action=target.closest('[data-b10-file-rename],[data-b10-file-move],[data-b10-file-delete],[data-b12-file-copy],[data-b12-file-download]');
    const selected=selectedRows();
    if(!action||!selected.length)return;
    const first=selected[0];
    if(action.matches('[data-b12-file-download]')){
      if(selected.length===1&&first.querySelector('a[data-native-download]')){
        first.querySelector('a[data-native-download]').click();
      }else{
        const form=document.querySelector('[data-bulk-download-form]');
        if(form instanceof HTMLFormElement){
          form.querySelectorAll('input[name="names"]').forEach(node=>node.remove());
          for(const name of bulkNames()){
            const input=document.createElement('input');input.type='hidden';input.name='names';input.value=name;form.append(input);
          }
          form.requestSubmit();
        }
      }
      return;
    }
    if(action.matches('[data-b10-file-rename]')&&selected.length===1)first.querySelector('[data-rename-item]')?.click();
    if(action.matches('[data-b10-file-delete]')){
      const form=document.querySelector('[data-bulk-delete-form]');
      if(!(form instanceof HTMLFormElement))return;
      form.querySelectorAll('input[name="names"]').forEach(node=>node.remove());
      for(const name of bulkNames()){
        const field=document.createElement('input');field.type='hidden';field.name='names';field.value=name;form.append(field);
      }
      form.dataset.confirm=`Permanently delete ${selected.length} selected item${selected.length===1?'':'s'}? This cannot be undone.`;
      form.requestSubmit();
    }
    if(action.matches('[data-b12-file-copy],[data-b10-file-move]')){
      const copy=action.matches('[data-b12-file-copy]');
      const origin=first.querySelector(copy?'[data-copy-item]':'[data-move-item]');
      origin?.click();
      if(selected.length>1 || first.dataset.b10Absolute){
        const form=get('file-action-form');
        if(!(form instanceof HTMLFormElement))return;
        const url=new URL(form.action,location.origin);url.searchParams.set('handler',copy?'BulkCopy':'BulkMove');
        form.action=url.pathname+url.search;
        form.querySelectorAll('[data-bulk-selected-name]').forEach(field=>field.remove());
        for(const name of bulkNames()){
          const field=document.createElement('input');field.type='hidden';field.name='names';field.value=name;
          field.dataset.bulkSelectedName='1';form.append(field);
        }
        const title=get('file-action-title');if(title)title.textContent=`${copy?'Copy':'Move'} ${selected.length} items to...`;
      }
    }
  },true);
  document.addEventListener('keydown',event=>{
    if(!document.querySelector('.fm-explorer')||document.querySelector('dialog[open]'))return;
    const target=event.target;
    if(target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){
      const rows=fileRows();if(!rows.length)return;
      event.preventDefault();selectedFileRows.clear();rows.forEach(row=>selectedFileRows.add(row));
      selectionAnchor=rows[0];updateFileSelection();
    } else if(event.key==='Escape'){setFileSelection(null);}
    else if(event.key==='Delete'&&selectedRows().length){
      event.preventDefault();get('yrm-b10-file-selection')?.querySelector('[data-b10-file-delete]:not(:disabled)')?.click();
    } else if(target instanceof Element&&target.matches('[data-b10-file-row]')&&event.key===' '){
      event.preventDefault();setFileSelection(target,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey});
    }
  },true);
  const selectionObserver=new MutationObserver(()=>{
    if(Array.from(selectedFileRows).some(row=>!row.isConnected)){
      for(const row of selectedFileRows)if(!row.isConnected)selectedFileRows.delete(row);
      if(selectionAnchor&&!selectionAnchor.isConnected)selectionAnchor=null;
      updateFileSelection();
    }
  });
  selectionObserver.observe(document.body,{childList:true,subtree:true});

  // Folder click and double-click are handled only by v1-tree-navigation.js.
  // File selection, row actions, and their existing controls remain here.

  // Native Files context and More share the existing source action buttons.
  // Properties are read-only; they do not request administrator privileges.
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    if (!node)return;
    if (node.closest('[data-b12-props-close]')){
      get('yrm-b12-file-properties')?.close();return;
    }
    const props=node.closest('[data-b12-properties]');
    if (props){
      for(const key of ['name','path','type','size','modified']){
        const cell=get('yrm-b12-prop-'+key);
        if(cell)cell.textContent=props.getAttribute('data-b12-prop-'+key)||'—';
      }
      const dialog=get('yrm-b12-file-properties');
      if(dialog instanceof HTMLDialogElement && !dialog.open)dialog.showModal();
    }
    const open=node.closest('[data-b12-open-file]');
    if(open){
      const tableRow=open.closest('[data-b10-file-row]');
      tableRow?.querySelector('[data-open-file]')?.dispatchEvent(new MouseEvent('dblclick',{
        bubbles:true,cancelable:true}));
    }
  },true);

  // Read-only folders still expose More; copying a path requires no sudo.
  document.addEventListener('click',event=>{
    const button=event.target instanceof Element ? event.target.closest('[data-b10-copy-path]') : null;
    if (!button)return;
    const path=button.dataset.b10CopyPath||'';
    if (path)void navigator.clipboard?.writeText(path).catch(()=>{});
  },true);

  function showDdnsDetail(element) {
    const dialog=get('yrm-b12-ddns-detail');
    if (!(dialog instanceof HTMLDialogElement) || !element) return;
    const details=element.querySelector('[data-b9-ddns-error]')?.textContent.trim()
      || element.getAttribute('title') || 'No update has been attempted.';
    const message=get('yrm-b12-ddns-message');
    if (message) message.textContent=details;
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    if (node?.closest('[data-b12-ddns-close]'))get('yrm-b12-ddns-detail')?.close();
    else if (node?.closest('[data-b12-ddns-detail]'))showDdnsDetail(node.closest('[data-b12-ddns-detail]'));
  },true);
  document.addEventListener('keydown',event=>{
    const node=event.target instanceof Element?event.target:null;
    if (node?.matches('[data-b12-ddns-detail]') && (event.key==='Enter'||event.key===' ')){
      event.preventDefault();showDdnsDetail(node);
    }
  },true);

  /* DDNS: Add/Edit stays in the current desktop window; passwords remain
     empty on edit and are never read back from the backend. */
  document.addEventListener('click',event=>{
    const node=event.target;
    if (!(node instanceof Element))return;
    if (node.closest('[data-b9-ddns-add]')) {
      const dialog=get('yrm-b9-ddns-add');
      if (dialog instanceof HTMLDialogElement && !dialog.open){
        dialog.showModal();
        const form=dialog.querySelector('#yrm-ddns-new-form');
        const name=form?.elements.namedItem('name');
        if (name instanceof HTMLInputElement && name.value==='Dynu IPv4')name.value='Dynu';
      }
    }
    if (node.closest('[data-b9-ddns-cancel]')) {
      const dialog=get('yrm-b9-ddns-add');
      if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
    }
    const toggle=node.closest('[data-b9-secret-toggle]');
    if (toggle instanceof HTMLButtonElement) {
      const input=toggle.parentElement?.querySelector('input[name="token"]');
      if (input instanceof HTMLInputElement) {
        input.type=input.type==='password'?'text':'password';
        toggle.textContent=input.type==='password'?'Show':'Hide';
      }
    }
  },true);

  // The DDNS group action returns JSON, not another full Settings HTML page.
  // We only repaint the matching IPv4/IPv6 rows and their real result state.
  window.addEventListener('submit',event=>{
    const form=event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-b9-ddns-check]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.dataset.b9Busy==='1') return;
    form.dataset.b9Busy='1';
    const button=form.querySelector('button[type="submit"]');
    const previous=button?.textContent||'Update Now';
    if (button) { button.disabled=true;button.textContent='Updating…'; }
    const group=form.closest('[data-b9-ddns-provider]');
    const status=group?.querySelector('[data-b9-ddns-status]');
    // Provider table is status-only. Detailed errors belong to Notifications.
    group?.querySelectorAll('[data-b9-ddns-result]').forEach(el=>el.remove());
    if (status) {status.textContent='Updating';status.dataset.b10State='updating';}
    void (async()=>{
      try {
        const response=await fetch(form.action,{
          method:'POST',body:new FormData(form),credentials:'same-origin',
          headers:{'X-Requested-With':'XMLHttpRequest','Accept':'application/json'},
          cache:'no-store'
        });
        if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}).`);
        const data=await response.json();
        if (!data || typeof data.ok!=='boolean') throw new Error('Invalid DDNS response.');
        const failures=[];
        for (const record of (Array.isArray(data.records)?data.records:[])) {
          const row=Array.from(group?.querySelectorAll('[data-b9-ddns-record]')||[])
            .find(el=>el.dataset.b9DdnsRecord===record.id);
          if (!row)continue;
          if (/^(failed|error)/i.test(record.status||'')) {
            failures.push({
              family:row.closest('td')?.cellIndex===2?'ipv4':'ipv6',
              message:record.status
            });
          }
          const ip=row.querySelector('[data-b9-ddns-ip]');
          if (ip) ip.textContent=record.ipSource==='disabled'?'Disabled':record.ip||'Not checked';
          const marker=row.querySelector('[data-b11-family-state]');
          if (marker){
            const off=record.ipSource==='disabled';
            const failed=/^(failed|error)/i.test(record.status||'');
            const good=/^(updated|unchanged|ip unchanged)/i.test(record.status||'');
            marker.textContent=off?'Off':failed?'Failed':good?'Normal':'Not checked';
            marker.className='yrm-b11-ip-state '+(off?'is-off':failed?'is-failed':good?'is-normal':'is-unknown');
          }
          const last=group.querySelector('[data-b11-last-update]');
          if (last && record.lastRun)last.textContent=record.lastRun;
          const checked=row.querySelector('[data-b9-ddns-checked]');
          if (checked)checked.textContent=record.lastRun?`Checked ${record.lastRun}`:'Not checked yet';
          const error=row.querySelector('[data-b9-ddns-error]');
          if (error) {
            const failed=/^(failed|error)/i.test(record.status||'');
            error.hidden=true;
            error.textContent=failed?record.status:'';
          }
        }
        if (status) {status.textContent=data.ok?'Normal':'Failed';status.dataset.b10State=data.ok?'normal':'failed';}
        if(!data.ok) {
          // Prefer individual A / AAAA events instead of one duplicate group event.
          for (const failure of (failures.length?failures:[{
            family:'group',message:data.message||'Provider update failed.'
          }])) {
            window.dispatchEvent(new CustomEvent('yrm:notification',{detail:{
              kind:'ddns',severity:'error',title:'DDNS update failed',
              provider:group?.dataset.b9DdnsProvider,
              domain:group?.dataset.b9DdnsHostname,family:failure.family,
              source:group?.dataset.b9DdnsProvider+' · '+group?.dataset.b9DdnsHostname,
              message:failure.message
            }}));
          }
        }
      } catch (err) {
        if (status) {status.textContent='Unavailable';status.dataset.b10State='unavailable';}
        window.dispatchEvent(new CustomEvent('yrm:notification',{detail:{
          kind:'ddns',severity:'error',title:'DDNS update unavailable',
          provider:group?.dataset.b9DdnsProvider,
          domain:group?.dataset.b9DdnsHostname,family:'group',
          source:group?.dataset.b9DdnsProvider+' · '+group?.dataset.b9DdnsHostname,
          message:String(err.message||err)
        }}));
      } finally {
        delete form.dataset.b9Busy;
        if (button) {button.disabled=false;button.textContent=previous;}
      }
    })();
  },true);

  // Storage tabs: instant switch in the existing Settings page, no roundtrip.
  document.addEventListener('click',event=>{
    const tab=event.target instanceof Element ? event.target.closest('[data-b10-storage-tab]') : null;
    if (!(tab instanceof HTMLElement))return;
    const host=tab.closest('.server-settings-content');
    if (!host)return;
    const value=tab.dataset.b10StorageTab;
    host.querySelectorAll('[data-b10-storage-tab]').forEach(button=>{
      const active=button.dataset.b10StorageTab===value;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    host.querySelectorAll('[data-b10-storage-panel]').forEach(panel=>panel.hidden=panel.dataset.b10StoragePanel!==value);
    try {sessionStorage.setItem('yrm:storage-view',value);}catch{}
  },true);
  function restoreStorageTab(){
    const host=document.querySelector('.server-settings-content');
    const tab=host?.querySelector('[data-b10-storage-tab]');
    if (!tab || host.dataset.b10StorageRestored==='1')return;
    host.dataset.b10StorageRestored='1';
    let value='volumes';try{value=sessionStorage.getItem('yrm:storage-view')||value;}catch{}
    const target=host.querySelector(`[data-b10-storage-tab="${value==='disks'?'disks':'volumes'}"]`);
    if (target && value==='disks')target.click();
  }
  const storageTabObserver=new MutationObserver(restoreStorageTab);
  storageTabObserver.observe(document.body,{childList:true,subtree:true});
  restoreStorageTab();

  /* Unified firewall editor: one table, one dialog, one Save/Cancel draft.
     Real enforcement is delegated to FirewallService and the privileged helper. */
  let currentFwRoot=null,editingFwRow=null,newFwRow=false,fwOldDirty='';
  const firewallRoot=()=>get('v1-firewall-rules');
  const ruleFields=['scope','direction','action','port','protocol','source','remarks'];
  const ruleValue=(row,key)=>row?.querySelector(`[data-fw="${key}"]`)?.value||'';
  const showName={allow:'Allow',deny:'Deny',lan:'LAN only'};
  function paintFirewall(){
    const body=get('yrm-b11-fw-body'),root=firewallRoot();if(!body||!root)return;
    const rows=[...root.querySelectorAll('.v1-firewall-row')];
    const fragment=document.createDocumentFragment();
    if(rows.length===0){const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=6;td.className='yrm-b11-empty';td.textContent='No firewall rules configured.';
      tr.append(td);fragment.append(tr);}
    for(const [index,row] of rows.entries()){
      const tr=document.createElement('tr');tr.className='yrm-fw-table-row';tr.tabIndex=0;
      tr.dataset.b11FwEdit=String(index);tr.setAttribute('aria-label',`Edit firewall rule ${index+1}`);
      const cols=[ruleValue(row,'direction')||'inbound',ruleValue(row,'port'),
        ruleValue(row,'protocol').toUpperCase(),ruleValue(row,'source')||'Any',
        showName[ruleValue(row,'action')]||ruleValue(row,'action'),ruleValue(row,'remarks')];
      for(const [i,value] of cols.entries()){
        const td=document.createElement('td');td.textContent=value||'—';
        if(i===4)td.className='yrm-b11-fw-action '+(ruleValue(row,'action')==='deny'?'is-deny':'is-allow');
        if(i===0)td.textContent=value==='outbound'?'Outbound':'Inbound';
        if(i===3&&value.toLowerCase()==='any')td.textContent='Any';
        if(i===5){
          td.className='yrm-fw-remark';
          if(ruleValue(row,'scope')==='docker'){
            const tag=document.createElement('small');tag.className='yrm-fw-legacy-badge';tag.textContent='Docker';
            td.append(' ',tag);
          }
          const icon=document.createElement('span');icon.className='yrm-fw-row-edit';
          icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17-.5 3.5L7 20l11-11-3-3L4 17Zm9-10 3 3"/></svg>';
          td.append(icon);
        }
        tr.append(td);
      }
      fragment.append(tr);
    }
    body.replaceChildren(fragment);
  }
  function initializeFirewall(){
    const root=firewallRoot();if(!root||root===currentFwRoot)return;
    currentFwRoot=root;
    new MutationObserver(paintFirewall).observe(root,{childList:true,subtree:true});
    const checkbox=get('yrm-fw-enabled');
    checkbox?.addEventListener('change',()=>{
      const label=get('yrm-fw-status-text');if(label)label.textContent=checkbox.checked?'On':'Off';
      const note=get('v1-fw-dirty');if(note)note.textContent='Unsaved changes';
    });
    queueMicrotask(paintFirewall);
  }
  const fwDialog=()=>get('yrm-b11-fw-dialog');
  function closeFwEditor(){
    if(newFwRow&&editingFwRow?.isConnected){
      editingFwRow.querySelector('button.mini-button')?.click();
      const note=get('v1-fw-dirty');if(note)note.textContent=fwOldDirty;
    }
    editingFwRow=null;newFwRow=false;
    if(fwDialog()?.open)fwDialog().close();paintFirewall();
  }
  function syncFwEditor(){
    const dialog=fwDialog();if(!dialog)return;
    const direction=dialog.querySelector('[data-b11-fw-field="direction"]')?.value||'inbound';
    const scope=dialog.querySelector('[data-b11-fw-field="scope"]')?.value||'host';
    const label=dialog.querySelector('[data-b11-fw-address-label]');
    if(label)label.textContent=direction==='outbound'?'Destination IP / CIDR':'Source IP / CIDR';
    const action=dialog.querySelector('[data-b11-fw-field="action"]');
    if(action){
      const option=action.querySelector('option[value="lan"]');if(option)option.disabled=scope!=='docker';
      if(action.value==='lan'&&scope!=='docker'){action.value='allow';action.dispatchEvent(new Event('change'));}
    }
    const warning=dialog.querySelector('.yrm-fw-backend-warning');
    if(warning)warning.hidden=scope!=='docker';
  }
  function openFwEditor(row,isNew){
    const dialog=fwDialog();if(!(dialog instanceof HTMLDialogElement)||!row)return;
    editingFwRow=row;newFwRow=isNew;
    const title=get('yrm-b11-fw-title');if(title)title.textContent=isNew?'Add Rule':'Edit Rule';
    for(const key of ruleFields){
      const input=dialog.querySelector(`[data-b11-fw-field="${key}"]`);
      if(input){input.value=ruleValue(row,key)||(key==='direction'?'inbound':'');
        input.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    const source=ruleValue(row,'source')||'any';
    const mode=dialog.querySelector('[data-b11-fw-source-mode]');
    const input=dialog.querySelector('[data-b11-fw-field="source"]');
    if(mode)mode.value=source.toLowerCase()==='any'?'any':'custom';
    if(input){input.value=source.toLowerCase()==='any'?'':source;input.disabled=source.toLowerCase()==='any';}
    const error=get('yrm-b11-fw-error');if(error){error.hidden=true;error.textContent='';}
    const del=dialog.querySelector('[data-b11-fw-delete-in-modal]');if(del)del.hidden=isNew;
    dialog.querySelector('.yrm-fw-rule-advanced')?.removeAttribute('open');
    syncFwEditor();if(!dialog.open)dialog.showModal();
    dialog.querySelector('[data-b11-fw-field="port"]')?.focus();
  }
  document.addEventListener('change',event=>{
    const input=event.target instanceof Element?event.target:null;if(!input)return;
    const mode=input.closest('[data-b11-fw-source-mode]');
    if(mode){const target=mode.closest('dialog')?.querySelector('[data-b11-fw-field="source"]');
      if(target){target.disabled=mode.value==='any';if(target.disabled)target.value='';}}
    if(input.closest('[data-b11-fw-field="direction"],[data-b11-fw-field="scope"]'))syncFwEditor();
  },true);
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;if(!node)return;
    if(node.closest('[data-b11-fw-add]')){
      const root=firewallRoot();if(!root||root.querySelectorAll('.v1-firewall-row').length>=50)return;
      fwOldDirty=get('v1-fw-dirty')?.textContent||'';
      get('v1-firewall-form')?.querySelector('[data-fw-add]')?.click();
      openFwEditor(root.querySelector('.v1-firewall-row:last-child'),true);return;
    }
    const edit=node.closest('[data-b11-fw-edit]');
    if(edit){openFwEditor(firewallRoot()?.querySelectorAll('.v1-firewall-row')[Number(edit.dataset.b11FwEdit)],false);return;}
    if(node.closest('[data-b11-fw-cancel]')){closeFwEditor();return;}
    if(node.closest('[data-b11-fw-discard]')){
      window.dispatchEvent(new CustomEvent('yrm:firewall-restore'));paintFirewall();return;
    }
    if(node.closest('[data-b11-fw-delete-in-modal]')){
      if(editingFwRow?.isConnected)editingFwRow.querySelector('button.mini-button')?.click();
      editingFwRow=null;newFwRow=false;fwDialog()?.close();paintFirewall();return;
    }
    if(node.closest('[data-b11-fw-save]')){
      const d=fwDialog();if(!editingFwRow||!d)return;
      const values={};for(const key of ruleFields)values[key]=d.querySelector(`[data-b11-fw-field="${key}"]`)?.value.trim()||'';
      values.source=d.querySelector('[data-b11-fw-source-mode]')?.value==='any'?'any':values.source;
      const error=get('yrm-b11-fw-error');
      const invalid=msg=>{if(error){error.hidden=false;error.textContent=msg;}return;};
      if(values.source!=='any'&&!values.source)return invalid('Enter an IP address or CIDR range.');
      const portPattern=/^\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*$/;
      if(!portPattern.test(values.port))return invalid('Enter a port, list (80,443), or range (20-442).');
      if(values.port.split(',').some(segment=>{const [start,end=start]=segment.split('-').map(Number);return start<1||end>65535||start>end;}))
        return invalid('Port must be between 1 and 65535.');
      if(values.scope==='docker'&&values.direction==='outbound')return invalid('Docker outbound is not supported.');
      if(values.scope==='host'&&values.action==='lan')return invalid('LAN only applies to Docker. Use an IP range for Ubuntu.');
      if(values.scope==='docker'&&values.source!=='any')return invalid('Docker uses a preset LAN scope and Any IP.');
      for(const key of ruleFields){const original=editingFwRow.querySelector(`[data-fw="${key}"]`);
        if(original){original.value=values[key]||(key==='source'?'any':'');original.dispatchEvent(new Event('input',{bubbles:true}));}}
      editingFwRow=null;newFwRow=false;d.close();paintFirewall();
    }
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const row=event.target instanceof Element?event.target.closest('.yrm-fw-table-row'):null;
    if(row){event.preventDefault();row.click();}
  },true);
  document.addEventListener('cancel',event=>{if(event.target===fwDialog()){event.preventDefault();closeFwEditor();}},true);
  const fwObserver=new MutationObserver(initializeFirewall);
  fwObserver.observe(document.body,{childList:true,subtree:true});initializeFirewall();

  /* My Files: one static folder icon, one full-width surface.
     Single click toggles the list; double click opens My Files. */
  const myFilesTreeKey='yrm-panel:files-nav-open';
  function syncMyFilesTree(){
    const button=document.querySelector('[data-my-files-toggle]');
    const children=document.getElementById('yrm-my-files-children');
    if(!button||!children)return;
    let expanded=false;try{expanded=sessionStorage.getItem(myFilesTreeKey)==='1';}catch{}
    children.hidden=!expanded;
    button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',expanded?'Collapse My Files':'Expand My Files');
  }
  let myFilesClickTimer=null;
  function toggleMyFiles(button){
    if(!button.isConnected)return;
    const expanded=button.getAttribute('aria-expanded')!=='true';
    const children=document.getElementById('yrm-my-files-children');
    if(children)children.hidden=!expanded;
    button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',expanded?'Collapse My Files':'Expand My Files');
    try{sessionStorage.setItem(myFilesTreeKey,expanded?'1':'0');}catch{}
  }
  function cancelMyFilesClick(){
    if(myFilesClickTimer!==null)clearTimeout(myFilesClickTimer);
    myFilesClickTimer=null;
  }
  document.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest('[data-my-files-toggle]'):null;
    if(!button||button.dataset.fmNavigate==='1')return;
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    cancelMyFilesClick();
    if(event.detail>1)return;
    if(!event.detail){toggleMyFiles(button);return;}
    myFilesClickTimer=setTimeout(()=>{myFilesClickTimer=null;toggleMyFiles(button);},240);
  },true);
  document.addEventListener('dblclick',event=>{
    const button=event.target instanceof Element?event.target.closest('[data-my-files-toggle]'):null;
    if(!button||event.button!==0)return;
    event.preventDefault();cancelMyFilesClick();
    const href=button.dataset.fmHref||button.getAttribute('href');
    if(href){
      window.dispatchEvent(new CustomEvent('yrm-panel:navigate',{detail:href}));
    }else{
      button.dataset.fmNavigate='1';
      try{button.click();}finally{delete button.dataset.fmNavigate;}
    }
  },true);
  document.addEventListener('keydown',event=>{
    const button=event.target instanceof Element?event.target.closest('[data-my-files-toggle]'):null;
    if(!button||event.target!==button||event.key!==' ')return;
    event.preventDefault();cancelMyFilesClick();toggleMyFiles(button);
  },true);
  new MutationObserver(syncMyFilesTree).observe(document.body,{childList:true,subtree:true});
  syncMyFilesTree();

  /* Consistent, keyboard-operable dropdowns in DDNS and firewall editors.
     The original <select> is retained for native form submission and change
     listeners; no extra server API or third-party JS is introduced. */
  let openedSelect=null;
  function closeSelect(){if(!openedSelect)return;openedSelect.classList.remove('is-open');
    openedSelect.querySelector('.yrm-b11-select-toggle')?.setAttribute('aria-expanded','false');openedSelect=null;}
  function enhanceSelect(select){
    if(select.dataset.b11Enhanced==='1'||select.closest('.yrm-b10-provider-picker'))return;
    select.dataset.b11Enhanced='1';
    const wrapper=document.createElement('span');wrapper.className='yrm-b11-select';
    select.parentNode.insertBefore(wrapper,select);wrapper.append(select);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='yrm-b11-select-toggle';
    toggle.setAttribute('aria-haspopup','listbox');toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label',select.getAttribute('aria-label')||select.closest('label')?.textContent.trim()||'Choose option');
    const text=document.createElement('span');text.className='yrm-b11-select-current';
    const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');
    arrow.setAttribute('viewBox','0 0 24 24');arrow.setAttribute('class','yrm-b11-select-arrow');
    arrow.setAttribute('aria-hidden','true');
    const chevron=document.createElementNS('http://www.w3.org/2000/svg','path');
    chevron.setAttribute('d','m6 9 6 6 6-6');chevron.setAttribute('fill','none');
    chevron.setAttribute('stroke','currentColor');chevron.setAttribute('stroke-width','2');
    chevron.setAttribute('stroke-linecap','round');chevron.setAttribute('stroke-linejoin','round');
    arrow.append(chevron);
    toggle.append(text,arrow);
    const list=document.createElement('div');list.className='yrm-b11-select-list';list.setAttribute('role','listbox');
    function sync(){text.textContent=select.selectedOptions[0]?.textContent||'Select';
      list.querySelectorAll('[data-b11-select-option]').forEach(button=>{
        const selected=button.dataset.b11SelectOption===select.value;
        button.setAttribute('aria-selected',String(selected));
      });}
    [...select.options].forEach(option=>{
      const btn=document.createElement('button');btn.type='button';btn.className='yrm-b11-select-option';btn.dataset.b11SelectOption=option.value;
      btn.textContent=option.textContent;btn.setAttribute('role','option');btn.disabled=option.disabled;
      list.append(btn);
    });
    select.tabIndex=-1;wrapper.append(toggle,list);wrapper.b11Sync=sync;sync();
    select.addEventListener('change',sync);
  }
  function initializeSelects(){
    document.querySelectorAll('.yrm-b9-ddns-dialog select,.yrm-b10-ddns-dialog select,.yrm-b11-fw-dialog select,.yrm-b11-fw-status select,.fm-root-upload-dialog select')
      .forEach(enhanceSelect);
  }
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    if(!node)return;
    const option=node.closest('[data-b11-select-option]');
    if(option){const wrapper=option.closest('.yrm-b11-select');const select=wrapper?.querySelector('select');
      if(select){select.value=option.dataset.b11SelectOption;select.dispatchEvent(new Event('change',{bubbles:true}));}
      wrapper?.querySelector('.yrm-b11-select-toggle')?.focus();closeSelect();return;}
    const toggle=node.closest('.yrm-b11-select-toggle');
    if(toggle){const wrapper=toggle.closest('.yrm-b11-select'),reopen=openedSelect!==wrapper;
      closeSelect();if(reopen){openedSelect=wrapper;wrapper.classList.add('is-open');toggle.setAttribute('aria-expanded','true');}
      return;}
    if(!node.closest('.yrm-b11-select'))closeSelect();
  },true);
  // Provider templates may change other selects programmatically (without
  // firing their change event). Refresh their labels after that handler runs.
  document.addEventListener('change',event=>{
    if(event.target instanceof Element && event.target.id==='yrm-ddns-provider-preset'){
      queueMicrotask(()=>document.querySelectorAll('.yrm-b11-select').forEach(w=>w.b11Sync?.()));
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && openedSelect){closeSelect();event.preventDefault();return;}
    const node=event.target instanceof Element?event.target:null;
    const wrapper=node?.closest('.yrm-b11-select');if(!wrapper)return;
    if(!['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key))return;
    const select=wrapper.querySelector('select');if(!select||select.disabled)return;
    event.preventDefault();
    const options=[...select.options].filter(o=>!o.disabled);
    if(!options.length)return;
    if(event.key==='Enter'||event.key===' '){if(openedSelect===wrapper)closeSelect();else wrapper.querySelector('.yrm-b11-select-toggle')?.click();return;}
    let i=options.findIndex(o=>o.value===select.value);
    i=event.key==='Home'?0:event.key==='End'?options.length-1:
      (i+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
    select.value=options[i].value;select.dispatchEvent(new Event('change',{bubbles:true}));
  },true);
  const selectObserver=new MutationObserver(initializeSelects);
  selectObserver.observe(document.body,{childList:true,subtree:true});
  initializeSelects();
})();

