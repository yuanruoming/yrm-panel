/* Settings interaction: UFW draft, DDNS presets, wallpaper, single update-status owner. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const actions=['allow','deny','lan'];
  const option=(value,label,selected)=>{
    const item=document.createElement('option');item.value=value;item.textContent=label;item.selected=value===selected;
    return item;
  };
  function field(name,value,values,placeholder){
    const el=values?document.createElement('select'):document.createElement('input');
    if(values)for(const [key,label] of values)el.append(option(key,label,value));
    else{el.value=String(value??'');el.placeholder=placeholder||'';}
    el.dataset.fw=name;el.setAttribute('aria-label',name);return el;
  }
  function markDirty(){const el=$('v1-fw-dirty');if(el)el.textContent='Unsaved changes';}
  function addFirewallRow(data={}){
    const root=$('v1-firewall-rules');if(!root||root.children.length>=50)return;
    const row=document.createElement('div');row.className='v1-firewall-row';
    row.append(field('scope',data.scope||'host',[['host','Host'],['docker','Docker']]));
    row.append(field('direction',data.direction||'inbound',[['inbound','Inbound'],['outbound','Outbound']]));
    row.append(field('action',data.action||'allow',actions.map(x=>[x,x[0].toUpperCase()+x.slice(1)])));
    row.append(field('port',data.port||'',null,'80,443 or 20-442'));
    row.append(field('protocol',data.protocol||'tcp',[['tcp','TCP'],['udp','UDP']]));
    row.append(field('source',data.source||'any',null,'any · IP · CIDR'));
    row.append(field('remarks',data.remarks||'',null,'Optional remarks'));
    const del=document.createElement('button');del.type='button';del.className='mini-button';del.textContent='×';del.setAttribute('aria-label','Remove rule');
    del.addEventListener('click',()=>{row.remove();markDirty();});row.append(del);root.append(row);
    row.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',markDirty));
  }
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;if(!node)return;
    if(node.closest('[data-fw-add]')){event.preventDefault();addFirewallRow();markDirty();}
    const toggle=node.closest('[data-wallpaper-fit]');
    if(toggle){
      event.preventDefault();const image=$('wallpaper-preview');
      if(image instanceof HTMLImageElement){
        image.style.objectFit=image.style.objectFit==='cover'?'contain':'cover';
        toggle.textContent=image.style.objectFit==='cover'?'Desktop crop':'Full image';
      }
    }
  },true);
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement)||form.id!=='v1-firewall-form')return;
    const root=$('v1-firewall-rules');if(!root)return;
    const draft=[];
    for(const row of root.querySelectorAll('.v1-firewall-row')){
      const value=name=>row.querySelector(`[data-fw="${name}"]`)?.value||'';
      const port=value('port').replace(/\s+/g,'');
      if(!/^\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*$/.test(port)){
        event.preventDefault();event.stopImmediatePropagation();
        let note=form.querySelector('.yrm-inline-error');
        if(!note){note=document.createElement('div');note.className='yrm-inline-error';form.append(note);}
        note.textContent='Use valid ports (80,443) or range (20-442).';return;
      }
      draft.push({scope:value('scope'),direction:value('direction'),action:value('action'),port,protocol:value('protocol'),source:value('source')||'any',remarks:value('remarks')||''});
    }
    const output=$('v1-fw-json');if(output)output.value=JSON.stringify(draft);
  },true);

  // One update controller. The current phase REPLACES its predecessor in
  // the same status line; only download percentages reported by the server
  // are displayed, never invented install percentages.
  const updatePendingKey='yrm-panel:update-pending';
  const updateTracker=()=>$('v1-update-progress');
  const phaseNames={checking:'Checking',downloading:'Downloading',verifying:'Verifying',installing:'Installing',restarting:'Restarting',completed:'Completed'};
  function renderUpdate(p,availability){
    if(!updateTracker())return;
    const state=String(p?.state||'idle').toLowerCase();
    const phase=String(p?.phase||'').toLowerCase();
    const active=state==='running',completed=state==='completed';
    const available=availability?.available===true&&availability?.hasUpdate===true;
    let pending=false;try{pending=sessionStorage.getItem(updatePendingKey)==='1';}catch{}
    const awaitingReload=completed&&pending;
    const phaseEl=$('yrm-update-phase'),msg=$('yrm-update-message'),stamp=$('yrm-update-time');
    const bar=$('yrm-update-bar'),fill=$('yrm-update-bar-fill'),text=$('yrm-update-percent'),reload=$('yrm-update-reload');
    const label=active?'Updating':awaitingReload?'Completed':available?'Update Available':
      state==='failed'?'Update Failed':availability?.available===true?'Up to Date':'Not Checked';
    if(phaseEl)phaseEl.textContent=active?(phaseNames[phase]||label):label;
    if(msg)msg.textContent=active?(p?.message||'Update in progress.'):
      awaitingReload?'Update installed successfully. Reload Panel.':
      available?(availability.message||'A new build is available.'):
      state==='failed'?(p?.message||'Update failed.'):
      availability?.available===true?'Your installed build is up to date.':'Check for updates to compare builds.';
    if(stamp)stamp.textContent=''; // Version information matters more than timestamps.
    if(bar){bar.hidden=!(active||awaitingReload);bar.classList.toggle('is-indeterminate',active&&!(phase==='downloading'&&p?.percent!=null&&Number.isFinite(Number(p.percent))));}
    const actualPercent=active&&phase==='downloading'&&p?.percent!=null&&Number.isFinite(Number(p.percent))?Math.max(0,Math.min(100,Number(p.percent))):null;
    if(fill)fill.style.width=awaitingReload?'100%':actualPercent===null?'0%':`${actualPercent}%`;
    if(text)text.textContent=awaitingReload?'100%':actualPercent===null?'':`${Math.round(actualPercent)}%`;
    if(reload)reload.hidden=!awaitingReload;
  }
  let pendingPoll=false;
  async function pollUpdate(){
    if(!updateTracker()||pendingPoll)return;pendingPoll=true;
    try{
      const response=await fetch('/api/update/status',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      const state=String(data.progress?.state||'').toLowerCase();
      if(state==='running')try{if(sessionStorage.getItem(updatePendingKey)==='starting')sessionStorage.setItem(updatePendingKey,'1');}catch{}
      renderUpdate(data.progress,data.availability);
      if(state==='failed')try{sessionStorage.removeItem(updatePendingKey);}catch{}
    }catch{
      const phase=$('yrm-update-phase');if(phase)phase.textContent='Reconnecting';
    }finally{pendingPoll=false;}
  }
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest('[data-v1-update]'))try{sessionStorage.setItem(updatePendingKey,'starting');}catch{}
    if(target?.closest('#yrm-update-reload')){
      try{sessionStorage.removeItem(updatePendingKey);}catch{}
      location.reload();
    }
  },true);
  setInterval(()=>{if(!document.hidden&&updateTracker())void pollUpdate();},1500);
  void pollUpdate();

  // Keep the original native-form Dynu/Cloudflare and Custom HTTPS presets.
  // Wallpaper preview is a local dialog, not a route or full-page reload.
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    const dialog=document.getElementById('yrm-wallpaper-lightbox');
    if(!(dialog instanceof HTMLDialogElement)||!node)return;
    if(node.closest('[data-wallpaper-preview-close]')){dialog.close();return;}
    if(node.closest('[data-wallpaper-preview-open]')){
      const source=document.getElementById('wallpaper-preview');
      const image=document.getElementById('yrm-wallpaper-lightbox-image');
      if(source instanceof HTMLImageElement && image instanceof HTMLImageElement){
        image.src=source.currentSrc||source.src;
        if(!dialog.open)dialog.showModal();
      }
    }
  });
  function updateDdnsFields(form){
    const auth=form.elements.namedItem('authType')?.value||'header';
    const mode=form.elements.namedItem('responseMode')?.value||'codes';
    const provider=$('yrm-ddns-provider-preset')?.value||'custom';const custom=provider==='custom';
    form.querySelectorAll('[data-ddns-auth]').forEach(node=>{
      node.hidden=auth!==node.dataset.ddnsAuth;
      const input=node.querySelector('input');if(input)input.required=!node.hidden&&auth==='basic';
    });
    form.querySelectorAll('[data-ddns-response]').forEach(node=>{node.hidden=mode!==node.dataset.ddnsResponse;});
    form.querySelectorAll('[data-ddns-technical]').forEach(node=>{node.hidden=!custom;});
    const credential=form.elements.namedItem('token');const credentialLabel=credential?.closest('label');
    if(credentialLabel)credentialLabel.hidden=auth==='none';
    if(credential)credential.required=auth!=='none';
    const title=$('yrm-ddns-secret-label');
    if(title)title.textContent=auth==='basic'?'IP Update Password':provider.startsWith('cloudflare')?'Cloudflare API Token':auth==='bearer'?'API Token':'Header value / API token';
    const note=$('yrm-ddns-provider-note');
    if(note)note.textContent=provider.startsWith('cloudflare')
      ?'Cloudflare: API token needs Zone Read and DNS Edit. Existing record Proxy and TTL are preserved.'
      :provider.startsWith('dynu')?'Dynu: enter hostname, username and IP Update Password.':'Custom HTTPS API';
    const advanced=form.querySelector('.yrm-ddns-advanced');if(advanced&&!custom)advanced.open=false;
  }
  function applyDdnsPreset(form){
    const preset=$('yrm-ddns-provider-preset')?.value||'custom';
    const field=(name,val)=>{const node=form.elements.namedItem(name);if(node)node.value=val;};
    if(preset==='dynu4'||preset==='dynu6'){
      const v6=preset==='dynu6';field('provider','dynu');field('name',v6?'Dynu IPv6':'Dynu IPv4');field('recordType',v6?'AAAA':'A');
      field('httpMethod','GET');field('urlTemplate',v6?'https://api-ipv6.dynu.com/nic/update?hostname={hostname}&myip=no&myipv6={ip}':'https://api-ipv4.dynu.com/nic/update?hostname={hostname}&myip={ip}&myipv6=no');
      field('authType','basic');field('headerName','Authorization');field('bodyTemplate','');field('responseMode','codes');
      field('successCodes','good');field('unchangedCodes','nochg');field('errorCodes','badauth,nohost,notfqdn,unknown,servererror,911');field('detectionUrl','');
    }else if(preset==='cloudflare4'||preset==='cloudflare6'){
      const v6=preset==='cloudflare6';field('provider','cloudflare');field('name',v6?'Cloudflare IPv6':'Cloudflare IPv4');field('recordType',v6?'AAAA':'A');
      field('httpMethod','PATCH');field('urlTemplate','https://api.cloudflare.com/client/v4/zones');field('authType','bearer');
      field('headerName','Authorization');field('bodyTemplate','');field('responseMode','json');field('jsonProperty','success');field('jsonExpected','true');field('detectionUrl','');
    }else{
      field('provider','custom');field('name','Custom DDNS');field('httpMethod','PATCH');field('urlTemplate','');field('authType','header');
      field('headerName','Authorization');field('bodyTemplate','');field('responseMode','json');field('successCodes','');field('unchangedCodes','');field('errorCodes','');
    }
    field('token','');field('username','');updateDdnsFields(form);
  }
  document.addEventListener('change',event=>{
    const target=event.target;if(!(target instanceof HTMLElement))return;
    const form=target.closest('#yrm-ddns-new-form');if(!(form instanceof HTMLFormElement))return;
    if(target.id==='yrm-ddns-provider-preset')applyDdnsPreset(form);
    if(target.id==='yrm-ddns-auth'||target.id==='yrm-ddns-response-mode')updateDdnsFields(form);
  },true);
  function initializeDdns(){
    const form=$('yrm-ddns-new-form');if(!(form instanceof HTMLFormElement)||form.dataset.initialized)return;
    form.dataset.initialized='1';applyDdnsPreset(form);
  }
  function initializeDraft(){
    const root=$('v1-firewall-rules');if(!root||root.dataset.initialized)return;
    root.dataset.initialized='1';
    try{const rows=JSON.parse(root.dataset.initial||'[]');for(const rule of rows)addFirewallRow(rule);}catch{}
  }
  // One-click Cancel on the main firewall page restores the server draft
  // without issuing any network command. The status checkbox is reset too.
  window.addEventListener('yrm:firewall-restore',()=>{
    const root=$('v1-firewall-rules');if(!root)return;
    let values=[];try{values=JSON.parse(root.dataset.initial||'[]');}catch{}
    root.replaceChildren();for(const entry of values)addFirewallRow(entry);
    const checkbox=$('yrm-fw-enabled');if(checkbox)checkbox.checked=checkbox.defaultChecked;
    const label=$('yrm-fw-status-text');if(label&&checkbox)label.textContent=checkbox.checked?'On':'Off';
    const dirty=$('v1-fw-dirty');if(dirty)dirty.textContent='';
  });
  initializeDraft();initializeDdns();
  new MutationObserver(()=>{initializeDraft();initializeDdns();}).observe(document.body,{childList:true,subtree:true});
})();
