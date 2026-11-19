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

  /* DDNS: Add/Edit stays in the current desktop window; passwords remain
     empty on edit and are never read back from the backend. */
  document.addEventListener('click',event=>{
    const node=event.target;
    if (!(node instanceof Element))return;
    if (node.closest('[data-b9-ddns-add]')) {
      const dialog=get('yrm-b9-ddns-add');
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
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
    const previous=button?.textContent||'Check Now';
    if (button) { button.disabled=true;button.textContent='Checking…'; }
    const group=form.closest('[data-b9-ddns-provider]');
    const status=group?.querySelector('[data-b9-ddns-status]');
    let info=group?.querySelector('[data-b9-ddns-result]');
    if (status) status.textContent='Checking';
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
        if (status)status.textContent=data.ok?'Normal':'Failed';
        if (!data.ok && info) {info.hidden=false;info.textContent=data.message||'DDNS check failed.';}
      } catch (err) {
        if (status)status.textContent='Unavailable';
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
  window.setInterval(()=>void showUpdateStages(),2200);
  void showUpdateStages();
})();
