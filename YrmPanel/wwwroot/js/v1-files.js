/* Native-feeling Files: choose uploads immediately, ask only on collisions, double-click to open. */
(() => {
  'use strict';
  const supported = /\.(jpe?g|png|webp|gif|mp4|webm|mp3|wav|ogg|pdf|txt|log|json|xml)$/i;
  const id = value => document.getElementById(value);

  async function showFile(name) {
    const route = new URL(location.href);
    const path = route.searchParams.get('path') || '';
    const params = new URLSearchParams({handler:'Preview',path,name});
    const url = `/Files?${params}`;
    if (!supported.test(name)) {
      location.assign(`/Files?${new URLSearchParams({handler:'Download',path,name})}`);
      return;
    }
    const dialog = id('file-preview-dialog');
    const body = id('file-preview-body');
    if (!(dialog instanceof HTMLDialogElement) || !body) return;
    body.replaceChildren();
    id('file-preview-title').textContent = name;
    id('file-preview-download').href = `/Files?${new URLSearchParams({handler:'Download',path,name})}`;
    const extension = name.split('.').at(-1).toLowerCase();
    let view;
    if (['jpg','jpeg','png','webp','gif'].includes(extension)) {
      view = document.createElement('img'); view.src = url; view.alt = name;
    } else if (['mp4','webm'].includes(extension)) {
      view = document.createElement('video'); view.src = url; view.controls = true; view.preload = 'metadata';
    } else if (['mp3','wav','ogg'].includes(extension)) {
      view = document.createElement('audio'); view.src = url; view.controls = true;
    } else if (extension === 'pdf') {
      view = document.createElement('iframe'); view.src = url; view.title = name;
    } else {
      view = document.createElement('pre'); view.textContent = 'Opening text preview…';
      try {
        const response = await fetch(url,{credentials:'same-origin',cache:'no-store'});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024)
          throw new Error('Text preview limited to 2 MiB. Download the file instead.');
        view.textContent = (await response.text()).slice(0,2*1024*1024);
      } catch (error) { view.textContent = String(error); }
    }
    body.append(view);
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener('dblclick', event => {
    const target = event.target instanceof Element ? event.target.closest('[data-open-file]') : null;
    if (target) { event.preventDefault(); void showFile(target.getAttribute('data-open-file') || ''); }
  },true);

  document.addEventListener('change', async event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'fm-upload-file') return;
    const form = input.closest('form');
    if (!form) return;
    const selected = Array.from(input.files || []);
    const progress = id('fm-upload-progress');
    input.disabled = true;
    let success = 0;
    try {
      for (const file of selected) {
        const current = new URL(form.action, location.href);
        const path = current.searchParams.get('path') || '';
        const check = await fetch(`/Files?${new URLSearchParams({handler:'Exists',path,name:file.name})}`,
          {credentials:'same-origin',cache:'no-store'});
        if (!check.ok) throw new Error('Could not verify whether the destination file exists.');
        const conflict = (await check.json()).exists;
        const replace = conflict && window.confirm(`“${file.name}” already exists.\n\nOK = Replace existing file\nCancel = Skip (do not rename)`);
        if (conflict && !replace) { if (progress) progress.textContent = `${file.name}: skipped`; continue; }
        if (progress) progress.textContent = `Uploading ${file.name}: 0%`;
        await new Promise((resolve,reject) => {
          const xhr = new XMLHttpRequest();
          const body = new FormData();
          const antiforgery = form.querySelector('input[name="__RequestVerificationToken"]')?.value;
          if (antiforgery) body.append('__RequestVerificationToken',antiforgery);
          body.append('upload',file,file.name);
          body.append('replace',String(Boolean(replace)));
          xhr.open('POST',form.action,true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Accept','application/json');
          xhr.upload.onprogress = e => { if (e.lengthComputable && progress) progress.textContent =
            `Uploading ${file.name}: ${Math.round(e.loaded / e.total * 100)}%`; };
          xhr.onload = () => {
            let data; try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
            if (xhr.status>=200 && xhr.status<300 && data.ok) resolve();
            else reject(new Error(data.message || `Upload failed (HTTP ${xhr.status}).`));
          };
          xhr.onerror = () => reject(new Error('Network error while uploading.'));
          xhr.send(body);
        });
        success++;
      }
      if (progress) progress.textContent = `${success} file(s) uploaded.`;
      if (success) window.location.reload();
    } catch (error) { if (progress) progress.textContent = `Error: ${error.message}`; }
    finally { input.value = ''; input.disabled = false; }
  },true);
})();
