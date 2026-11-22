/* One metrics channel for the whole shell.
   - SSE is preferred; a polling fallback starts only if SSE fails.
   - The connection is closed while the tab is hidden and reopened on return.
   - Renderers subscribe; they never open their own EventSource or interval. */
(() => {
  'use strict';
  const listeners = new Set();
  let source = null;
  let timer = null;
  let latest = null;

  function emit(data) {
    latest = data;
    for (const listener of listeners) {
      try { listener(data); } catch { /* One renderer must not break the others. */ }
    }
  }
  function stopPolling() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  async function poll() {
    if (document.hidden) return;
    try {
      const response = await fetch('/api/metrics', {credentials: 'same-origin', cache: 'no-store'});
      if (response.ok) emit(await response.json());
    } catch { /* The next tick can reconnect. */ }
  }
  function startPolling() {
    if (timer !== null || !listeners.size) return;
    void poll();
    timer = setInterval(() => void poll(), 3000);
  }
  function open() {
    if (source || timer !== null || !listeners.size || document.hidden) return;
    if (typeof EventSource !== 'function') { startPolling(); return; }
    source = new EventSource('/api/metrics/stream');
    source.onmessage = event => {
      try { emit(JSON.parse(event.data)); } catch { /* Ignore malformed frames. */ }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      startPolling();
    };
  }
  function close() {
    source?.close();
    source = null;
    stopPolling();
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    if (latest) {
      try { listener(latest); } catch { /* The subscriber can retry on the next frame. */ }
    }
    open();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) close();
    };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) close();
    else open();
  });
  window.YrmMetrics = {subscribe};
})();
