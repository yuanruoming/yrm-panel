(() => {
  "use strict";
  const modal = document.getElementById("admin-password-dialog");
  const authForm = document.getElementById("admin-password-form");
  const passwordField = document.getElementById("admin-password-input");
  const description = document.getElementById("admin-password-description");
  const errorMessage = document.getElementById("admin-password-error");
  if (!modal || !authForm || !passwordField || !description) return;
  let targetForm = null;
  let targetSubmitter = null;

  // Capture the submit BEFORE panel.js serializes the form. Ordinary actions
  // never open this dialog. No password is written to cookies/localStorage.
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form === authForm) return;
    if (form.dataset.adminAuthorized === "1") return;
    const isRootCreate = form.matches(".explorer-create-form") &&
      (form.querySelector("input[name=parent]")?.value ?? "") === "";
    const operation = form.dataset.requiresAdmin || (isRootCreate ? "Create a root-level folder" : "");
    if (!operation) return;
    if (!form.reportValidity()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    targetForm = form;
    targetSubmitter = event.submitter instanceof HTMLElement ? event.submitter : null;
    description.textContent = `Administrator permission is required: ${operation}.`;
    passwordField.value = "";
    if (errorMessage) errorMessage.textContent = "";
    if (!modal.open) modal.showModal();
    passwordField.focus();
  }, true);

  authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!targetForm || !targetForm.isConnected) return;
    if (!passwordField.value) {
      if (errorMessage) errorMessage.textContent = "Enter your Linux password to authorize this operation.";
      passwordField.focus();
      return;
    }
    let hidden = targetForm.querySelector('input[name="adminPassword"]');
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "adminPassword";
      targetForm.append(hidden);
    }
    hidden.value = passwordField.value;
    passwordField.value = "";
    const form = targetForm;
    const submitter = targetSubmitter;
    targetForm = null;
    targetSubmitter = null;
    modal.close();
    form.dataset.adminAuthorized = "1";
    if (submitter instanceof HTMLButtonElement && submitter.isConnected)
      form.requestSubmit(submitter);
    else
      form.requestSubmit();
    window.setTimeout(() => {
      if (hidden && hidden.isConnected) { hidden.value = ""; hidden.remove(); }
      delete form.dataset.adminAuthorized;
    }, 3000);
  });
  modal.addEventListener("close", () => {
    passwordField.value = "";
    if (errorMessage) errorMessage.textContent = "";
    targetForm = null;
    targetSubmitter = null;
  });
  document.getElementById("admin-password-cancel")?.addEventListener("click", () => modal.close());
  document.getElementById("admin-password-cancel-bottom")?.addEventListener("click", () => modal.close());
})();
