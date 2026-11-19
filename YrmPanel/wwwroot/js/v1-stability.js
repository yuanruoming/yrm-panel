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
    const {owner,proxy}=floatingMenu;
    if (!owner.isConnected) {closeFloatingMenu();return;}
    const rect=owner.querySelector('summary')?.getBoundingClientRect();
    if (!rect) {closeFloatingMenu();return;}
    const width=proxy.offsetWidth||174,height=proxy.offsetHeight;
    proxy.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.right-width))}px`;
    proxy.style.top=`${innerHeight-rect.bottom>=height+12 || innerHeight-rect.bottom>=rect.top
      ?rect.bottom+5:Math.max(8,rect.top-height-5)}px`;
  }
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
      floatingMenu={owner,proxy};
      positionFloatingMenu();
      return;
    }
    if (floatingMenu && !floatingMenu.proxy.contains(el))closeFloatingMenu();
  },true);
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape' && floatingMenu){closeFloatingMenu();event.preventDefault();}
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
    toolbar.hidden=!selectedFileRow;
    const label=document.getElementById('yrm-b10-selected-name');
    if (label)label.textContent=selectedFileRow?.dataset.b10Filename||'1 selected';
    const canWrite=Boolean(selectedFileRow?.querySelector('[data-b10-row-delete]'));
    for(const attr of ['data-b10-file-delete','data-b10-file-move','data-b10-file-rename']){
      const button=toolbar.querySelector(`[${attr}]`);
      if (button)button.disabled=!canWrite;
    }
  }
  document.addEventListener('click',event=>{
    const target=event.target;
    if (!(target instanceof Element))return;
    const row=target.closest('[data-b10-file-row]');
    if (row && !target.closest('button,a,form,details,summary,input')) {
      setFileSelection(selectedFileRow===row?null:row);
      return;
    }
    if (target.closest('[data-b10-file-clear]')) {setFileSelection(null);return;}
    const action=target.closest('[data-b10-file-rename],[data-b10-file-move],[data-b10-file-delete]');
    if (!action || !selectedFileRow?.isConnected)return;
    if (action.matches('[data-b10-file-rename]'))selectedFileRow.querySelector('[data-rename-item]')?.click();
    if (action.matches('[data-b10-file-move]'))selectedFileRow.querySelector('[data-move-item]')?.click();
    if (action.matches('[data-b10-file-delete]'))selectedFileRow.querySelector('[data-b10-row-delete]')?.requestSubmit();
  },true);
  const selectionObserver=new MutationObserver(()=>{
    if (selectedFileRow && !selectedFileRow.isConnected)setFileSelection(null);
  });
  selectionObserver.observe(document.body,{childList:true,subtree:true});

  // Read-only folders still expose More; copying a path requires no sudo.
  document.addEventListener('click',event=>{
    const button=event.target instanceof Element ? event.target.closest('[data-b10-copy-path]') : null;
    if (!button)return;
    const path=button.dataset.b10CopyPath||'';
    if (path)void navigator.clipboard?.writeText(path).catch(()=>{});
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
    let info=group?.querySelector('[data-b9-ddns-result]');
    if (status) {status.textContent='Updating';status.dataset.b10State='updating';}
    if (!info && group) {
      info=document.createElement('p');
      info.dataset.b9DdnsResult='1';
      info.className='yrm-b9-ddns-feedback';
      group.append(info);
    }
    if (info) {info.textContent='';info.hidden=true;}
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
          const checked=row.querySelector('[data-b9-ddns-checked]');
          if (checked)checked.textContent=record.lastRun?`Checked ${record.lastRun}`:'Not checked yet';
          const error=row.querySelector('[data-b9-ddns-error]');
          if (error) {
            const failed=/^(failed|error)/i.test(record.status||'');
            error.hidden=!failed;
            error.textContent=failed?record.status:'';
          }
        }
        if (status) {status.textContent=data.ok?'Normal':'Failed';status.dataset.b10State=data.ok?'normal':'failed';}
        if (!data.ok && info) {info.hidden=false;info.textContent=data.message||'DDNS update failed.';}
      } catch (err) {
        if (status) {status.textContent='Unavailable';status.dataset.b10State='unavailable';}
        if (info) {info.hidden=false;info.textContent=String(err.message||err);}
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
})();
