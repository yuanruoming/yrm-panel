/* RC4 stabilization: explicit folder library, default monitor pin, and accessible file controls.
   All UI actions use event delegation so they also work with AJAX-loaded Razor pages. */
(() => {
  'use strict';

  // Set the first-run preference BEFORE panel.js initializes its pin state.
  // Once the user chooses Unpin, retain that choice across browser visits.
  try {
    if (localStorage.getItem('yrm-panel:pinned-monitor') === null) {
      localStorage.setItem('yrm-panel:pinned-monitor', '1');
    }
  } catch { /* Private browsing may block storage. */ }

  const id = name => document.getElementById(name);
  let previewUrl = null;

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function notify(message) {
    const host = id('toast-host');
    if (!host) return;
    const toast = document.createElement('div');
    toast.className = 'toast notice';
    toast.textContent = message;
    host.append(toast);
    window.setTimeout(() => toast.remove(), 3300);
  }

  // Capture the change event: RC4's old panel.js automatically submitted
  // wallpaper uploads. The selected valid wallpaper is submitted immediately.
  document.addEventListener('change', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    if (field.id === 'wallpaper-select') {
      event.stopPropagation();
      closePreview();
      const file = field.files?.[0];
      const apply = id('wallpaper-apply');
      const hint = id('wallpaper-selection-name');
      if (apply) apply.disabled = true;
      if (!file) {
        if (hint) hint.textContent = 'JPEG, PNG or WebP · Up to 8 MB';
        return;
      }
      const valid = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size > 0 && file.size <= 8 * 1024 * 1024;
      if (hint) hint.textContent = valid ? `${file.name} · ${(file.size / 1048576).toFixed(2)} MiB` : 'Choose a JPEG, PNG or WebP image up to 8 MB.';
      if (!valid) {
        field.value = '';
        notify('Unsupported image or file larger than 8 MB.');
        return;
      }
      previewUrl = URL.createObjectURL(file);
      const preview = id('wallpaper-preview');
      if (preview instanceof HTMLImageElement) preview.src = previewUrl;
      if (apply) apply.disabled = false;
      // Apply immediately after choosing a valid image; one action, no extra click.
      field.closest('form')?.requestSubmit();
      return;
    }
    if (field.id === 'fm-upload-file') {
      const name = id('fm-upload-name');
      if (name) name.textContent = field.files?.[0]?.name || 'No file selected';
    }
  }, true);

  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const filePicker = element.closest('[data-file-picker]');
    if (filePicker) {
      event.preventDefault();
      const input = document.getElementById(filePicker.getAttribute('data-file-picker'));
      if (input instanceof HTMLInputElement && input.type === 'file') input.click();
      return;
    }
    const folderButton = element.closest('[data-open-add-folder]');
    if (folderButton) {
      event.preventDefault();
      const dialog = id('add-existing-dialog');
      if (dialog instanceof HTMLDialogElement && !dialog.open) {
        dialog.showModal();
        dialog.querySelector('input[name="folderPath"]')?.focus();
      }
      return;
    }
    const shareButton = element.closest('[data-share-folder]');
    if (shareButton) {
      // The original RC4 launcher sets the display name; this additional field
      // points to a managed folder selected from My Folders, with no path guessing.
      const full = id('share-absolute-folder');
      if (full) full.value = shareButton.getAttribute('data-share-absolute') || '';
      return;
    }
    const copy = element.closest('[data-copy-address]');
    if (copy) {
      const address = copy.getAttribute('data-copy-address') || '';
      if (!address) return;
      event.preventDefault();
      (async () => {
        try {
          await navigator.clipboard.writeText(address);
          notify('Address copied.');
        } catch {
          const text = document.createElement('textarea');
          text.value = address;
          text.style.position = 'fixed';
          text.style.opacity = '0';
          document.body.append(text);
          text.select();
          const ok = document.execCommand('copy');
          text.remove();
          notify(ok ? 'Address copied.' : 'Copy is unavailable in this browser.');
        }
      })();
    }
  }, true);

  // Profile controls live in the existing Settings sidebar, not an extra app.
  // Event delegation survives inner Razor page swaps.
  let profilePreviewUrl = null;
  let initialPhotoMarkup = null;
  const profilePopover = () => id('yrm-profile-popover');
  const closeProfile = () => {
    const pop = profilePopover();if(pop)pop.hidden=true;
    document.querySelector('[data-yrm-profile-toggle]')?.setAttribute('aria-expanded','false');
  };
  const closePhoto = () => {
    const dialog = id('yrm-profile-photo-dialog');
    if(dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
    if(profilePreviewUrl){URL.revokeObjectURL(profilePreviewUrl);profilePreviewUrl=null;}
    const preview = id('yrm-profile-preview');
    if(preview && initialPhotoMarkup !== null)preview.innerHTML=initialPhotoMarkup;
    const form=id('yrm-profile-photo-form');if(form instanceof HTMLFormElement)form.reset();
    const save=id('yrm-profile-photo-save');if(save)save.disabled=true;
  };
  document.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target:null;
    if(!node)return;
    if(node.closest('[data-yrm-profile-toggle]')){
      event.preventDefault();const pop=profilePopover();if(!pop)return;
      pop.hidden=!pop.hidden;
      node.closest('[data-yrm-profile-toggle]')?.setAttribute('aria-expanded',String(!pop.hidden));
      return;
    }
    if(node.closest('[data-yrm-photo-open]')){
      event.preventDefault();closeProfile();
      const dialog=id('yrm-profile-photo-dialog');
      if(dialog instanceof HTMLDialogElement&&!dialog.open){
        initialPhotoMarkup=id('yrm-profile-preview')?.innerHTML||'';
        dialog.showModal();
      }
      return;
    }
    if(node.closest('[data-yrm-photo-close]')){event.preventDefault();closePhoto();return;}
    if(node.closest('[data-root-upload-open]')){
      event.preventDefault();const dialog=id('yrm-root-upload-dialog');
      if(dialog instanceof HTMLDialogElement&&!dialog.open)dialog.showModal();return;
    }
    if(node.closest('[data-root-upload-close]')){
      event.preventDefault();id('yrm-root-upload-dialog')?.close();return;
    }
    if(!node.closest('.yrm-profile-dock')) closeProfile();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProfile();});
  document.addEventListener('change',event=>{
    const file=event.target;
    if(!(file instanceof HTMLInputElement)||file.id!=='yrm-profile-photo-file')return;
    if(profilePreviewUrl){URL.revokeObjectURL(profilePreviewUrl);profilePreviewUrl=null;}
    const selected=file.files?.[0];
    const valid=selected && selected.size>0 && selected.size<=2*1024*1024 &&
      ['image/jpeg','image/png','image/webp'].includes(selected.type);
    const save=id('yrm-profile-photo-save');if(save)save.disabled=!valid;
    const hint=id('yrm-profile-photo-hint');if(hint)hint.textContent=valid?selected.name:'PNG, JPEG or WebP · Up to 2 MB';
    const preview=id('yrm-profile-preview');
    if(valid&&preview){
      profilePreviewUrl=URL.createObjectURL(selected);
      preview.replaceChildren();const image=document.createElement('img');
      image.src=profilePreviewUrl;image.alt='New profile photo';preview.append(image);
    } else if(preview&&initialPhotoMarkup!==null)preview.innerHTML=initialPhotoMarkup;
  },true);
  // Read-only System Time + Uptime: values come from the server snapshot, then
  // advance locally without a full-page timer fetch or changing other widgets.
  function refreshOverviewClock(){
    const time=id('window-page')?.querySelector('[data-yrm-system-time]');
    const uptime=id('window-page')?.querySelector('[data-yrm-system-uptime]');
    if(time){
      if(!time.dataset.started){time.dataset.started=String(Date.now());}
      const initial=Number(time.dataset.serverEpoch);
      const offset=Number(time.dataset.serverOffsetMinutes);
      if(Number.isFinite(initial)&&Number.isFinite(offset)){
        const date=new Date(initial + (Date.now()-Number(time.dataset.started)) + offset*60000);
        const pad=n=>String(n).padStart(2,'0');
        time.textContent=`${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
      }
    }
    if(uptime){
      if(!uptime.dataset.started)uptime.dataset.started=String(Date.now());
      let s=Math.max(0,Math.floor(Number(uptime.dataset.uptimeSeconds)||0)+(Math.floor((Date.now()-Number(uptime.dataset.started))/1000)));
      const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);
      uptime.textContent=`${d}d ${h}h ${m}m`;
    }
  }
  refreshOverviewClock();
  setInterval(refreshOverviewClock,1000);

  // Release object URLs when the preview is removed by workspace navigation.
  const observer = new MutationObserver(() => {
    if (previewUrl && !id('wallpaper-preview')) closePreview();
  });
  observer.observe(document.body, {childList: true, subtree: true});
})();
