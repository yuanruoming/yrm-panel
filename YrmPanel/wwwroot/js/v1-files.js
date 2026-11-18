/* Native-feeling Files: choose uploads immediately, ask only on collisions, double-click to open. */
(() => {
  'use strict';
  const supported = /\.(jpe?g|png|webp|gif|mp4|webm|mp3|wav|ogg|pdf|txt|log|json|xml)$/i;
  const id = value => document.getElementById(value);

  let previewVideo=null;
  const previewDialog=()=>id('file-preview-dialog');
  const formatTime=seconds=>{
    if (!Number.isFinite(seconds)) return '00:00';
    const value=Math.max(0,Math.floor(seconds));
    const min=Math.floor(value/60),sec=value%60;
    return (min>=60?`${Math.floor(min/60)}:`:'')+`${min%60}`.padStart(2,'0')+':'+String(sec).padStart(2,'0');
  };
  function stopMedia() {
    if (!previewVideo) return;
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    previewVideo=null;
  }
  document.addEventListener('close',event=>{
    if (event.target===previewDialog()) stopMedia();
  },true);
  // An HTMLDialogElement close event does not bubble in all browsers.
  let dialogWithCloseListener=null;
  function ensurePreviewCleanup(dialog) {
    if (dialogWithCloseListener===dialog) return;
    dialog.addEventListener('close',stopMedia);
    dialogWithCloseListener=dialog;
  }
  function videoPlayer(url,dialog) {
    const wrapper=document.createElement('div');wrapper.className='yrm-player';
    const screen=document.createElement('div');screen.className='yrm-player-screen';
    const video=document.createElement('video');video.src=url;video.preload='metadata';
    video.playsInline=true;video.controls=false;video.setAttribute('aria-label','Video preview');
    previewVideo=video;
    const bigPlay=document.createElement('button');bigPlay.className='yrm-player-overlay-play';
    bigPlay.type='button';bigPlay.textContent='▶';bigPlay.setAttribute('aria-label','Play video');
    screen.append(video,bigPlay);
    const controls=document.createElement('div');controls.className='yrm-player-controls';
    const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='1000';seek.step='1';seek.value='0';
    seek.className='yrm-player-seek';seek.setAttribute('aria-label','Seek playback position');
    const play=document.createElement('button');play.type='button';play.textContent='▶';play.setAttribute('aria-label','Play');
    const time=document.createElement('span');time.className='yrm-player-time';time.textContent='00:00 / 00:00';
    const volumeLabel=document.createElementNS('http://www.w3.org/2000/svg','svg');
    volumeLabel.setAttribute('viewBox','0 0 24 24');volumeLabel.setAttribute('width','18');volumeLabel.setAttribute('height','18');
    volumeLabel.setAttribute('fill','none');volumeLabel.setAttribute('stroke','currentColor');volumeLabel.setAttribute('stroke-width','1.8');
    volumeLabel.setAttribute('stroke-linecap','round');volumeLabel.setAttribute('aria-hidden','true');
    for (const d of ['M11 5 6 9H3v6h3l5 4V5Z','M15 9a5 5 0 0 1 0 6','M18 6a9 9 0 0 1 0 12']) {
      const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',d);volumeLabel.append(shape);
    }
    const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='1';volume.step='0.05';volume.value='1';
    volume.className='yrm-player-volume';volume.setAttribute('aria-label','Volume');
    const speed=document.createElement('select');speed.setAttribute('aria-label','Playback speed');speed.className='yrm-player-speed';
    for (const n of [0.5,0.75,1,1.25,1.5,2]) {
      const opt=document.createElement('option');opt.value=String(n);opt.textContent=n+'×';speed.append(opt);
    }
    speed.value='1';
    const full=document.createElement('button');full.type='button';full.textContent='⛶';full.setAttribute('aria-label','Fullscreen video');
    const row=document.createElement('div');row.className='yrm-player-row';
    row.append(play,time,volumeLabel,volume,speed,full);
    controls.append(seek,row);
    wrapper.append(screen,controls);
    const toggle=async()=>{
      try {video.paused?await video.play():video.pause()} catch {}
    };
    const refresh=()=>{
      const paused=video.paused;play.textContent=paused?'▶':'❚❚';play.setAttribute('aria-label',paused?'Play':'Pause');
      bigPlay.hidden=!paused;
      const duration=video.duration;
      time.textContent=`${formatTime(video.currentTime)} / ${formatTime(duration)}`;
      seek.value=Number.isFinite(duration)&&duration>0?String(Math.round(video.currentTime/duration*1000)):'0';
      seek.style.setProperty('--yrm-played',(Number(seek.value)/10)+'%');
    };
    play.addEventListener('click',toggle);bigPlay.addEventListener('click',toggle);
    video.addEventListener('click',toggle);
    for (const evt of ['play','pause','timeupdate','durationchange','ended']) video.addEventListener(evt,refresh);
    seek.addEventListener('input',()=>{if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Number(seek.value)/1000*video.duration;refresh()});
    volume.addEventListener('input',()=>{video.volume=Number(volume.value);video.muted=false});
    speed.addEventListener('change',()=>{video.playbackRate=Number(speed.value)});
    full.addEventListener('click',()=>{
      if (document.fullscreenElement) {void document.exitFullscreen?.();return;}
      void wrapper.requestFullscreen?.();
    });
    video.addEventListener('loadedmetadata',()=>{
      const width=video.videoWidth||16,height=video.videoHeight||9;
      // Maximize useful playback area without stretching portrait videos.
      const maxHeight=Math.max(200,window.innerHeight-230);
      const preferred=Math.round(Math.min(820,maxHeight*width/height));
      dialog.style.setProperty('--yrm-video-dialog-width',Math.max(260,preferred+28)+'px');
      refresh();
    });
    refresh();
    return wrapper;
  }

  async function showFile(name) {
    const route = new URL(location.href);
    const path = route.searchParams.get('path') || '';
    const params = new URLSearchParams({handler:'Preview',path,name});
    const url = `/Files?${params}`;
    if (!supported.test(name)) {
      location.assign(`/Files?${new URLSearchParams({handler:'Download',path,name})}`);
      return;
    }
    const dialog = previewDialog();
    const body = id('file-preview-body');
    if (!(dialog instanceof HTMLDialogElement) || !body) return;
    ensurePreviewCleanup(dialog);
    stopMedia();
    body.replaceChildren();
    dialog.classList.remove('is-video-preview');
    dialog.style.removeProperty('--yrm-video-dialog-width');
    id('file-preview-title').textContent = name;
    id('file-preview-download').href = `/Files?${new URLSearchParams({handler:'Download',path,name})}`;
    const extension = name.split('.').at(-1).toLowerCase();
    let view;
    if (['jpg','jpeg','png','webp','gif'].includes(extension)) {
      view = document.createElement('img'); view.className='yrm-image-loading'; view.alt = name;
      const loading=document.createElement('div');loading.className='yrm-image-placeholder';
      loading.textContent='Loading image…';
      body.append(loading);
      view.addEventListener('load',async()=>{
        try {if (view.decode) await view.decode()} catch { /* load already succeeded */ }
        if (!view.isConnected) return;
        view.classList.remove('yrm-image-loading');loading.remove();
      },{once:true});
      view.addEventListener('error',()=>{loading.textContent='Could not load preview. You can download the original file.';view.remove();},{once:true});
      view.src = url;
    } else if (['mp4','webm'].includes(extension)) {
      dialog.classList.add('is-video-preview');
      view=videoPlayer(url,dialog);
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
    let hideTimer;
    const status = message => {
      if (!progress) return;
      clearTimeout(hideTimer);progress.hidden=false;progress.textContent=message;
      hideTimer=setTimeout(()=>{if(progress.isConnected)progress.hidden=true},6000);
    };
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
        if (conflict && !replace) { status(`${file.name}: skipped`); continue; }
        status(`Uploading ${file.name}: 0%`);
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
          xhr.upload.onprogress = e => { if (e.lengthComputable) status(`Uploading ${file.name}: ${Math.round(e.loaded / e.total * 100)}%`); };
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
      if(success)status(`${success} file(s) uploaded.`);
      if (success) window.location.reload();
    } catch (error) { status(`Error: ${error.message}`); }
    finally { input.value = ''; input.disabled = false; }
  },true);
})();
