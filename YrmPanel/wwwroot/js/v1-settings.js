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
    row.append(field('port',data.port||'',null,'Port'));
    row.append(field('protocol',data.protocol||'tcp',[['tcp','TCP'],['udp','UDP']]));
    row.append(field('source',data.source||'any',null,'any or CIDR'));
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
      const port=Number(get('port'));
      if (!Number.isInteger(port)||port<1||port>65535) {
        e.preventDefault(); e.stopImmediatePropagation(); window.alert('Each firewall rule needs a port from 1 to 65535.'); return;
      }
      draft.push({scope:get('scope'),action:get('action'),port,protocol:get('protocol'),source:get('source')||'any'});
    }
    const out=$('v1-fw-json');if(out)out.value=JSON.stringify(draft);
  },true);

  let updaterStarted=false, lastReload='';
  async function pollUpdate() {
    const host=$('v1-update-progress'); if (!host) return;
    try {
      const result=await fetch('/api/update/status',{credentials:'same-origin',cache:'no-store'});
      if (!result.ok) return;
      const data=await result.json();
      const state=data.progress?.state||'idle';
      host.textContent=`${state}: ${data.progress?.message||''}`;
      if (state==='running') updaterStarted=true;
      if (state==='completed' && updaterStarted) {
        const key=`yrm-v1-updated-${data.version}-${data.progress?.at||''}`;
        if (lastReload!==key && sessionStorage.getItem(key)!=='1') {
          lastReload=key;sessionStorage.setItem(key,'1');location.reload();
        }
      }
    } catch { /* Service restarts during update. Keep polling. */ }
  }
  document.addEventListener('click',e=>{
    const b=e.target instanceof Element ? e.target.closest('[data-v1-update]') : null;
    if (b) updaterStarted=true;
  },true);
  window.setInterval(()=>{if (!document.hidden && $('v1-update-progress'))void pollUpdate();},2000);

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
