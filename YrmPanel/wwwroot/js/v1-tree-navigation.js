/* Persistent fnOS-style folder previews for YRMPanel Files.
   A chevron expands subdirectories in-place; entering a folder remains a
   separate navigation action. No Razor page refresh is needed for expansion. */
(() => {
  'use strict';
  const cache = new Map();
  const route = (path, library = false) => {
    const url = new URL('/Files', location.origin);
    url.searchParams.set('path', path);
    if (library) url.searchParams.set('nav', 'library');
    return url.pathname + url.search;
  };
  async function loadFolders(path) {
    if (cache.has(path)) return cache.get(path);
    const url = new URL('/Files', location.origin);
    url.searchParams.set('handler', 'Tree');
    url.searchParams.set('path', path);
    const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', headers: {'Accept': 'application/json'}});
    if (!response.ok || response.redirected) throw new Error(`Could not read folder (HTTP ${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data?.folders)) throw new Error('Invalid folder response.');
    const folders = data.folders.filter(name => typeof name === 'string' && name.length && name !== '.' && name !== '..');
    cache.set(path, folders);
    return folders;
  }
  function text(message, className='fm-tree-empty') {
    const small = document.createElement('span');small.className=className;small.textContent=message;
    return small;
  }
  function node(path, name, library) {
    const wrapper=document.createElement('div');wrapper.className='fm-tree-node';wrapper.dataset.fmTreeRoot=path;
    const head=document.createElement('div');head.className='fm-tree-node-header';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='fm-tree-toggle';
    toggle.dataset.fmTreeToggle='';toggle.dataset.fmTreePath=path;
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label',`Expand ${name}`);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('ui-icon');
    const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-chevron');svg.append(use);toggle.append(svg);
    const anchor=document.createElement('a');anchor.className='fm-location-link';anchor.href=route(path,library);
    const folderSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');folderSvg.classList.add('ui-icon');
    const folderUse=document.createElementNS('http://www.w3.org/2000/svg','use');folderUse.setAttribute('href','#i-folder');folderSvg.append(folderUse);
    const label=document.createElement('span');label.textContent=name;anchor.append(folderSvg,label);
    head.append(toggle,anchor);
    const descendants=document.createElement('div');descendants.className='fm-tree-descendants';descendants.hidden=true;
    wrapper.append(head,descendants);return wrapper;
  }
  function renderChildren(host,folders,path,library){
    host.replaceChildren();
    if (folders.length===0){host.append(text('No subfolders'));return;}
    for(const name of folders){
      const childPath=path ? path.replace(/\/$/,'') + '/' + name : name;
      host.append(node(childPath,name,library));
    }
  }
  async function toggleSidebar(button){
    const wrapper=button.closest('.fm-tree-node'),host=wrapper?.querySelector(':scope > .fm-tree-descendants');
    if(!host)return;
    const expanding=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(expanding));host.hidden=!expanding;
    if(!expanding||host.dataset.loaded==='1')return;
    host.replaceChildren(text('Loading subfolders…','fm-tree-loading'));
    try{
      const path=button.dataset.fmTreePath||'';
      const folders=await loadFolders(path);
      if(!host.isConnected)return;
      renderChildren(host,folders,path,true);host.dataset.loaded='1';
    }catch(err){host.replaceChildren(text(String(err.message||err)));}
  }
  async function toggleInline(button){
    const row=button.closest('tr[data-fm-inline-root]');if(!row)return;
    let preview=row.nextElementSibling;
    if(!preview?.classList.contains('fm-tree-preview-row')){
      preview=document.createElement('tr');preview.className='fm-tree-preview-row';
      const td=document.createElement('td');td.colSpan=row.querySelectorAll(':scope > td').length;
      const host=document.createElement('div');host.className='fm-inline-preview';td.append(host);preview.append(td);row.after(preview);
    }
    const host=preview.querySelector('.fm-inline-preview');if(!host)return;
    const expanding=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(expanding));preview.hidden=!expanding;
    if(!expanding||host.dataset.loaded==='1')return;
    host.replaceChildren(text('Loading subfolders…','fm-tree-loading'));
    try{
      const path=button.dataset.fmTreePath||'';
      const folders=await loadFolders(path);
      if(!host.isConnected)return;
      renderChildren(host,folders,path,false);host.dataset.loaded='1';
    }catch(err){host.replaceChildren(text(String(err.message||err)));}
  }
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    const button=target?.closest('[data-fm-tree-toggle],[data-fm-inline-toggle]');
    if(!(button instanceof HTMLButtonElement))return;
    event.preventDefault();event.stopPropagation();
    if(button.hasAttribute('data-fm-tree-toggle'))void toggleSidebar(button);
    else void toggleInline(button);
  },true);
  // Keep the active highlight on dynamically expanded navigation children.
  function refreshSelected(){
    const nav=document.querySelector('.fm-locations');if(!nav)return;
    const crumb=document.querySelector('.fm-breadcrumbs a:last-child');
    const current=crumb?.getAttribute('href')||'';
    nav.querySelectorAll('.fm-tree-node .fm-tree-node-header>a').forEach(a=>{
      a.classList.toggle('is-active',a.getAttribute('href')===current);
    });
  }
  document.addEventListener('click',event=>{
    if(event.target instanceof Element && event.target.closest('.fm-tree-node a'))requestAnimationFrame(refreshSelected);
  });
})();
