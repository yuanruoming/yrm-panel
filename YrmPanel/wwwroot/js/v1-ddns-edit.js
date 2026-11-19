/* BETA7: dynamically loaded DDNS editors (no passwords sent to the browser). */
(()=>{
'use strict';
document.addEventListener('click',e=>{
  const target=e.target instanceof Element?e.target:null;
  const open=target?.closest('[data-yrm-ddns-edit]');
  if(open){
    const modal=document.getElementById(open.dataset.yrmDdnsEdit);
    if(modal instanceof HTMLDialogElement && !modal.open)modal.showModal();
  }
  const close=target?.closest('[data-yrm-ddns-edit-close]');
  if(close)close.closest('dialog')?.close();
});
document.addEventListener('change',e=>{
 const node=e.target;
 if(!(node instanceof HTMLSelectElement)||!node.matches('[data-yrm-ip-source]'))return;
 const form=node.closest('form');
 form?.querySelectorAll('[data-yrm-source]').forEach(row=>{
   row.hidden=row.dataset.yrmSource!==node.value;
   row.querySelectorAll('input,select').forEach(input=>input.required=!row.hidden);
 });
});
})();
