/* BETA7: branded confirmations shared by all shell forms and file uploads.
   Capture on window before document-level AJAX handlers to preserve admin/CSRF flows. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  let pending=false;
  window.yrmConfirm=({title='Confirm action', message='', destructive=false, accept='Continue'}={}) => new Promise(resolve=>{
    const dialog=el('yrm-action-confirm');
    if(!(dialog instanceof HTMLDialogElement) || pending){resolve(false);return;}
    pending=true;
    const btn=el('yrm-confirm-accept');
    el('yrm-confirm-title').textContent=title;
    el('yrm-confirm-message').textContent=message;
    btn.textContent=accept;
    btn.classList.toggle('yrm-confirm-danger',destructive);
    const finish=value=>{ dialog.close(); cleanup();resolve(value); };
    const onClose=()=>{cleanup();resolve(false);};
    const onCancel=e=>{e.preventDefault();finish(false);};
    const onAccept=()=>finish(true);
    const onDismiss=()=>finish(false);
    function cleanup(){
      if(!pending)return;
      pending=false;
      btn.removeEventListener('click',onAccept);
      dialog.removeEventListener('close',onClose);
      dialog.removeEventListener('cancel',onCancel);
      dialog.querySelectorAll('[data-yrm-confirm-cancel]').forEach(x=>x.removeEventListener('click',onDismiss));
    }
    btn.addEventListener('click',onAccept);
    dialog.addEventListener('close',onClose);
    dialog.addEventListener('cancel',onCancel);
    dialog.querySelectorAll('[data-yrm-confirm-cancel]').forEach(x=>x.addEventListener('click',onDismiss));
    dialog.showModal();
    dialog.querySelector('[data-yrm-confirm-cancel]')?.focus();
  });

  // Capture before the existing document listeners (including the AJAX shell).
  window.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement) || !form.dataset.confirm || form.dataset.yrmConfirmed==='1') return;
    // Let browser inline validation focus invalid fields; no confirmation for invalid forms.
    if(!form.checkValidity())return;
    event.preventDefault();event.stopImmediatePropagation();
    const message=form.dataset.confirm;
    const submitter=event.submitter;
    const destructive=/delete|remove|erase|format|shutdown|reboot|restart|unmount/i.test(message);
    void window.yrmConfirm({title:destructive?'Confirm important action':'Confirm action',message,
        destructive,accept:destructive?'Confirm':'Continue'}).then(ok=>{
      if(!ok || !form.isConnected)return;
      const old=form.dataset.confirm;
      delete form.dataset.confirm;
      form.dataset.yrmConfirmed='1';
      try { form.requestSubmit(submitter instanceof HTMLElement && submitter.form===form?submitter:undefined); }
      finally {
        delete form.dataset.yrmConfirmed;
        form.dataset.confirm=old;
      }
    });
  },true);
})();
