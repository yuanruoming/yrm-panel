/* YRM Panel v1.0 — persistent desktop shell, same-origin progressive navigation.
 * No runtime dependencies. Native forms and links still work if JavaScript is disabled.
 */
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  if (!body?.classList.contains("os-shell")) return;

  const launcher = $("app-launcher");
  const profile = $("profile-menu");
  const launcherButton = $("launcher-toggle");
  const profileButton = $("profile-toggle");
  const monitor = $("monitor-drawer");
  const monitorClose = $("monitor-close");
  const pinButton = $("monitor-pin");
  const pinned = $("pinned-monitor");
  const tabsHost = $("taskbar-tabs");
  const stage = $("workspace-stage");
  const page = $("window-page");
  const appWindow = $("workspace-window");
  const windowScroll = $("window-scroll");
  const homeButton = $("taskbar-home");
  const MAX_TABS = 6;
  const tabs = new Map();
  let activeUrl = null;
  let navigationId = 0;
  let pinnedEnabled = false;
  let lastMonitorTrigger = null;

  // Do not accept arbitrary same-origin routes into the workspace shell.
  const allowedPages = new Set(["/Applications", "/Docker", "/Services", "/Settings", "/Features", "/Files", "/Shares"]);
  const canonicalPath = (path) => path.replace(/\/$/, "") || "/";
  function internalUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin || !allowedPages.has(canonicalPath(url.pathname))) return null;
      if (url.hash || url.username || url.password) return null;
      return url.pathname + url.search;
    } catch { return null; }
  }
  function isDesktopUrl(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && (url.pathname === "/" || url.pathname === "/Index") && !url.search && !url.hash;
    } catch { return false; }
  }
  function setWallpaper(value) {
    if (value && /^\/wallpaper\?v=\d+$/.test(value)) {
      document.documentElement.style.setProperty("--wallpaper-image", `url("${value}")`);
    } else {
      document.documentElement.style.removeProperty("--wallpaper-image");
    }
  }
  setWallpaper(body.dataset.wallpaper);

  function closePopup(node, trigger) {
    if (node) node.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  }
  function togglePopup(node, trigger, other, otherTrigger) {
    if (!node || !trigger) return;
    closePopup(other, otherTrigger);
    node.hidden = !node.hidden;
    trigger.setAttribute("aria-expanded", String(!node.hidden));
  }
  launcherButton?.addEventListener("click", () => togglePopup(launcher, launcherButton, profile, profileButton));
  profileButton?.addEventListener("click", () => { setMonitorOpen(false); togglePopup(profile, profileButton, launcher, launcherButton); });
  document.addEventListener("pointerdown", (event) => {
    if (!launcher?.hidden && !launcher.contains(event.target) && !launcherButton?.contains(event.target)) closePopup(launcher, launcherButton);
    if (!profile?.hidden && !profile.contains(event.target) && !profileButton?.contains(event.target)) closePopup(profile, profileButton);
  });

  function setMonitorOpen(open, trigger = null) {
    if (!monitor) return;
    if (open) {
      closePopup(launcher, launcherButton);
      closePopup(profile, profileButton);
      lastMonitorTrigger = trigger;
      monitor.inert = false;
      monitor.setAttribute("aria-hidden", "false");
      monitor.classList.add("is-open");
      monitorClose?.focus();
    } else {
      monitor.classList.remove("is-open");
      monitor.setAttribute("aria-hidden", "true");
      monitor.inert = true;
      lastMonitorTrigger?.focus();
    }
    document.querySelectorAll("[data-open-monitor]").forEach((button) => button.setAttribute("aria-expanded", String(open)));
  }
  document.querySelectorAll("[data-open-monitor]").forEach((el) =>
    el.addEventListener("click", () => setMonitorOpen(!monitor?.classList.contains("is-open"), el)));
  monitorClose?.addEventListener("click", () => setMonitorOpen(false));

  function updatePinned() {
    if (pinned) pinned.hidden = !(pinnedEnabled && activeUrl === null);
    pinButton?.setAttribute("aria-pressed", String(pinnedEnabled));
    pinButton?.classList.toggle("is-active", pinnedEnabled);
    pinButton?.setAttribute("title", pinnedEnabled ? "Unpin desktop monitor" : "Pin compact monitor to desktop");
  }
  try { pinnedEnabled = localStorage.getItem("yrm-panel:pinned-monitor") === "1"; } catch { /* blocked storage is okay */ }
  updatePinned();
  function setPinned(value) {
    pinnedEnabled = Boolean(value);
    try { localStorage.setItem("yrm-panel:pinned-monitor", pinnedEnabled ? "1" : "0"); } catch { /* session-only preference */ }
    updatePinned();
  }
  pinButton?.addEventListener("click", () => { setPinned(!pinnedEnabled); setMonitorOpen(false); });
  $("pinned-unpin")?.addEventListener("click", () => setPinned(false));

  const iconName = (url) => {
    const path = url?.split("?")[0];
    return ({"/Docker":"i-docker-symbol","/Services":"i-server","/Applications":"i-grid","/Settings":"i-settings","/Files":"i-folder","/Shares":"i-globe","/Features":"i-grid"})[path] || "i-grid";
  };
  function createTab(name, url) {
    const tab = document.createElement("div");
    tab.className = "taskbar-tab";
    if (url === activeUrl) tab.classList.add("is-active");
    const opener = document.createElement("button");
    opener.type = "button";
    opener.className = "taskbar-tab-open";
    opener.title = `Open ${name}`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ui-icon");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${iconName(url)}`);
    svg.append(use);
    const text = document.createElement("span"); text.textContent = name;
    opener.append(svg, text);
    opener.addEventListener("click", () => openPage(url));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "taskbar-tab-close";
    close.title = `Close ${name}`;
    close.setAttribute("aria-label", `Close ${name}`);
    close.textContent = "×";
    close.addEventListener("click", () => closeTab(url));
    tab.append(opener, close);
    return tab;
  }
  function renderTabs() {
    if (!tabsHost) return;
    const nodes = [];
    for (const [url, tab] of tabs) nodes.push(createTab(tab.title, url));
    tabsHost.replaceChildren(...nodes);
    homeButton?.classList.toggle("is-active", activeUrl === null);
  }
  function setPageShell(isDesktop, title) {
    body.classList.toggle("is-desktop", isDesktop);
    body.classList.toggle("has-window", !isDesktop);
    if (stage) stage.hidden = isDesktop;
    if (stage) stage.setAttribute("aria-hidden", String(isDesktop));
    if (appWindow) appWindow.setAttribute("aria-label", `${title} window`);
    const heading = $("window-active-title");
    if (heading) heading.textContent = title;
    document.title = `${title} · YRM Panel`;
    updatePinned();
  }
  function rememberActive() {
    if (!activeUrl || !page || !tabs.has(activeUrl)) return;
    const tab = tabs.get(activeUrl);
    const fragment = document.createDocumentFragment();
    while (page.firstChild) fragment.append(page.firstChild);
    tab.fragment = fragment;
    tab.scrollTop = windowScroll?.scrollTop ?? 0;
  }
  async function refreshDesktop() {
    try {
      const response = await fetch("/", {credentials:"same-origin", cache:"no-store"});
      if (!response.ok || response.redirected) return;
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const fresh = doc.querySelector("#desktop-main");
      const current = $("desktop-main");
      if (!fresh || !current || !doc.body.classList.contains("os-shell")) return;
      current.replaceChildren(...Array.from(fresh.childNodes).map(n => document.importNode(n, true)));
      harvestDesktopNotices();
    } catch { /* Desktop remains usable when a refresh fails. */ }
  }
  function showDesktop(push = true) {
    ++navigationId;
    rememberActive();
    activeUrl = null;
    setPageShell(true, "Desktop");
    renderTabs();
    closePopup(launcher, launcherButton);
    if (push && location.pathname + location.search !== "/") history.pushState(null, "", "/");
    void refreshDesktop();
  }
  function showTab(url, push = true) {
    if (!page || !tabs.has(url)) return;
    if (activeUrl !== url) rememberActive();
    const tab = tabs.get(url);
    activeUrl = url;
    if (tab.fragment) {
      page.replaceChildren(tab.fragment);
      tab.fragment = null;
    }
    windowScroll.scrollTop = tab.scrollTop || 0;
    setPageShell(false, tab.title);
    renderTabs();
    closePopup(launcher, launcherButton);
    if (push && location.pathname + location.search !== url) history.pushState(null, "", url);
  }
  function updateShellFromDocument(doc) {
    // Only a page generated by this application is accepted here.
    if (!doc.body?.classList.contains("os-shell")) return false;
    setWallpaper(doc.body.dataset.wallpaper);
    const freshLauncher = doc.querySelector("#app-launcher");
    if (freshLauncher && launcher) {
      const links = freshLauncher.querySelector(".launcher-links");
      const label = freshLauncher.querySelector(".launcher-shortcuts-title");
      launcher.querySelector(".launcher-links")?.remove();
      launcher.querySelector(".launcher-shortcuts-title")?.remove();
      if (label) launcher.append(document.importNode(label, true));
      if (links) launcher.append(document.importNode(links, true));
    }
    return true;
  }
  function showToast(message, type = "info") {
    const host = $("toast-host");
    if (!host || !message?.trim()) return;
    const item = document.createElement("div");
    item.className = `panel-toast ${type === "error" ? "toast-error" : "toast-success"}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    const label = document.createElement("span"); label.textContent = message;
    const close = document.createElement("button");
    close.type = "button"; close.setAttribute("aria-label", "Dismiss notification"); close.textContent = "×";
    close.addEventListener("click", () => item.remove());
    item.append(label, close);
    host.append(item);
    setTimeout(() => item.remove(), type === "error" ? 9500 : 4200);
  }
  function errorToast(message) { showToast(message, "error"); }
  function harvestNotices(container) {
    container?.querySelectorAll(".notice[data-result-notice]").forEach(note => {
      showToast(note.textContent.trim(), note.dataset.resultNotice === "error" ? "error" : "success");
      note.remove();
    });
  }
  harvestNotices(page);
  function harvestDesktopNotices() {
    $("desktop-main")?.querySelectorAll(".desktop-power-notice[data-result-notice]").forEach(note => {
      showToast(note.textContent.trim(), note.dataset.resultNotice === "error" ? "error" : "success");
      note.remove();
    });
  }
  harvestDesktopNotices();
  // App dialogs and file dialogs are delegated because Razor content is loaded via Fetch.
  async function listFolders(path) {
    const tree = document.querySelector("#new-folder-tree");
    if (!tree) return;
    tree.replaceChildren();
    const folderPath = (path || "").replace(/^\/+|\/+$/g, "");
    try {
      const response = await fetch(`/Files?handler=Tree&path=${encodeURIComponent(folderPath)}`, {credentials:"same-origin", cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cannot read this folder.");
      const parentInput = document.querySelector("#new-folder-parent");
      if (parentInput) parentInput.value = data.path;
      const nameInput = document.querySelector("#new-folder-dialog input[name=name]");
      const preview = document.querySelector("#new-folder-full-path");
      const rights = document.querySelector("#new-folder-rights");
      const submit = document.querySelector("#new-folder-dialog button[type=submit]");
      if (preview) preview.textContent = data.absolute + (nameInput?.value ? (data.path ? "/" : "") + nameInput.value : "");
      if (rights) rights.textContent = data.canManage || data.path === "" ? "" : "This folder is read-only. Enable its management in Files first.";
      if (submit) submit.disabled = !(data.canManage || data.path === "");
      const makeItem = (name, nextPath, icon) => {
        const b = document.createElement("button"); b.type="button"; b.className="explorer-tree-item";
        b.textContent = `${icon}  ${name}`;
        b.addEventListener("click", () => void listFolders(nextPath));
        return b;
      };
      if (data.path) tree.append(makeItem("..", data.path.split("/").slice(0,-1).join("/"), "↰"));
      for (const name of data.folders || []) tree.append(makeItem(name, data.path ? `${data.path}/${name}` : name,"📁"));
      if (!data.folders?.length) tree.append(document.createTextNode("No subfolders."));
    } catch (error) { tree.textContent = error.message; }
  }
  function openDialog(id) { const node = $(id); if (node && !node.open) node.showModal(); }
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    if (!button) return;
    if (button.dataset.closeDialog) { $(button.dataset.closeDialog)?.close(); return; }
    if (button.hasAttribute("data-open-new-folder")) {
      openDialog("new-folder-dialog");
      const initial = document.querySelector("#new-folder-tree")?.dataset.initialFolder || "";
      void listFolders(initial);
      return;
    }
    if (button.dataset.renameItem || button.dataset.moveItem) {
      const rename = button.hasAttribute("data-rename-item");
      const form = $("file-action-form");
      if (!form) return;
      const item = rename ? button.dataset.renameItem : button.dataset.moveItem;
      const path = new URLSearchParams(location.search).get("path") || "";
      form.action = `/Files?handler=${rename ? "Rename" : "Move"}&path=${encodeURIComponent(path)}`;
      $("file-action-name").value = item;
      const input = $("file-action-value");
      input.name = rename ? "newName" : "destination";
      input.value = rename ? item : "";
      $("file-action-title").textContent = rename ? `Rename ${item}` : `Move ${item}`;
      $("file-action-label").textContent = rename ? "New name" : "Destination path (relative to /)";
      openDialog("file-action-dialog");
      return;
    }
    if (button.hasAttribute("data-share-folder")) {
      const name = button.dataset.shareFolder;
      $("share-folder-name").value = name;
      $("share-folder-alias").value = name;
      $("share-folder-target").textContent = `Folder: ${name}`;
      openDialog("share-folder-dialog");
      return;
    }
    if (button.hasAttribute("data-open-add-app") || button.hasAttribute("data-edit-app-index")) {
      const editing = button.hasAttribute("data-edit-app-index");
      $("application-editor-title").textContent = editing ? "Edit app" : "Add app";
      $("application-editor-index").value = editing ? button.dataset.editAppIndex : "-1";
      $("application-editor-name").value = editing ? button.dataset.editAppName : "";
      $("application-editor-url").value = editing ? button.dataset.editAppUrl : "";
      const deleteForm = $("application-delete-form");
      if (deleteForm) deleteForm.hidden = !editing;
      if (editing) $("application-delete-index").value = button.dataset.editAppIndex;
      openDialog("application-editor-dialog");
    }
  });
  document.addEventListener("input", event => {
    if (event.target.matches?.("#new-folder-dialog input[name=name]")) {
      const path = $("new-folder-parent")?.value || "";
      $("new-folder-full-path").textContent = `/${path ? path + "/" : ""}${event.target.value}`;
    }
  });
  document.addEventListener("change", event => {
    if (event.target.matches?.("#wallpaper-select") && event.target.files?.length) {
      event.target.closest("form")?.requestSubmit();
    }
  });
  let lastLogsUrl = null;
  const logDialog = $("docker-log-dialog");
  async function openLogs(url) {
    const request = new URL(url, location.href);
    if (request.origin !== location.origin || request.pathname !== "/Docker" ||
        request.searchParams.get("handler") !== "Logs") return;
    lastLogsUrl = request.href;
    $("docker-log-output").textContent = "Loading logs…";
    if (!logDialog.open) logDialog.showModal();
    try {
      const result = await fetch(lastLogsUrl, {credentials:"same-origin",cache:"no-store"});
      if (!result.ok || result.redirected) throw new Error(`HTTP ${result.status}`);
      const data = await result.text();
      if (lastLogsUrl === request.href) $("docker-log-output").textContent = data || "No logs available.";
    } catch { $("docker-log-output").textContent = "Unable to load logs."; }
  }
  $("docker-log-close")?.addEventListener("click", () => logDialog?.close());
  $("docker-log-refresh")?.addEventListener("click", () => { if (lastLogsUrl) void openLogs(lastLogsUrl); });
  $("docker-log-copy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("docker-log-output")?.textContent || ""); showToast("Logs copied."); }
    catch { showToast("Copy failed. Select the text to copy.", "error"); }
  });
  async function loadPage(url, refresh = false, push = true) {
    const token = ++navigationId;
    appWindow?.classList.add("is-loading");
    try {
      const response = await fetch(url, {credentials: "same-origin", headers: {"Accept":"text/html"}, cache: "no-store"});
      if (response.redirected && new URL(response.url).pathname.startsWith("/Account/")) {
        location.assign(response.url); return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const remotePage = doc.querySelector("#window-page");
      if (token !== navigationId) return;
      if (!remotePage || !updateShellFromDocument(doc)) throw new Error("Unexpected page response");
      const title = doc.body.dataset.initialTitle || "Application";
      if (activeUrl && activeUrl !== url) rememberActive();
      // File browsing changes query strings frequently; maintain one Files taskbar tab.
      if (["/Files","/Settings"].includes(canonicalPath(url.split("?")[0]))) {
        for (const key of tabs.keys()) {
          if (canonicalPath(key.split("?")[0]) === canonicalPath(url.split("?")[0]) && key !== url) tabs.delete(key);
        }
      }
      const fragment = document.createDocumentFragment();
      for (const node of Array.from(remotePage.childNodes)) fragment.append(document.importNode(node, true));
      let tab = tabs.get(url);
      if (!tab) {
        tab = {title, fragment: null, scrollTop: 0};
        tabs.set(url, tab);
      }
      tab.title = title;
      tab.fragment = null;
      if (tabs.size > MAX_TABS) {
        for (const key of tabs.keys()) { if (key !== activeUrl && key !== url) { tabs.delete(key); break; } }
      }
      activeUrl = url;
      page.replaceChildren(fragment);
      harvestNotices(page);
      windowScroll.scrollTop = 0;
      setPageShell(false, title);
      renderTabs();
      closePopup(launcher, launcherButton);
      if (push && location.pathname + location.search !== url) history.pushState(null, "", url);
    } catch (error) {
      if (token === navigationId) errorToast(`Could not open application: ${error.message}`);
    } finally {
      if (token === navigationId) appWindow?.classList.remove("is-loading");
    }
  }
  async function openPage(url, options = {}) {
    if (!internalUrl(url)) return;
    const push = options.push !== false;
    const refresh = Boolean(options.refresh);
    if (!refresh && url === activeUrl) return;
    if (!refresh && canonicalPath(url.split("?")[0]) !== "/Applications" && tabs.get(url)?.fragment) {
      ++navigationId;
      showTab(url, push);
    } else {
      await loadPage(url, refresh, push);
    }
  }
  function closeTab(url) {
    ++navigationId;
    const wasActive = activeUrl === url;
    tabs.delete(url);
    if (wasActive) {
      activeUrl = null;
      page?.replaceChildren();
      const fallback = Array.from(tabs.keys()).at(-1);
      if (fallback) openPage(fallback);
      else showDesktop();
    } else renderTabs();
  }

  // The server-rendered initial page is usable without Fetch or scripts.
  if (body.classList.contains("has-window")) {
    const route = internalUrl(location.href);
    if (route) {
      activeUrl = route;
      tabs.set(route, {title:body.dataset.initialTitle || "Application", fragment:null, scrollTop:0});
    }
  }
  setPageShell(activeUrl === null, body.dataset.initialTitle || "Desktop");
  renderTabs();

  homeButton?.addEventListener("click", () => showDesktop());
  $("window-minimize")?.addEventListener("click", () => showDesktop());
  $("window-close")?.addEventListener("click", () => { if (activeUrl) closeTab(activeUrl); });
  $("window-maximize")?.addEventListener("click", () => appWindow?.classList.toggle("is-maximized"));
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a[href]");
    if (anchor?.hasAttribute("data-log-viewer")) {
      event.preventDefault(); void openLogs(anchor.href); return;
    }
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.hasAttribute("data-native-download") || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    if (isDesktopUrl(anchor.href)) {
      event.preventDefault(); showDesktop(); return;
    }
    const url = internalUrl(anchor.href);
    if (!url) return;
    event.preventDefault();
    // Clicking Refresh on the currently open Razor Page fetches new server data.
    const refresh = url === activeUrl && !!anchor.closest("#window-page");
    void openPage(url, {refresh});
  });
  window.addEventListener("popstate", () => {
    if (isDesktopUrl(location.href)) showDesktop(false);
    else {
      const url = internalUrl(location.href);
      if (url) void openPage(url, {push:false});
      else location.reload();
    }
  });

  // Progressive form enhancement: authenticated Razor handlers, native CSRF fields,
  // and ordinary browser submission remain the fallback when JavaScript is disabled.
  let actionPending = false;
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest("#window-page")) return;
    if (form.method.toLowerCase() !== "post" || !activeUrl || !form.reportValidity()) return;
    const action = new URL(form.action, location.href);
    if (action.origin !== location.origin || !internalUrl(action.href)) return;
    event.preventDefault();
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
    if (actionPending) return; // Avoid overlapping state-changing POST requests from this shell.
    actionPending = true;
    const submittedUrl = activeUrl;
    const requestId = ++navigationId;
    const button = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
    if (button) button.disabled = true;
    try {
      const response = await fetch(action.href, {
        method:"POST", body:new FormData(form, event.submitter || undefined),
        credentials:"same-origin", headers:{"Accept":"text/html"}, redirect:"follow"
      });
      if (response.redirected && new URL(response.url).pathname.startsWith("/Account/")) {
        location.assign(response.url); return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}; action not confirmed`);
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      if (requestId !== navigationId || activeUrl !== submittedUrl) {
        // A user switched apps while a POST was processing: don't replace their current view.
        const oldTab = tabs.get(submittedUrl);
        if (oldTab) oldTab.fragment = null;
        return;
      }
      const remotePage = doc.querySelector("#window-page");
      if (!remotePage || !updateShellFromDocument(doc)) throw new Error("Unexpected response; check the result before retrying");
      ++navigationId;
      const targetUrl = internalUrl(response.url) || activeUrl;
      const currentTab = tabs.get(activeUrl);
      if (currentTab && targetUrl !== activeUrl) {
        tabs.delete(activeUrl);
        tabs.set(targetUrl, currentTab);
      }
      activeUrl = targetUrl;
      const fragment = document.createDocumentFragment();
      for (const node of Array.from(remotePage.childNodes)) fragment.append(document.importNode(node, true));
      page.replaceChildren(fragment);
      harvestNotices(page);
      if (["/Settings","/Applications"].includes(canonicalPath(submittedUrl.split("?")[0]))) void refreshDesktop();
      windowScroll.scrollTop = 0;
      const title = doc.body.dataset.initialTitle || "Application";
      if (tabs.has(activeUrl)) { tabs.get(activeUrl).title = title; tabs.get(activeUrl).fragment = null; }
      setPageShell(false, title);
      renderTabs();
      history.replaceState(null, "", targetUrl);
    } catch (error) {
      errorToast(`Operation not confirmed: ${error.message}. Check the current state before retrying.`);
    } finally {
      actionPending = false;
      if (button?.isConnected) button.disabled = false;
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.confirm || form.closest("#window-page")) return;
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (monitor?.classList.contains("is-open")) setMonitorOpen(false);
    closePopup(launcher, launcherButton);
    closePopup(profile, profileButton);
  });

  const clock = $("clock-text");
  const updateClock = () => { if (clock) clock.textContent = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); };
  updateClock();
  setInterval(updateClock, 30_000);

  const bytes = (amount) => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; ++i; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
  };
  const pct = (value) => { const n = Number(value); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0; };
  const text = (id, value) => { const el = $(id); if (el) el.textContent = String(value); };
  function applySnapshot(s) {
    const cpu = pct(s.cpuPercent), ram = pct(s.memoryPercent);
    for (const id of ["top-cpu","cpu-value","pinned-cpu"]) text(id, `${cpu.toFixed(0)}%`);
    for (const id of ["top-ram","ram-value","pinned-ram"]) text(id, `${ram.toFixed(0)}%`);
    text("monitor-hostname", s.hostname || "Linux server");
    text("monitor-os", s.isDemo ? "Windows / preview data" : (s.osName || "Linux"));
    text("desktop-caption-host", s.hostname || "Server");
    text("ram-description", `${bytes(s.memoryUsedBytes)} of ${bytes(s.memoryTotalBytes)} used`);
    text("net-down", `${bytes(s.downloadBytesPerSecond)}/s`);
    text("net-up", `${bytes(s.uploadBytesPerSecond)}/s`);
    text("pinned-download", `${bytes(s.downloadBytesPerSecond)}/s`);
    text("pinned-upload", `${bytes(s.uploadBytesPerSecond)}/s`);
    const uptime = Math.max(0, Math.floor(Number(s.uptimeSeconds) || 0));
    const d = Math.floor(uptime / 86400), h = Math.floor(uptime % 86400 / 3600);
    const m = Math.floor(uptime % 3600 / 60), sec = uptime % 60;
    text("uptime", `Uptime · ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`}`);
    for (const id of ["cpu-meter","pinned-cpu-meter"]) { const el = $(id); if (el) el.style.width = `${cpu}%`; }
    for (const id of ["ram-meter","pinned-ram-meter"]) { const el = $(id); if (el) el.style.width = `${ram}%`; }
    const storage = $("storage-list");
    if (!storage || !Array.isArray(s.disks)) return;
    const list = document.createDocumentFragment();
    for (const disk of s.disks) {
      const row = document.createElement("div"); row.className = "disk-row";
      const head = document.createElement("div"); head.className = "disk-head";
      const label = document.createElement("div"); label.className = "disk-label";
      label.textContent = disk.name || "Volume";
      const path = document.createElement("span"); path.className = "disk-path";
      path.textContent = disk.path || "";
      label.append(path);
      const usage = document.createElement("span"); usage.className = "disk-usage";
      usage.textContent = disk.available ? `${bytes(disk.usedBytes)} / ${bytes(disk.totalBytes)}` : "Not mounted / unavailable";
      head.append(label, usage);
      const track = document.createElement("div"); track.className = "disk-track";
      const fill = document.createElement("div"); fill.className = "disk-fill";
      fill.style.width = `${disk.totalBytes > 0 ? pct((disk.usedBytes / disk.totalBytes) * 100) : 0}%`;
      track.append(fill); row.append(head, track);
      list.append(row);
    }
    storage.replaceChildren(list);
  }
  let polling = false;
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const response = await fetch("/api/metrics", {credentials:"same-origin", cache:"no-store"});
      if (!response.ok) return;
      applySnapshot(await response.json());
    } catch { /* Next poll can reconnect. */ }
    finally { polling = false; }
  }
  void poll();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void poll(); });
  setInterval(() => void poll(), 5000);
})();
