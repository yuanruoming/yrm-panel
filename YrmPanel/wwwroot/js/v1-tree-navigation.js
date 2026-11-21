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
    const folders = (Array.isArray(data.folderNodes) ? data.folderNodes : data.folders.map(name => ({name,hasChildren:true})))
      .filter(item => item && typeof item.name === 'string' && item.name && item.name !== '.' && item.name !== '..');
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
    for(const item of folders){
      const childPath=path ? path.replace(/\/$/,'') + '/' + item.name : item.name;
      host.append(node(childPath,item.name,library));
    }
  }
  async function toggleInline(button){
    const row=button.closest('tr[data-fm-inline-root]');if(!row)return;
    const expanding=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(expanding));
    const path=button.dataset.fmTreePath||'';
    if(!expanding){
      const preview=row.nextElementSibling;
      if(preview?.classList.contains('fm-tree-preview-row')) preview.hidden=true;
      return;
    }
    let preview=row.nextElementSibling;
    if(preview?.classList.contains('fm-tree-preview-row') && preview.dataset.loaded==='1'){
      preview.hidden=false;return;
    }
    try{
      const folders=await loadFolders(path);
      if(!row.isConnected || button.getAttribute('aria-expanded')!=='true')return;
      // Leaf folders still turn their chevron; there is simply no panel underneath.
      if(!folders.length)return;
      preview=row.nextElementSibling;
      if(!preview?.classList.contains('fm-tree-preview-row')){
        preview=document.createElement('tr');preview.className='fm-tree-preview-row';
        const td=document.createElement('td');td.colSpan=row.querySelectorAll(':scope > td').length;
        const host=document.createElement('div');host.className='fm-inline-preview';td.append(host);preview.append(td);row.after(preview);
      }
      renderChildren(preview.querySelector('.fm-inline-preview'),folders,path,false);
      preview.dataset.loaded='1';preview.hidden=false;
    }catch(err){
      button.setAttribute('aria-expanded','false');
      const rowPreview=row.nextElementSibling;
      if(rowPreview?.classList.contains('fm-tree-preview-row')) rowPreview.remove();
      console.warn('Files folder preview could not load:',err);
    }
  }
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    const button=target?.closest('[data-fm-inline-toggle]');
    if(!(button instanceof HTMLButtonElement))return;
    event.preventDefault();event.stopPropagation();
    void toggleInline(button);
  },true);
  // Nested previews use the same local data endpoint. Their chevrons must
  // actually expand, not merely look expandable or cause a full page load.
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    const button=target?.closest('[data-fm-tree-toggle]');
    if(!(button instanceof HTMLButtonElement))return;
    event.preventDefault();event.stopPropagation();
    const wrapper=button.closest('.fm-tree-node');
    const children=wrapper?.querySelector(':scope > .fm-tree-descendants');
    if(!children)return;
    const opening=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(opening));children.hidden=!opening;
    if(!opening||children.dataset.loaded==='1'){
      if(opening && children.dataset.hasChildren==='0') children.hidden=true;
      return;
    }
    const path=button.dataset.fmTreePath||'';
    void loadFolders(path).then(folders=>{
      if(!children.isConnected)return;
      renderChildren(children,folders,path,false);
      children.dataset.hasChildren=folders.length?'1':'0';
      if(!folders.length)children.hidden=true;
      children.dataset.loaded='1';
    }).catch(err=>children.replaceChildren(text(String(err.message||err))));
  },true);
  document.addEventListener('click',event=>{
    if(event.target instanceof Element && event.target.closest('.fm-history-refresh')) cache.clear();
  });
})();
