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
  // fnOS-style file selection: selecting a row exposes existing validated
  // Rename/Move/Delete handlers. This is only UI; server authorization stays.
  let selectedFileRow=null;
  function setFileSelection(row){
    if (selectedFileRow && selectedFileRow!==row)selectedFileRow.classList.remove('is-selected');
    selectedFileRow=row?.isConnected?row:null;
    selectedFileRow?.classList.add('is-selected');
    const toolbar=document.getElementById('yrm-b10-file-selection');
    if (!toolbar)return;
    toolbar.classList.toggle('has-selection', Boolean(selectedFileRow));
    const canWrite=Boolean(selectedFileRow?.querySelector('[data-b10-row-delete]'));
    for(const attr of ['data-b10-file-delete','data-b10-file-move','data-b10-file-rename']){
      const button=toolbar.querySelector(`[${attr}]`);
      if (button)button.disabled=!canWrite;
    }
    const copy=toolbar.querySelector('[data-b12-file-copy]');
    if(copy)copy.disabled=!selectedFileRow;
  }
  document.addEventListener('click',event=>{
    const target=event.target;
    if (!(target instanceof Element))return;
    const row=target.closest('[data-b10-file-row]');
    if (row && !target.closest('.explorer-item-menu,form,details,summary,input')) {
      setFileSelection(row);
      return;
    }
    if(target.closest('.explorer-table tbody') && !row)setFileSelection(null);
    const action=target.closest('[data-b10-file-rename],[data-b10-file-move],[data-b10-file-delete],[data-b12-file-copy]');
    if (!action || !selectedFileRow?.isConnected)return;
    if (action.matches('[data-b10-file-rename]'))selectedFileRow.querySelector('[data-rename-item]')?.click();
    if (action.matches('[data-b12-file-copy]'))selectedFileRow.querySelector('[data-copy-item]')?.click();
    if (action.matches('[data-b10-file-move]'))selectedFileRow.querySelector('[data-move-item]')?.click();
    if (action.matches('[data-b10-file-delete]'))selectedFileRow.querySelector('[data-b10-row-delete]')?.requestSubmit();
  },true);
  // fnOS-style: click selects a folder; double-click enters it.
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    const anchor=node?.closest('[data-b10-file-row] td.explorer-name a[href]');
    if(!anchor || anchor.dataset.yrmOpenOnDouble==='1')return;
    event.preventDefault();
    event.stopPropagation();
    setFileSelection(anchor.closest('[data-b10-file-row]'));
  },true);
  document.addEventListener('dblclick',event=>{
    const node=event.target instanceof Element?event.target:null;
    const anchor=node?.closest('[data-b10-file-row] td.explorer-name a[href]');
    if(!anchor)return;
    event.preventDefault();
    anchor.dataset.yrmOpenOnDouble='1';
    anchor.click();
    delete anchor.dataset.yrmOpenOnDouble;
  },true);
  const selectionObserver=new MutationObserver(()=>{
    if (selectedFileRow && !selectedFileRow.isConnected)setFileSelection(null);
  });
  selectionObserver.observe(document.body,{childList:true,subtree:true});

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
        for (const record of (Array.isArray(data.records)?data.records:[])) {
          const row=Array.from(group?.querySelectorAll('[data-b9-ddns-record]')||[])
            .find(el=>el.dataset.b9DdnsRecord===record.id);
          if (!row)continue;
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
            row.title=failed?record.status:(record.status||'');
          }
        }
        if (status) {status.textContent=data.ok?'Normal':'Failed';status.dataset.b10State=data.ok?'normal':'failed';}
        if(!data.ok) {
          window.dispatchEvent(new CustomEvent('yrm:notification',{detail:{
            kind:'ddns',severity:'error',title:'DDNS update failed',
            source:group?.dataset.b9DdnsProvider+' · '+group?.dataset.b9DdnsHostname,
            message:data.message||'Provider update failed.'
          }}));
        }
      } catch (err) {
        if (status) {status.textContent='Unavailable';status.dataset.b10State='unavailable';}
        window.dispatchEvent(new CustomEvent('yrm:notification',{detail:{
          kind:'ddns',severity:'error',title:'DDNS update unavailable',
          source:group?.dataset.b9DdnsProvider+' · '+group?.dataset.b9DdnsHostname,
          message:String(err.message||err)
        }}));
      } finally {
        delete form.dataset.b9Busy;
        if (button) {button.disabled=false;button.textContent=previous;}
      }
    })();
  },true);

  /* Update stages: use systemd updater's JSON phase, never a fake progress
     percentage. Download bytes have a value only when Content-Length is known. */
  let b9UpdatePending=false;
  async function showUpdateStages() {
    const stages=get('yrm-b9-update-stages');
    if (!stages || b9UpdatePending || document.hidden) return;
    b9UpdatePending=true;
    try {
      const response=await fetch('/api/update/status',{credentials:'same-origin',cache:'no-store'});
      if (!response.ok) return;
      const {progress}=await response.json();
      const state=String(progress?.state||'idle').toLowerCase();
      const phase=String(progress?.phase||'').toLowerCase();
      stages.hidden=state!=='running' && state!=='completed' && state!=='failed';
      const detailPanel=get('yrm-b10-update-details');
      if (detailPanel) detailPanel.hidden=state!=='running' && state!=='failed';
      if (stages.hidden)return;
      const order=['checking','downloading','verifying','installing','restarting','completed'];
      let index=order.indexOf(phase);
      if (state==='completed')index=5;
      if (index<0)index=0;
      stages.querySelectorAll('[data-b9-update-stage]').forEach((li,i)=>{
        li.classList.toggle('is-done',i<index || state==='completed');
        li.classList.toggle('is-current',i===index && state==='running');
        li.classList.toggle('is-failed',i===index && state==='failed');
        const base=li.dataset.b9UpdateStage;
        li.textContent=base + (i===index && state==='running' &&
          phase==='downloading' && Number.isFinite(progress.percent)
            ? ` · ${Math.max(0,Math.min(99,progress.percent))}%` : '');
      });
      const detail=get('yrm-b9-update-detail');
      if (detail) {
        detail.hidden=false;
        detail.textContent=progress.message||'';
      }
    } catch { // Expected while the Panel service restarts; poll after recovery.
    } finally {b9UpdatePending=false;}
  }
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
  window.setInterval(()=>void showUpdateStages(),2200);
  void showUpdateStages();

  /* BETA11: a single firewall list + edit dialog. The existing v1-settings
     form remains authoritative: its original hidden draft rows serialize
     and validate the rules, and the server still controls UFW rollback. */
  let currentFwRoot=null,editingFwRow=null,newFwRow=false,fwOldDirty='';
  const firewallRoot=()=>get('v1-firewall-rules');
  const ruleFields=['scope','action','port','protocol','source'];
  const ruleValue=(row,key)=>row?.querySelector(`[data-fw="${key}"]`)?.value||'';
  function paintFirewall(){
    const body=get('yrm-b11-fw-body'),root=firewallRoot();
    if (!body || !root)return;
    const rows=Array.from(root.querySelectorAll('.v1-firewall-row'));
    const fragment=document.createDocumentFragment();
    if(!rows.length){const tr=document.createElement('tr');const td=document.createElement('td');
      td.colSpan=6;td.className='yrm-b11-empty';td.textContent='No firewall rules configured.';tr.append(td);fragment.append(tr);}
    for(const [index,row] of rows.entries()){
      const tr=document.createElement('tr');
      for(const key of ruleFields){
        const td=document.createElement('td');td.textContent=ruleValue(row,key)||'—';
        if(key==='action')td.className='yrm-b11-fw-action '+(ruleValue(row,key)==='deny'?'is-deny':'is-allow');
        tr.append(td);
      }
      const td=document.createElement('td');td.className='yrm-b11-fw-row-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='yrm-b11-icon-action';edit.textContent='Edit';edit.dataset.b11FwEdit=String(index);
      const remove=document.createElement('button');remove.type='button';remove.className='yrm-b11-icon-action is-delete';remove.textContent='Delete';remove.dataset.b11FwDelete=String(index);
      td.append(edit,remove);tr.append(td);fragment.append(tr);
    }
    body.replaceChildren(fragment);
  }
  function initializeFirewall(){
    const root=firewallRoot();if(!root||root===currentFwRoot)return;
    currentFwRoot=root;
    // v1-settings may finish generating initial draft rows in an earlier
    // MutationObserver callback. Delay the first paint until that completes.
    new MutationObserver(paintFirewall).observe(root,{childList:true,subtree:true});
    queueMicrotask(paintFirewall);
  }
  function fwDialog(){return get('yrm-b11-fw-dialog');}
  function closeFwEditor(){
    if(newFwRow&&editingFwRow?.isConnected){
      editingFwRow.querySelector('button.mini-button')?.click();
      const dirty=get('v1-fw-dirty');if(dirty)dirty.textContent=fwOldDirty;
    }
    editingFwRow=null;newFwRow=false;
    fwDialog()?.close();
    paintFirewall();
  }
  function openFwEditor(row,isNew){
    const dialog=fwDialog();if(!(dialog instanceof HTMLDialogElement)||!row)return;
    editingFwRow=row;newFwRow=isNew;
    const title=get('yrm-b11-fw-title');if(title)title.textContent=isNew?'Add Firewall Rule':'Edit Firewall Rule';
    for(const key of ruleFields){
      const input=dialog.querySelector(`[data-b11-fw-field="${key}"]`);
      if(input){input.value=ruleValue(row,key);input.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    const error=get('yrm-b11-fw-error');if(error){error.hidden=true;error.textContent='';}
    if(!dialog.open)dialog.showModal();
    dialog.querySelector('[data-b11-fw-field="port"]')?.focus();
  }
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    if(!node)return;
    if(node.closest('[data-b11-fw-add]')){
      const root=firewallRoot();if(!root)return;
      if(root.querySelectorAll('.v1-firewall-row').length>=50)return;
      fwOldDirty=get('v1-fw-dirty')?.textContent||'';
      get('v1-firewall-form')?.querySelector('[data-fw-add]')?.click();
      const row=root.querySelector('.v1-firewall-row:last-child');
      openFwEditor(row,true);return;
    }
    const edit=node.closest('[data-b11-fw-edit]');
    if(edit){openFwEditor(firewallRoot()?.querySelectorAll('.v1-firewall-row')[Number(edit.dataset.b11FwEdit)],false);return;}
    const remove=node.closest('[data-b11-fw-delete]');
    if(remove){firewallRoot()?.querySelectorAll('.v1-firewall-row')[Number(remove.dataset.b11FwDelete)]?.querySelector('button.mini-button')?.click();paintFirewall();return;}
    if(node.closest('[data-b11-fw-cancel]')){closeFwEditor();return;}
    if(node.closest('[data-b11-fw-save]')){
      const d=fwDialog();if(!editingFwRow||!d)return;
      const values={};for(const key of ruleFields)values[key]=d.querySelector(`[data-b11-fw-field="${key}"]`)?.value.trim()||'';
      const error=get('yrm-b11-fw-error');
      if(!/^\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*$/.test(values.port)){
        if(error){error.textContent='Enter a valid port, list (80,443), or range (20-442).';error.hidden=false;}return;
      }
      for(const key of ruleFields){const original=editingFwRow.querySelector(`[data-fw="${key}"]`);
        if(original){original.value=values[key]||(key==='source'?'any':'');original.dispatchEvent(new Event('input',{bubbles:true}));}}
      editingFwRow=null;newFwRow=false;d.close();paintFirewall();
    }
  },true);
  document.addEventListener('cancel',event=>{if(event.target===fwDialog()){event.preventDefault();closeFwEditor();}},true);
  const fwObserver=new MutationObserver(initializeFirewall);
  fwObserver.observe(document.body,{childList:true,subtree:true});
  initializeFirewall();

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
    const arrow=document.createElement('span');arrow.className='yrm-b11-select-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='⌄';
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
    document.querySelectorAll('.yrm-b9-ddns-dialog select,.yrm-b10-ddns-dialog select,.yrm-b11-fw-dialog select,.yrm-b11-fw-status select')
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
