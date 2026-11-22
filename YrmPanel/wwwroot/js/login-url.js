// The signed-in desktop never shows page addresses. Keep the sign-in page
// consistent: the form posts to an explicit action, so the address bar can
// safely show the neutral "/" while this page is displayed.
(() => {
  'use strict';
  if (location.pathname !== '/' && history.replaceState) history.replaceState(null, '', '/');
})();
