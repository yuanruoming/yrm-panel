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
  function renderUpdate(p, availability) {
    if (!updateTracker()) return;
    const state=String(p?.state||'idle').toLowerCase();
    const active=state==='running', completed=state==='completed';
    const available=availability?.available===true && availability?.hasUpdate===true;
    let pending=false;
    try {pending=sessionStorage.getItem(updatePendingKey)==='1'} catch {}
    const awaitingReload=completed&&pending;
    const phaseEl=$('yrm-update-phase'),msg=$('yrm-update-message'),stamp=$('yrm-update-time');
    const bar=$('yrm-update-bar'),fill=$('yrm-update-bar-fill'),text=$('yrm-update-percent');
    const reload=$('yrm-update-reload');
    const label=active?'Updating':awaitingReload?'Completed':available?'Update Available':
      state==='failed'?'Update Failed':availability?.available===true?'Up to Date':'Not Checked';
    if (phaseEl) phaseEl.textContent=label;
    if (msg) msg.textContent=active?'Updating YRM PANEL. Do not close this page.':
      awaitingReload?'Update installed successfully. Reload Panel.':
      available?(availability.message||'A new build is available.'):
      state==='failed'?(p?.message||'Update failed.'):
      availability?.available===true?'Your installed build is up to date.':'Check for updates to compare builds.';
    if (stamp) {
      const date=p?.at?new Date(p.at):null;
      stamp.textContent=date&&!Number.isNaN(date.getTime())&&(completed||state==='failed')
        ?`Last update: ${date.toLocaleString()}`:'';
    }
    if (bar) {
      bar.hidden=!(active||awaitingReload);
      bar.classList.toggle('is-indeterminate',active);
    }
    if (fill) fill.style.width=awaitingReload?'100%':'0%';
    if (text) text.textContent=awaitingReload?'100%':'';
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
      renderUpdate(data.progress,data.availability);
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


  // Dynu and Cloudflare use friendly presets; Custom keeps full HTTP freedom.
  function updateDdnsFields(form) {
    const auth=form.elements.namedItem('authType')?.value || 'header';
    const mode=form.elements.namedItem('responseMode')?.value || 'codes';
    const provider=$('yrm-ddns-provider-preset')?.value||'custom';
    const custom=provider==='custom';
    form.querySelectorAll('[data-ddns-auth]').forEach(node => {
      node.hidden=auth!==node.dataset.ddnsAuth;
      const input=node.querySelector('input');
      if (input) input.required=!node.hidden&&auth==='basic';
    });
    form.querySelectorAll('[data-ddns-response]').forEach(node => {
      node.hidden=mode!==node.dataset.ddnsResponse;
    });
    form.querySelectorAll('[data-ddns-technical]').forEach(node=>{node.hidden=!custom;});
    const credential=form.elements.namedItem('token');
    const credentialLabel=credential?.closest('label');
    if (credentialLabel) credentialLabel.hidden=auth==='none';
    if (credential) credential.required=auth!=='none';
    const title=$('yrm-ddns-secret-label');
    if (title) title.textContent=auth==='basic'?'IP Update Password':
      provider.startsWith('cloudflare')?'Cloudflare API Token':
      auth==='bearer'?'API Token':'Header value / API token';
    const note=$('yrm-ddns-provider-note');
    if (note) note.textContent=provider.startsWith('cloudflare')
      ?'Cloudflare: the API token needs Zone Read and DNS Edit. Create the A/AAAA record once in Cloudflare; its Proxy and TTL settings are preserved.'
      :provider.startsWith('dynu')
      ?'Dynu: enter your hostname, username and IP Update Password.'
      :'Custom: configure the API URL, authentication and response rules yourself.';
    const advanced=form.querySelector('.yrm-ddns-advanced');
    if (advanced && !custom) advanced.open=false;
  }
  function applyDdnsPreset(form) {
    const preset=$('yrm-ddns-provider-preset')?.value||'custom';
    const field=(name,val)=>{const node=form.elements.namedItem(name);if(node) node.value=val;};
    if (preset==='dynu4'||preset==='dynu6') {
      const v6=preset==='dynu6';
      field('provider','dynu');
      field('name',v6?'Dynu IPv6':'Dynu IPv4');
      field('recordType',v6?'AAAA':'A');
      field('httpMethod','GET');
      field('urlTemplate',v6
        ?'https://api-ipv6.dynu.com/nic/update?hostname={hostname}&myip=no&myipv6={ip}'
        :'https://api-ipv4.dynu.com/nic/update?hostname={hostname}&myip={ip}&myipv6=no');
      field('authType','basic');
      field('headerName','Authorization');
      field('bodyTemplate','');
      field('responseMode','codes');
      field('successCodes','good');
      field('unchangedCodes','nochg');
      field('errorCodes','badauth,nohost,notfqdn,unknown,servererror,911');
      field('detectionUrl','');
    } else if (preset==='cloudflare4'||preset==='cloudflare6') {
      const v6=preset==='cloudflare6';
      field('provider','cloudflare');
      field('name',v6?'Cloudflare IPv6':'Cloudflare IPv4');
      field('recordType',v6?'AAAA':'A');
      field('httpMethod','PATCH');
      field('urlTemplate','https://api.cloudflare.com/client/v4/zones');
      field('authType','bearer');
      field('headerName','Authorization');
      field('bodyTemplate','');
      field('responseMode','json');
      field('jsonProperty','success');
      field('jsonExpected','true');
      field('detectionUrl','');
    } else {
      field('provider','custom');
      field('name','Custom DDNS');
      field('httpMethod','PATCH');
      field('urlTemplate','');
      field('authType','header');
      field('headerName','Authorization');
      field('bodyTemplate','');
      field('responseMode','json');
      field('successCodes','');
      field('unchangedCodes','');
      field('errorCodes','');
    }
    // Never copy an earlier provider's secrets into a new profile.
    field('token','');field('username','');
    updateDdnsFields(form);
  }
  document.addEventListener('change', event=>{
    const target=event.target;
    if (!(target instanceof HTMLElement)) return;
    const form=target.closest('#yrm-ddns-new-form');
    if (!(form instanceof HTMLFormElement)) return;
    if (target.id==='yrm-ddns-provider-preset') applyDdnsPreset(form);
    if (target.id==='yrm-ddns-auth'||target.id==='yrm-ddns-response-mode') updateDdnsFields(form);
  },true);
  function initializeDdns() {
    const form=$('yrm-ddns-new-form');
    if (!(form instanceof HTMLFormElement) || form.dataset.initialized) return;
    form.dataset.initialized='1';
    applyDdnsPreset(form);
  }

  const initializeDraft = () => {
    const draft=$('v1-firewall-rules');
    if (draft && !draft.dataset.initialized) {
      draft.dataset.initialized='1';
      try { const raw=JSON.parse(draft.dataset.initial||'[]'); for (const rule of raw) addFirewallRow(rule); }
      catch { /* Invalid read-only helper response shows empty draft. */ }
    }
  };
  initializeDraft();
  initializeDdns();
  const observer = new MutationObserver(() => { initializeDraft(); initializeDdns(); });
  observer.observe(document.body,{childList:true,subtree:true});
})();
