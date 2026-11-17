(() => {
  "use strict";
  const get = id => document.getElementById(id);
  const bytes = raw => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const u = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0, x = n;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const put = (id, value) => { const el = get(id); if (el) el.textContent = String(value); };
  const pct = n => Math.max(0, Math.min(100, Number(n) || 0));
  function apply(s) {
    if (!s || document.hidden) return;
    const cpu = pct(s.cpuPercent), ram = pct(s.memoryPercent);
    for (const id of ["top-cpu", "cpu-value", "pinned-cpu"]) put(id, `${cpu.toFixed(0)}%`);
    for (const id of ["top-ram", "ram-value", "pinned-ram"]) put(id, `${ram.toFixed(0)}%`);
    put("monitor-hostname", s.hostname || "Linux server");
    put("monitor-os", s.isDemo ? "Windows / preview data" : s.osName || "Linux");
    put("desktop-caption-host", s.hostname || "Server");
    put("ram-description", `${bytes(s.memoryUsedBytes)} of ${bytes(s.memoryTotalBytes)} used`);
    put("net-down", `${bytes(s.downloadBytesPerSecond)}/s`);
    put("net-up", `${bytes(s.uploadBytesPerSecond)}/s`);
    put("pinned-download", `${bytes(s.downloadBytesPerSecond)}/s`);
    put("pinned-upload", `${bytes(s.uploadBytesPerSecond)}/s`);
    for (const id of ["cpu-meter", "pinned-cpu-meter"]) { const el = get(id); if (el) el.style.width = `${cpu}%`; }
    for (const id of ["ram-meter", "pinned-ram-meter"]) { const el = get(id); if (el) el.style.width = `${ram}%`; }
    const uptime = Math.max(0, Math.floor(Number(s.uptimeSeconds) || 0));
    const d = Math.floor(uptime / 86400), h = Math.floor(uptime % 86400 / 3600), m = Math.floor(uptime % 3600 / 60), sec = uptime % 60;
    put("uptime", `Uptime · ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`}`);
  }
  const pinned = get("pinned-monitor");
  if (pinned) {
    let updating = false;
    const repair = () => {
      if (updating) return;
      let enabled = false;
      try { enabled = localStorage.getItem("yrm-panel:pinned-monitor") === "1"; } catch {}
      if (pinned.hidden === enabled) {
        updating = true;
        pinned.hidden = !enabled;
        updating = false;
      }
    };
    const observer = new MutationObserver(repair);
    observer.observe(pinned, {attributes: true, attributeFilter: ["hidden"]});
    get("monitor-pin")?.addEventListener("click", () => queueMicrotask(repair));
    get("pinned-unpin")?.addEventListener("click", () => queueMicrotask(repair));
    repair();
  }
  if (typeof EventSource === "function") {
    const stream = new EventSource("/api/metrics/stream");
    stream.onmessage = event => { try { apply(JSON.parse(event.data)); } catch {} };
  } else {
    async function poll() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/metrics", {credentials: "same-origin", cache: "no-store"});
        if (response.ok) apply(await response.json());
      } catch {}
    }
    void poll();
    setInterval(() => void poll(), 1000);
  }
})();
