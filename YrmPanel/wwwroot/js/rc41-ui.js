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

  // Release object URLs when the preview is removed by workspace navigation.
  const observer = new MutationObserver(() => {
    if (previewUrl && !id('wallpaper-preview')) closePreview();
  });
  observer.observe(document.body, {childList: true, subtree: true});
})();
