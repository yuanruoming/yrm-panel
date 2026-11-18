/* Settings draft editing, update status and wall preview. Event delegation for AJAX navigation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const actions = ['allow','deny','lan'];
  function option(value,label,selected) {
    const el = document.createElement('option'); el.value = value; el.textContent = label;
    el.selected = selected === value; return el;
  }
  function field(name, value, values, placeholder) {
    let node;
    if (values) { node = document.createElement('select'); for (const [key,label] of values) node.append(option(key,label,value)); }
    else { node = document.createElement('input'); node.value=String(value ?? ''); node.placeholder=placeholder||''; }
    node.dataset.fw = name; node.setAttribute('aria-label',name); return node;
  }
  function addFirewallRow(data = {}) {
    const root = $('v1-firewall-rules'); if (!root || root.children.length >= 50) return;
    const row = document.createElement('div'); row.className='v1-firewall-row';
    row.append(field('scope',data.scope||'host',[['host','Host'],['docker','Docker']]));
    row.append(field('action',data.action||'allow',actions.map(x=>[x,x[0].toUpperCase()+x.slice(1)])));
    row.append(field('port',data.port||'',null,'80,443 or 20-442'));
    row.append(field('protocol',data.protocol||'tcp',[['tcp','TCP'],['udp','UDP']]));
    row.append(field('source',data.source||'any',null,'any · IP · CIDR'));
    const remove = document.createElement('button'); remove.type='button';
    remove.className='mini-button'; remove.textContent='×'; remove.title='Remove rule';
    remove.addEventListener('click',()=>{row.remove(); markDirty();});
    row.append(remove); root.append(row);
    row.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',markDirty));
  }
  function markDirty() {const p=$('v1-fw-dirty');if(p)p.textContent='Unsaved changes';}
  document.addEventListener('click', e=>{
    const x = e.target instanceof Element ? e.target.closest('[data-fw-add]') : null;
    if (x) { e.preventDefault(); addFirewallRow(); markDirty(); }
    const toggle = e.target instanceof Element ? e.target.closest('[data-wallpaper-fit]') : null;
    if (toggle) {
      e.preventDefault(); const img=$('wallpaper-preview');
      if (img instanceof HTMLImageElement) {
        img.style.objectFit = img.style.objectFit==='cover'?'contain':'cover';
        toggle.textContent = img.style.objectFit==='cover'?'Desktop crop':'Full image';
      }
    }
  },true);

  document.addEventListener('submit', e=>{
    const form=e.target;
    if (!(form instanceof HTMLFormElement) || form.id!=='v1-firewall-form') return;
    const root=$('v1-firewall-rules'); if (!root) return;
    const draft=[];
    for (const row of root.querySelectorAll('.v1-firewall-row')) {
      const get=name=>row.querySelector(`[data-fw="${name}"]`)?.value||'';
      const port=get('port').replace(/\s+/g,'');
      if (!/^\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*$/.test(port)) {
        e.preventDefault(); e.stopImmediatePropagation(); window.alert('Ports: use 80, 80,443, or 20-442.'); return;
      }
      draft.push({scope:get('scope'),action:get('action'),port,protocol:get('protocol'),source:get('source')||'any'});
    }
    const out=$('v1-fw-json');if(out)out.value=JSON.stringify(draft);
  },true);

  // The server reports real download bytes when HTTP provides a length.
  // Installation phases have no fabricated percentage, and completing requires
  // one explicit reload so users can read the result before the page resets.
  const updatePendingKey='yrm-panel:update-pending';
  const ucfirst=value=>value ? value[0].toUpperCase()+value.slice(1).toLowerCase() : 'Idle';
  const updateTracker=()=>document.getElementById('v1-update-progress');
  function renderUpdate(p) {
    if (!updateTracker()) return;
    const state=String(p?.state||'idle').toLowerCase();
    const phase=p?.phase || state;
    let pending=false;
    try { pending=sessionStorage.getItem(updatePendingKey)==='1'; } catch {}
    const complete=state==='completed', failed=state==='failed';
    const active=state==='running';
    const awaitingReload=complete&&pending;
    const percentage=Number.isInteger(p?.percent) && p.percent>=0 && p.percent<=100 ? p.percent : null;
    const bar=$('yrm-update-bar'),fill=$('yrm-update-bar-fill'),text=$('yrm-update-percent');
    const phaseEl=$('yrm-update-phase'),msg=$('yrm-update-message'),stamp=$('yrm-update-time'),reload=$('yrm-update-reload');
    if (phaseEl) phaseEl.textContent=awaitingReload?'Completed':complete?'Up to Date':ucfirst(phase);
    if (msg) msg.textContent=complete?(awaitingReload?'Update installed successfully. Reload to use the new interface.':'The latest installed build is ready.'):(p?.message||'');
    if (stamp) {
      const date=p?.at ? new Date(p.at) : null;
      stamp.textContent=date && !Number.isNaN(date.getTime()) && (complete || failed)
        ? `Last update: ${date.toLocaleString()}` : '';
    }
    if (text) text.textContent=awaitingReload?'100%':percentage!==null && active && String(phase).toLowerCase()==='downloading'?`${percentage}%` : '';
    if (bar) {
      bar.hidden=!(active||awaitingReload);
      bar.classList.toggle('is-indeterminate',active && (percentage===null || String(phase).toLowerCase()!=='downloading'));
    }
    if (fill) fill.style.width=(awaitingReload ? 100 : active && percentage!==null && String(phase).toLowerCase()==='downloading' ? percentage : 0)+'%';
    if (reload) reload.hidden=!awaitingReload;
  }
  let pendingPoll=false;
  async function pollUpdate() {
    if (!updateTracker() || pendingPoll) return;
    pendingPoll=true;
    try {
      const response=await fetch('/api/update/status',{credentials:'same-origin',cache:'no-store'});
      if (!response.ok) return;
      const data=await response.json();
      const state=(data.progress?.state||'').toLowerCase();
      if (state==='running') {
        try {if (sessionStorage.getItem(updatePendingKey)==='starting') sessionStorage.setItem(updatePendingKey,'1')} catch {}
      }
      renderUpdate(data.progress);
      if (state==='failed') try {sessionStorage.removeItem(updatePendingKey)} catch {}
    } catch { // Expected while Kestrel is restarting. Keep polling.
      const phase=$('yrm-update-phase');if(phase)phase.textContent='Reconnecting';
    } finally {pendingPoll=false;}
  }
  document.addEventListener('click',e=>{
    const target=e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-v1-update]')) {
      try {sessionStorage.setItem(updatePendingKey,'starting')} catch {}
    }
    if (target?.closest('#yrm-update-reload')) {
      try {sessionStorage.removeItem(updatePendingKey)} catch {}
      location.reload();
    }
  },true);
  window.setInterval(()=>{if(!document.hidden && updateTracker())void pollUpdate()},1500);
  void pollUpdate();

  const initializeDraft = () => {
    const draft=$('v1-firewall-rules');
    if (draft && !draft.dataset.initialized) {
      draft.dataset.initialized='1';
      try { const raw=JSON.parse(draft.dataset.initial||'[]'); for (const rule of raw) addFirewallRow(rule); }
      catch { /* Invalid read-only helper response shows empty draft. */ }
    }
  };
  initializeDraft();
  const observer = new MutationObserver(initializeDraft);
  observer.observe(document.body,{childList:true,subtree:true});
})();
