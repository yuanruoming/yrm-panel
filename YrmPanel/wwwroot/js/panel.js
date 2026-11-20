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
  let taskbarPins = [];
  let taskbarShortcuts = [];
  let taskbarCsrf = "";
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
  const taskbarBuiltin = new Map([
    ["/Applications", {name:"Apps",url:"/Applications"}],
    ["/Docker", {name:"Docker",url:"/Docker"}],
    ["/Files", {name:"Files",url:"/Files"}],
    ["/Settings", {name:"Settings",url:"/Settings"}]
  ]);
  const taskbarId = url => canonicalPath((url || "").split("?")[0]);
  function taskbarInfo(id) {
    if (taskbarBuiltin.has(id)) return taskbarBuiltin.get(id);
    if (id.startsWith("docker:")) return {name:id.slice(7),url:"/Docker"};
    return taskbarShortcuts.find(link => link.id === id) || null;
  }
  function findRunningTab(id) {
    const dest = taskbarInfo(id)?.url;
    if (!dest) return null;
    for (const url of tabs.keys()) {
      if (taskbarId(url) === taskbarId(dest)) return url;
    }
    return null;
  }
  async function loadTaskbarPins() {
    try {
      const response = await fetch("/Settings?handler=TaskbarPins", {credentials:"same-origin",cache:"no-store"});
      if (!response.ok) return;
      const data = await response.json();
      taskbarPins = Array.isArray(data.pins) ? data.pins.filter(x => typeof x === "string") : [];
      taskbarShortcuts = Array.isArray(data.shortcuts) ? data.shortcuts : [];
      taskbarCsrf = typeof data.token === "string" ? data.token : "";
      renderTabs();
      updateLauncherPins();
    } catch { /* Shell remains usable while disconnected. */ }
  }
  async function setTaskbarPin(id, shouldPin) {
    if (!taskbarBuiltin.has(id) || !taskbarCsrf) return;
    const body = new URLSearchParams({id,pinned:String(shouldPin)});
    try {
      const response = await fetch("/Settings?handler=TaskbarPin",{
        method:"POST",body,credentials:"same-origin",cache:"no-store",
        headers:{"RequestVerificationToken":taskbarCsrf,"Accept":"application/json"}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadTaskbarPins();
    } catch { errorToast("Could not update Taskbar pin. Please retry."); }
  }
  function createPinnedTaskbarApp(id) {
    const info=taskbarInfo(id);
    if (!info) return null;
    const running=findRunningTab(id);
    const button=document.createElement("button");button.type="button";
    button.className="taskbar-pin-app taskbar-app" + (running?" is-running":"") + (running===activeUrl?" is-active":"");
    button.dataset.taskbarId=id;
    button.setAttribute("aria-label",`${info.name}, ${running?"running":"pinned"}`);
    button.title=`${info.name} · Right-click for Taskbar options`;
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("class","ui-icon");
    const use=document.createElementNS("http://www.w3.org/2000/svg","use");
    use.setAttribute("href",`#${id.startsWith("docker:")?"i-docker-symbol":id.startsWith("link:")?"i-globe":iconName(info.url)}`);
    svg.append(use);
    const label=document.createElement("span");label.textContent=info.name;
    button.append(svg,label);
    button.addEventListener("click",()=>{
      if (id.startsWith("link:")) { window.open(info.url,"_blank","noopener,noreferrer"); return; }
      if (running && running===activeUrl) showDesktop();
      else void openPage(running||info.url);
    });
    return button;
  }
  let taskbarMenu=null;
  function closeTaskbarMenu() {taskbarMenu?.remove();taskbarMenu=null;}
  function openTaskbarMenu(target,x,y) {
    closeTaskbarMenu();
    const id=target.dataset.taskbarId || target.dataset.taskbarApp;
    if (!id || !taskbarBuiltin.has(id)) return;
    const running=findRunningTab(id), pinned=taskbarPins.includes(id);
    const menu=document.createElement("div");menu.className="yrm-taskbar-context";menu.setAttribute("role","menu");
    const item=document.createElement("button");item.type="button";
    item.textContent=pinned?"Unpin from Taskbar":"Pin to Taskbar";
    item.addEventListener("click",()=>{closeTaskbarMenu();void setTaskbarPin(id,!pinned);});
    menu.append(item);
    if (running) {
      const close=document.createElement("button");close.type="button";close.textContent="Close window";
      close.addEventListener("click",()=>{closeTaskbarMenu();closeTab(running);});menu.append(close);
    }
    document.body.append(menu);taskbarMenu=menu;
    const rect=menu.getBoundingClientRect();
    menu.style.left=Math.max(5,Math.min(innerWidth-rect.width-5,x))+"px";
    menu.style.top=Math.max(49,Math.min(innerHeight-rect.height-5,y))+"px";
    item.focus();
  }
  document.addEventListener("contextmenu",event=>{
    const element=event.target instanceof Element?event.target.closest("[data-taskbar-id],[data-taskbar-app]"):null;
    if (!element)return;
    event.preventDefault();openTaskbarMenu(element,event.clientX,event.clientY);
  });
  document.addEventListener("keydown",event=>{
    const element=event.target instanceof Element?event.target.closest("[data-taskbar-id],[data-taskbar-app]"):null;
    if (element && (event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10"))){
      event.preventDefault();const rect=element.getBoundingClientRect();openTaskbarMenu(element,rect.left,rect.bottom);return;
    }
    if (event.key==="Escape")closeTaskbarMenu();
  });
  document.addEventListener("pointerdown",event=>{
    if (taskbarMenu && !taskbarMenu.contains(event.target))closeTaskbarMenu();
  });
  function updateLauncherPins() {
    launcher?.querySelectorAll("a.launcher-app").forEach(link=>{
      const id=taskbarId(new URL(link.href,location.href).pathname);
      if (!taskbarBuiltin.has(id))return;
      let cell=link.closest(".yrm-launcher-cell");
      if (!cell) {
        cell=document.createElement("div");cell.className="yrm-launcher-cell";
        link.replaceWith(cell);cell.append(link);
      }
      let pin=cell.querySelector("button.yrm-launcher-taskbar-pin");
      if (!pin) {
        pin=document.createElement("button");pin.type="button";pin.className="yrm-launcher-taskbar-pin";
        pin.dataset.taskbarApp=id;
        cell.append(pin);
        pin.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();
          void setTaskbarPin(id,!taskbarPins.includes(id));});
      }
      pin.title=taskbarPins.includes(id)?"Unpin from Taskbar":"Pin to Taskbar";
      pin.classList.toggle('is-pinned',taskbarPins.includes(id));
      pin.innerHTML='<svg class="ui-icon" aria-hidden="true"><use href="#i-pin"></use></svg>';
      pin.setAttribute("aria-label",pin.title);
    });
  }
  function createTab(name, url) {
    const tab = document.createElement("div");
    tab.className = "taskbar-tab taskbar-app is-running";
    tab.dataset.taskbarId=taskbarId(url);
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
    opener.addEventListener("click", () => {
      if (activeUrl === url) showDesktop();
      else void openPage(url);
    });
    tab.append(opener);
    return tab;
  }
  function renderTabs() {
    if (!tabsHost) return;
    const nodes = [];
    const occupied = new Set();
    for (const id of taskbarPins) {
      const pin = createPinnedTaskbarApp(id);
      if (!pin) continue;
      nodes.push(pin);
      const running=findRunningTab(id);
      if (running) occupied.add(running);
    }
    for (const [url, tab] of tabs) if (!occupied.has(url)) nodes.push(createTab(tab.title,url));
    tabsHost.replaceChildren(...nodes);
    homeButton?.classList.toggle("is-active", activeUrl === null);
  }
  // BETA12.1 - one owner for window geometry; no parallel window controller.
  // Settings and Files use the same movable, resizable desktop window.
  const windowBounds = new Map();
  const windowTitlebar = appWindow?.querySelector('.window-titlebar');
  const workspaceKey = () => canonicalPath((activeUrl || '/Settings').split('?')[0]);
  const availableSpace = () => ({
    width: Math.max(280, stage?.clientWidth || innerWidth),
    height: Math.max(250, stage?.clientHeight || innerHeight - 49)
  });
  function clampWindowBounds(bounds) {
    const space=availableSpace();
    const minWidth=Math.min(420,space.width);
    const minHeight=Math.min(290,space.height);
    const width=Math.max(minWidth,Math.min(space.width, Number(bounds.width)||minWidth));
    const height=Math.max(minHeight,Math.min(space.height, Number(bounds.height)||minHeight));
    return {left:Math.max(0,Math.min(space.width-width,Number(bounds.left)||0)),
      top:Math.max(0,Math.min(space.height-height,Number(bounds.top)||0)),width,height};
  }
  function readWindowBounds() {
    if (!appWindow || !stage) return null;
    const r=appWindow.getBoundingClientRect(), sr=stage.getBoundingClientRect();
    return clampWindowBounds({left:r.left-sr.left,top:r.top-sr.top,width:r.width,height:r.height});
  }
  function storeWindowBounds() {
    if (!activeUrl || appWindow?.classList.contains('is-maximized'))return;
    const bounds=readWindowBounds();
    if (bounds)windowBounds.set(workspaceKey(),bounds);
  }
  function applyWindowBounds() {
    if (!appWindow || appWindow.classList.contains('is-maximized') || !activeUrl)return;
    const key=workspaceKey(),space=availableSpace();
    const preferredWidth=key==='/Files'?1300:key==='/Settings'?1080:1120;
    const width=Math.min(preferredWidth,space.width-32);
    const height=Math.min(key==='/Files'?800:740,space.height-30);
    const fallback={left:(space.width-width)/2,top:(space.height-height)/2,width,height};
    const bounds=clampWindowBounds(windowBounds.get(key)||fallback);
    for(const [name,value] of Object.entries(bounds))appWindow.style[name]=`${Math.round(value)}px`;
  }
  function toggleWindowMaximize() {
    if (!appWindow)return;
    if (!appWindow.classList.contains('is-maximized'))storeWindowBounds();
    appWindow.classList.toggle('is-maximized');
    if (!appWindow.classList.contains('is-maximized'))applyWindowBounds();
    const button=$('window-maximize');
    if(button)button.title=appWindow.classList.contains('is-maximized')?'Restore':'Maximize';
  }
  if(windowTitlebar && appWindow){
    windowTitlebar.addEventListener('dblclick',event=>{
      if(event.target instanceof Element && event.target.closest('button'))return;
      toggleWindowMaximize();
    });
    windowTitlebar.addEventListener('pointerdown',event=>{
      if(event.button!==0 || !activeUrl || appWindow.classList.contains('is-maximized') ||
          (event.target instanceof Element && event.target.closest('button,a,input')))return;
      const start=readWindowBounds();if(!start)return;
      const startX=event.clientX,startY=event.clientY;
      windowTitlebar.setPointerCapture(event.pointerId);
      const move=e=>{
        const next=clampWindowBounds({...start,left:start.left+(e.clientX-startX),
          top:start.top+(e.clientY-startY)});
        appWindow.style.left=next.left+'px';appWindow.style.top=next.top+'px';
      };
      const end=()=>{
        windowTitlebar.removeEventListener('pointermove',move);
        windowTitlebar.removeEventListener('pointerup',end);
        windowTitlebar.removeEventListener('pointercancel',end);
        storeWindowBounds();
      };
      windowTitlebar.addEventListener('pointermove',move);
      windowTitlebar.addEventListener('pointerup',end);
      windowTitlebar.addEventListener('pointercancel',end);
      event.preventDefault();
    });
    // Native CSS resize remains active; remember its result when the gesture ends.
    appWindow.addEventListener('pointerup',()=>storeWindowBounds());
    window.addEventListener('resize',()=>{
      if(appWindow.classList.contains('is-maximized'))return;
      const current=readWindowBounds();
      if(current && activeUrl)windowBounds.set(workspaceKey(),current);
      applyWindowBounds();
    });
  }
  // BETA12.1 notification center: single-admin browser history, bounded and
  // deduplicated by origin/message. Never store credentials or authorization data.
  const notificationKey='yrm-panel:notifications-v1';
  let notifications=[];
  try {
    const saved=JSON.parse(localStorage.getItem(notificationKey)||'[]');
    if(Array.isArray(saved))notifications=saved.slice(0,30).filter(x=>x&&typeof x.message==='string');
  }catch{}
  const rightControls=document.querySelector('.os-top-right');
  const notificationTrigger=document.createElement('button');
  notificationTrigger.type='button';notificationTrigger.className='yrm-notif-trigger';
  notificationTrigger.setAttribute('aria-label','Notifications');
  notificationTrigger.setAttribute('aria-expanded','false');
  notificationTrigger.title='Notifications';
  notificationTrigger.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
  const count=document.createElement('span');count.className='yrm-notif-count';count.hidden=true;
  notificationTrigger.append(count);
  rightControls?.insertBefore(notificationTrigger,$('clock-text'));
  const notificationDrawer=document.createElement('section');
  notificationDrawer.className='yrm-notif-drawer';notificationDrawer.hidden=true;
  notificationDrawer.setAttribute('aria-label','Notifications');
  const notifHead=document.createElement('div');notifHead.className='yrm-notif-head';
  const notifTitle=document.createElement('strong');notifTitle.textContent='Notifications';
  const clear=document.createElement('button');clear.type='button';clear.className='yrm-notif-clear';clear.textContent='Clear all';
  notifHead.append(notifTitle,clear);
  const notifList=document.createElement('div');notifList.className='yrm-notif-list';
  notificationDrawer.append(notifHead,notifList);document.body.append(notificationDrawer);
  const saveNotifications=()=>{
    try{localStorage.setItem(notificationKey,JSON.stringify(notifications.slice(0,30)));}catch{}
  };
  function renderNotifications(){
    const unread=notifications.filter(n=>!n.read).length;
    count.hidden=unread===0;count.textContent=String(Math.min(99,unread));
    notifList.replaceChildren();
    if(!notifications.length){const empty=document.createElement('p');empty.className='yrm-notif-empty';
      empty.textContent='No notifications';notifList.append(empty);return;}
    for(const event of notifications){
      const item=document.createElement('article');item.className='yrm-notif-item';
      const title=document.createElement('strong');title.textContent=event.title;
      const source=document.createElement('small');
      source.textContent=`${event.source} · ${new Date(event.time).toLocaleString()}`;
      const msg=document.createElement('p');msg.textContent=event.message;
      item.append(title,source,msg);notifList.append(item);
    }
  }
  function showNotifications(open){
    notificationDrawer.hidden=!open;
    notificationTrigger.setAttribute('aria-expanded',String(open));
    if(open){notifications.forEach(n=>n.read=true);saveNotifications();renderNotifications();}
  }
  notificationTrigger.addEventListener('click',()=>showNotifications(notificationDrawer.hidden));
  clear.addEventListener('click',()=>{notifications=[];saveNotifications();renderNotifications();});
  document.addEventListener('pointerdown',event=>{
    if(!notificationDrawer.hidden && !notificationDrawer.contains(event.target) &&
       !notificationTrigger.contains(event.target))showNotifications(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !notificationDrawer.hidden)showNotifications(false);
  });
  function pushNotification(detail){
    if(!detail || typeof detail!=='object')return;
    const title=String(detail.title||'System notification').slice(0,90);
    const source=String(detail.source||'YRM Panel').slice(0,120);
    // Error details are supplied by the Panel, not arbitrary HTML. Redact common credential patterns.
    const message=String(detail.message||'Operation failed').replace(/((?:password|token|secret|api[_-]?key)\s*[:=]\s*)[^\s,&]+/ig,'$1[redacted]').slice(0,700);
     const kind=String(detail.kind||'system').toLowerCase().slice(0,32);
     const split=source.split(' · ');
     const provider=String(detail.provider||split[0]||'').trim().toLowerCase();
     const domain=String(detail.domain||split[1]||'').trim().toLowerCase();
     const family=String(detail.family||detail.ipFamily||'all').toLowerCase();
     // A DDNS retry updates the same provider/domain/family event, even if the error text changes.
     // Unrelated system messages retain a message-specific identity.
     const key=kind==='ddns'
       ? ['ddns',title.toLowerCase(),provider,domain,family].join('|')
       : [kind,title.toLowerCase(),source.toLowerCase(),message].join('|');
     const existing=notifications.find(n=>n.key===key ||
       (!n.key && n.title===title && n.source===source && n.message===message));
     if(existing){
       if(existing.message===message)return;
       existing.key=key;existing.message=message;existing.time=Date.now();
       existing.read=!notificationDrawer.hidden;
       notifications=[existing,...notifications.filter(n=>n!==existing)];
       saveNotifications();renderNotifications();return;
     }
     notifications.unshift({key,title,source,message,time:Date.now(),read:!notificationDrawer.hidden});
    notifications=notifications.slice(0,30);saveNotifications();renderNotifications();
  }
  window.addEventListener('yrm:notification',event=>pushNotification(event.detail));
  function scanDdnsFailures(){
    page?.querySelectorAll('[data-b9-ddns-record]').forEach(record=>{
      const error=record.querySelector('[data-b9-ddns-error]')?.textContent.trim();
      if(!error)return;
      const row=record.closest('[data-b9-ddns-provider]');
       pushNotification({kind:'ddns',title:'DDNS update failed',
        provider:row?.dataset.b9DdnsProvider||'Provider',
        domain:row?.dataset.b9DdnsHostname||'Domain',
        family:record.closest('td')?.cellIndex===2?'ipv4':'ipv6',
        source:`${row?.dataset.b9DdnsProvider||'Provider'} · ${row?.dataset.b9DdnsHostname||'Domain'}`,
        message:error});
    });
  }
  renderNotifications();
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
    if(!isDesktop)applyWindowBounds();
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
  const routeStorageKey='yrm-panel:last-workspace-route';
  function saveWorkspaceRoute(url) {
    try {
      if (url) sessionStorage.setItem(routeStorageKey,url);
      else sessionStorage.removeItem(routeStorageKey);
    } catch { /* Storage optional; routing remains functional. */ }
  }
  function showDesktop(push = true) {
    ++navigationId;
    rememberActive();
    activeUrl = null;
    saveWorkspaceRoute(null);
    setPageShell(true, "Desktop");
    renderTabs();
    closePopup(launcher, launcherButton);
    if (push) history.pushState({yrmPanelRoute:null}, "", "/");
    void refreshDesktop();
  }
  function showTab(url, push = true) {
    if (!page || !tabs.has(url)) return;
    if (activeUrl !== url) rememberActive();
    const tab = tabs.get(url);
    activeUrl = url;
    saveWorkspaceRoute(url);
    if (tab.fragment) {
      page.replaceChildren(tab.fragment);
      tab.fragment = null;
    }
    windowScroll.scrollTop = tab.scrollTop || 0;
    setPageShell(false, tab.title);
    renderTabs();
    closePopup(launcher, launcherButton);
    if (push) history.pushState({yrmPanelRoute:url}, "", "/");
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
  function errorToast(message) {
    showToast(message, "error");
    window.dispatchEvent(new CustomEvent('yrm:notification',{detail:{
      kind:'system',title:'Panel operation failed',source:'YRM Panel',message
    }}));
  }
  function harvestNotices(container) {
    container?.querySelectorAll(".notice[data-result-notice]").forEach(note => {
      const failure=note.dataset.resultNotice === "error";
      showToast(note.textContent.trim(), failure ? "error" : "success");
      if(failure)window.dispatchEvent(new CustomEvent('yrm:notification',{detail:{
        kind:'system',title:'Operation failed',source:'YRM Panel',message:note.textContent.trim()
      }}));
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
  // Existing Apps pin forms store the same server-side pins. Since these now
  // belong to the Taskbar, their accessible labels must not say "desktop".
  const updateAppPinLabels=()=>document.querySelectorAll('#window-page .app-pin-button').forEach(button=>{
    const form=button.closest('form');
    const pinned=form?.querySelector('input[name="pinned"]')?.value==='false';
    button.title=pinned?'Unpin from Taskbar':'Pin to Taskbar';
    button.setAttribute('aria-label',button.title);
  });
  updateAppPinLabels();
  const appPinObserver=new MutationObserver(updateAppPinLabels);
  if (page)appPinObserver.observe(page,{childList:true,subtree:false});

  // App dialogs and file dialogs are delegated because Razor content is loaded via Fetch.
  async function listFolders(path) {
    const tree = document.querySelector("#new-folder-tree");
    if (!document.querySelector("#new-folder-dialog")) return;
    if (tree) tree.replaceChildren();
    const folderPath = (path || "").replace(/^\/+|\/+$/g, "");
    try {
      const response = await fetch(`/Files?handler=Tree&path=${encodeURIComponent(folderPath)}`, {credentials:"same-origin", cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cannot read this folder.");
      const parentInput = document.querySelector("#new-folder-parent");
      if (parentInput) parentInput.value = data.path;
      const parentText = document.querySelector("#new-folder-parent-text");
      if (parentText) parentText.textContent = data.absolute;
      const volume = document.querySelector("#yrm-folder-volume");
      let volumeRoot = !volume && document.querySelector("#new-folder-dialog")?.dataset.currentVolumeRoot === "true";
      if (volume instanceof HTMLSelectElement) {
        const options = Array.from(volume.options).filter(o => o.value &&
          (data.path === o.value || data.path.startsWith(o.value + "/")));
        options.sort((a,b) => b.value.length - a.value.length);
        if (options.length) volume.value = options[0].value;
        volumeRoot = options.some(o => o.value === data.path && o.value !== "");
      }
      const nameInput = document.querySelector("#new-folder-dialog input[name=name]");
      const preview = document.querySelector("#new-folder-full-path");
      const rights = document.querySelector("#new-folder-rights");
      const submit = document.querySelector("#new-folder-dialog button[type=submit]");
      if (preview) preview.textContent = data.absolute + (nameInput?.value ? (data.path ? "/" : "") + nameInput.value : "");
      const canCreate = data.canManage || data.path === "" || (data.canEnable && volumeRoot);
      if (rights) rights.textContent = data.canManage || data.path === "" ? "" :
        (data.canEnable && volumeRoot ? "Linux authorization will enable this volume and create the folder." :
          "This folder is read-only. Enable management from Files first.");
      if (submit) submit.disabled = !canCreate;
      const form = document.querySelector("#new-folder-dialog .explorer-create-form");
      if (form) {
        if (data.canEnable && volumeRoot) form.dataset.requiresAdmin = "Enable volume access and create folder";
        else delete form.dataset.requiresAdmin;
      }
      const makeItem = (name, nextPath, icon) => {
        const b = document.createElement("button"); b.type="button"; b.className="explorer-tree-item";
        b.textContent = `${icon}  ${name}`;
        b.addEventListener("click", () => void listFolders(nextPath));
        return b;
      };
      if (tree) {
        if (data.path) tree.append(makeItem("..", data.path.split("/").slice(0,-1).join("/"), "↰"));
        for (const name of data.folders || []) tree.append(makeItem(name, data.path ? `${data.path}/${name}` : name,"📁"));
        if (!data.folders?.length) tree.append(document.createTextNode("No subfolders."));
      }
    } catch (error) { if (tree) tree.textContent = error.message; }
  }
  async function listActionFolders(path) {
    const host=$("yrm-b12-action-tree"), field=$("file-action-value");
    if (!host || !field) return;
    host.replaceChildren();
    const rel=(path||"").replace(/^\/+|\/+$/g,"");
    try {
      const response=await fetch(`/Files?handler=Tree&path=${encodeURIComponent(rel)}`,{
        credentials:"same-origin",cache:"no-store"});
      const data=await response.json();
      if (!response.ok)throw new Error(data.error||"Cannot browse folder.");
      field.value=data.path;
      const rights=$("yrm-b12-action-rights");
      if (rights)rights.textContent=data.canManage?'':`Read-only: ${data.absolute}`;
      const submit=$("file-action-form")?.querySelector('button[type="submit"]');
      if (submit)submit.disabled=!data.canManage;
      const add=(label,nextPath)=>{
        const button=document.createElement("button");button.type="button";
        button.className="explorer-tree-item";button.textContent=label;
        button.addEventListener("click",()=>void listActionFolders(nextPath));host.append(button);
      };
      if (data.path)add("↰  Parent folder",data.path.split("/").slice(0,-1).join("/"));
      for (const name of data.folders||[])add(`📁  ${name}`,data.path?`${data.path}/${name}`:name);
      if (!data.folders?.length)host.append(document.createTextNode("No subfolders."));
    } catch(error){host.textContent=error.message;}
  }
  function openDialog(id) { const node = $(id); if (node && !node.open) node.showModal(); }
  document.addEventListener("input", event=>{
    if (event.target?.id!=="file-action-value")return;
    const form=$("file-action-form");
    const submit=form?.querySelector('button[type="submit"]');
    if (submit)submit.disabled=!event.target.value.trim();
  });
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
    if (button.dataset.renameItem || button.dataset.moveItem || button.dataset.copyItem) {
      const rename = button.hasAttribute("data-rename-item");
      const copy = button.hasAttribute("data-copy-item");
      const form = $("file-action-form");
      if (!form) return;
      const item = rename ? button.dataset.renameItem : copy ? button.dataset.copyItem : button.dataset.moveItem;
      const path = new URLSearchParams(location.search).get("path") || "";
      form.action = `/Files?handler=${rename ? "Rename" : copy ? "Copy" : "Move"}&path=${encodeURIComponent(path)}`;
      $("file-action-name").value = item;
      const input = $("file-action-value");
      input.name = rename ? "newName" : "destination";
      input.type = rename ? "text" : "hidden";
      input.required = rename;
      input.value = rename ? item : "";
      $("yrm-b121-action-input-row")?.toggleAttribute("hidden", !rename);
      $("file-action-title").textContent = rename ? `Rename ${item}` : `${copy ? "Copy" : "Move"} ${item} to...`;
      const chooser = $("yrm-b12-action-picker");
      if (chooser) chooser.hidden=rename;
      input.maxLength=rename?255:1024;
      const submit=form.querySelector('button[type="submit"]');
      if (submit)submit.disabled=!rename;
      $("file-action-label").textContent = "New name";
      if (submit)submit.textContent = rename ? "Rename" : copy ? "Copy" : "Move";
      openDialog("file-action-dialog");
      if (!rename)void listActionFolders(path);
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
  document.addEventListener("change", event => {
    if (event.target.id === "yrm-folder-volume") void listFolders(event.target.value);
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
      saveWorkspaceRoute(url);
      page.replaceChildren(fragment);
      harvestNotices(page);
      scanDdnsFailures();
      windowScroll.scrollTop = 0;
      setPageShell(false, title);
      renderTabs();
      closePopup(launcher, launcherButton);
      if (push) history.pushState({yrmPanelRoute:url}, "", "/");
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
  if (location.pathname !== "/" || !history.state || !("yrmPanelRoute" in history.state)) {
    history.replaceState({yrmPanelRoute:activeUrl}, "", "/");
  }
  setPageShell(activeUrl === null, body.dataset.initialTitle || "Desktop");
  renderTabs();
  scanDdnsFailures();
  void loadTaskbarPins();
  if (activeUrl === null) {
    try {
      const saved=sessionStorage.getItem(routeStorageKey);
      if (saved && internalUrl(saved)) void openPage(saved,{push:false});
    } catch { /* Not essential. */ }
  }


  homeButton?.addEventListener("click", () => showDesktop());
  $("window-minimize")?.addEventListener("click", () => showDesktop());
  $("window-close")?.addEventListener("click", () => { if (activeUrl) closeTab(activeUrl); });
  $("window-maximize")?.addEventListener("click",toggleWindowMaximize);
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
  window.addEventListener("popstate", event => {
    const url = event.state?.yrmPanelRoute;
    if (!url) showDesktop(false);
    else if (internalUrl(url)) void openPage(url, {push:false});
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
    // Confirmation is handled once by v1-confirm.js before sudo authorization.
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
      saveWorkspaceRoute(targetUrl);
      const fragment = document.createDocumentFragment();
      for (const node of Array.from(remotePage.childNodes)) fragment.append(document.importNode(node, true));
      page.replaceChildren(fragment);
      harvestNotices(page);
      scanDdnsFailures();
      // Refresh Files on next opening after any disk mount-state change.
      if (canonicalPath(submittedUrl.split("?")[0]) === "/Settings" &&
          /^(Mount|Unmount|InitializeDisk|CompleteDisk)$/.test(action.searchParams.get("handler") || "")) {
        for (const [url, tab] of tabs) {
          if (canonicalPath(url.split("?")[0]) === "/Files") tab.fragment = null;
        }
      }
      if (["/Settings","/Applications"].includes(canonicalPath(submittedUrl.split("?")[0]))) void refreshDesktop();
      if (canonicalPath(submittedUrl.split("?")[0]) === "/Applications") void loadTaskbarPins();
      windowScroll.scrollTop = 0;
      const title = doc.body.dataset.initialTitle || "Application";
      if (tabs.has(activeUrl)) { tabs.get(activeUrl).title = title; tabs.get(activeUrl).fragment = null; }
      setPageShell(false, title);
      renderTabs();
      history.replaceState({yrmPanelRoute:targetUrl}, "", "/");
    } catch (error) {
      errorToast(`Operation not confirmed: ${error.message}. Check the current state before retrying.`);
    } finally {
      actionPending = false;
      if (button?.isConnected) button.disabled = false;
    }
  });

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
