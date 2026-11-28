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
  let desktopNeedsRefresh = false;
  let taskbarPins = [];
  let taskbarShortcuts = [];
  let taskbarCsrf = "";
  let activeUrl = null;
  let navigationId = 0;
  let pinnedEnabled = false;
  let lastMonitorTrigger = null;

  // Do not accept arbitrary same-origin routes into the workspace shell.
  const allowedPages = new Set(["/Docker", "/Services", "/Settings", "/Features", "/Files", "/Shares"]);
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
    // A desktop widget stays present across apps; the window occludes it naturally.
    if (pinned) pinned.hidden = !pinnedEnabled;
    pinButton?.setAttribute("aria-pressed", String(pinnedEnabled));
    pinButton?.classList.toggle("is-active", pinnedEnabled);
    pinButton?.querySelector('use')?.setAttribute('href', pinnedEnabled ? '#i-pin-off' : '#i-pin');
    pinButton?.setAttribute("aria-label", pinnedEnabled ? "Unpin system monitor" : "Pin system monitor");
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
      taskbarPins = Array.isArray(data.pins) ? data.pins.filter(x => typeof x === "string" && x !== "/Applications" && !x.startsWith("link:")) : [];
      // Old manual links remain in settings.json for compatibility; no longer displayed.
      taskbarShortcuts = [];
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
      const id=taskbarId(new URL(linkRoute(link),location.href).pathname);
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
      pin.setAttribute('aria-label',taskbarPins.includes(id)?"Unpin from Taskbar":"Pin to Taskbar");
      pin.classList.toggle('is-pinned',taskbarPins.includes(id));
      pin.innerHTML=`<svg class="ui-icon" aria-hidden="true"><use href="${taskbarPins.includes(id)?'#i-pin-off':'#i-pin'}"></use></svg>`;
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
    opener.setAttribute("aria-label", `Open ${name}`);
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
  // The stored bounds are the user's own state. A viewport change (a docked
  // developer-tools panel, a resized browser) never rewrites them: the window
  // keeps its size and position and may simply be partly covered. Only when
  // the title bar would become unreachable is the displayed position nudged,
  // and the stored bounds are shown again as soon as the space returns.
  const windowBounds = new Map();
  let windowNudged = false;
  const GRAB_WIDTH = 120, GRAB_HEIGHT = 40;
  const windowTitlebar = appWindow?.querySelector('.window-titlebar');
  const workspaceKey = () => canonicalPath((activeUrl || '/Settings').split('?')[0]);
  const availableSpace = () => ({
    width: Math.max(280, stage?.clientWidth || innerWidth),
    height: Math.max(250, stage?.clientHeight || innerHeight - 49)
  });
  // Smallest position change that keeps the title bar reachable; size is never touched.
  function reachableBounds(bounds) {
    const space=availableSpace();
    const width=Math.max(1,Number(bounds.width)||0);
    const height=Math.max(1,Number(bounds.height)||0);
    const grab=Math.min(GRAB_WIDTH,width);
    return {left:Math.max(grab-width,Math.min(space.width-grab,Number(bounds.left)||0)),
      top:Math.max(0,Math.min(space.height-GRAB_HEIGHT,Number(bounds.top)||0)),width,height};
  }
  // Used only for the first placement of a window that has no stored bounds.
  function clampWindowBounds(bounds) {
    const space=availableSpace();
    const minWidth=Math.min(640,space.width);
    const minHeight=Math.min(360,space.height);
    const width=Math.max(minWidth,Math.min(space.width, Number(bounds.width)||minWidth));
    const height=Math.max(minHeight,Math.min(space.height, Number(bounds.height)||minHeight));
    return {left:Math.max(0,Math.min(space.width-width,Number(bounds.left)||0)),
      top:Math.max(0,Math.min(space.height-height,Number(bounds.top)||0)),width,height};
  }
  function readWindowBounds() {
    if (!appWindow || !stage) return null;
    const r=appWindow.getBoundingClientRect(), sr=stage.getBoundingClientRect();
    return {left:r.left-sr.left,top:r.top-sr.top,width:r.width,height:r.height};
  }
  // Only a finished drag/resize gesture (force) may overwrite bounds that are
  // currently being displayed nudged; anything else would lose the original.
  function storeWindowBounds(force = false) {
    if (!activeUrl || appWindow?.classList.contains('is-maximized'))return;
    if (windowNudged && !force)return;
    const bounds=readWindowBounds();
    if (bounds){windowBounds.set(workspaceKey(),bounds);windowNudged=false;}
  }
  function showWindowBounds(bounds) {
    const shown=reachableBounds(bounds);
    windowNudged=Math.abs(shown.left-bounds.left)>0.5||Math.abs(shown.top-bounds.top)>0.5;
    for(const [name,value] of Object.entries(shown))appWindow.style[name]=`${Math.round(value)}px`;
  }
  function applyWindowBounds() {
    if (!appWindow || appWindow.classList.contains('is-maximized') || !activeUrl)return;
    const key=workspaceKey();
    let bounds=windowBounds.get(key);
    if (!bounds) {
      // First placement: centre once, then remember it so later viewport
      // changes never re-centre (and therefore never move) the window.
      const space=availableSpace();
      const preferredWidth=key==='/Files'?1300:key==='/Settings'?1080:1120;
      const width=Math.min(preferredWidth,space.width-32);
      const height=Math.min(key==='/Files'?800:740,space.height-30);
      bounds=clampWindowBounds({left:(space.width-width)/2,top:(space.height-height)/2,width,height});
      windowBounds.set(key,bounds);
    }
    showWindowBounds(bounds);
  }
  function toggleWindowMaximize() {
    if (!appWindow)return;
    if (!appWindow.classList.contains('is-maximized'))storeWindowBounds();
    appWindow.classList.toggle('is-maximized');
    if (!appWindow.classList.contains('is-maximized'))applyWindowBounds();
    const button=$('window-maximize');
    if(button)button.setAttribute('aria-label',appWindow.classList.contains('is-maximized')?'Restore window':'Maximize window');
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
        const next=reachableBounds({...start,left:start.left+(e.clientX-startX),
          top:start.top+(e.clientY-startY)});
        appWindow.style.left=next.left+'px';appWindow.style.top=next.top+'px';
      };
      const end=()=>{
        windowTitlebar.removeEventListener('pointermove',move);
        windowTitlebar.removeEventListener('pointerup',end);
        windowTitlebar.removeEventListener('pointercancel',end);
        storeWindowBounds(true);
      };
      windowTitlebar.addEventListener('pointermove',move);
      windowTitlebar.addEventListener('pointerup',end);
      windowTitlebar.addEventListener('pointercancel',end);
      event.preventDefault();
    });
    window.addEventListener('resize',()=>{
      if(appWindow.classList.contains('is-maximized') || !activeUrl)return;
      const stored=windowBounds.get(workspaceKey());
      if(stored)showWindowBounds(stored);
    });
  }
  // Eight-direction resize; the native bottom-right CSS grip is disabled.
  // Geometry remains owned by the existing windowBounds controller.
  if(appWindow && stage){
    for(const edge of ['n','ne','e','se','s','sw','w','nw']){
      const handle=document.createElement('div');handle.className='yrm-resize-handle';
      handle.dataset.edge=edge;handle.setAttribute('aria-hidden','true');appWindow.append(handle);
      handle.addEventListener('pointerdown',event=>{
        if(event.button!==0||!activeUrl||appWindow.classList.contains('is-maximized'))return;
        const start=readWindowBounds();if(!start)return;
        const original={x:event.clientX,y:event.clientY};
        handle.setPointerCapture(event.pointerId);
        const move=e=>{
          const bounds=availableSpace();
          const dx=e.clientX-original.x,dy=e.clientY-original.y;
          const minW=Math.min(640,bounds.width),minH=Math.min(360,bounds.height);
          let {left,top,width,height}=start;
          // A window already wider/taller than the stage keeps its size until the user shrinks it.
          if(edge.includes('e'))width=Math.max(minW,Math.min(Math.max(bounds.width-left,start.width),start.width+dx));
          if(edge.includes('s'))height=Math.max(minH,Math.min(Math.max(bounds.height-top,start.height),start.height+dy));
          if(edge.includes('w')){
            left=Math.max(Math.min(0,start.left),Math.min(start.left+start.width-minW,start.left+dx));
            width=start.width+start.left-left;
          }
          if(edge.includes('n')){
            top=Math.max(0,Math.min(start.top+start.height-minH,start.top+dy));
            height=start.height+start.top-top;
          }
          Object.entries({left,top,width,height}).forEach(([k,v])=>appWindow.style[k]=Math.round(v)+'px');
        };
        const end=()=>{
          handle.removeEventListener('pointermove',move);
          handle.removeEventListener('pointerup',end);
          handle.removeEventListener('pointercancel',end);
          storeWindowBounds(true);
        };
        handle.addEventListener('pointermove',move);
        handle.addEventListener('pointerup',end);
        handle.addEventListener('pointercancel',end);
        event.preventDefault();event.stopPropagation();
      });
    }
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
    // Browser chrome belongs to the persistent shell, not the active app.
    if (document.title !== "YRM PANEL") document.title = "YRM PANEL";
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
    // Switching apps must not fetch and rebuild the desktop each time.
    // Only application shortcut mutations invalidate the desktop content.
    if (desktopNeedsRefresh) { desktopNeedsRefresh = false; void refreshDesktop(); }
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
    // Keep the persistent topbar avatar in sync after changing the photo.
    const avatarSelectors=['#profile-toggle .profile-avatar','#profile-menu .profile-avatar'];
    for(const selector of avatarSelectors){
      const currentAvatar=document.querySelector(selector);
      const freshAvatar=doc.querySelector(selector);
      if(currentAvatar&&freshAvatar)
        currentAvatar.replaceChildren(...Array.from(freshAvatar.childNodes,n=>document.importNode(n,true)));
    }
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
    button.setAttribute('aria-label',pinned?'Unpin from Taskbar':'Pin to Taskbar');
  });
  updateAppPinLabels();
  const appPinObserver=new MutationObserver(updateAppPinLabels);
  if (page)appPinObserver.observe(page,{childList:true,subtree:false});

  // App dialogs and file dialogs are delegated because Razor content is loaded via Fetch.
  // New Folder uses a real lazy directory tree. Navigation never changes the
  // current Files view; the selected parent alone determines the destination.
  let folderLocationRequest = 0;
  const folderPathKey = path => String(path || '').replace(/^\/+|\/+$/g, '');
  const folderTreeData = async path => {
    const response = await fetch(`/Files?handler=Tree&path=${encodeURIComponent(folderPathKey(path))}`,
      {credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}});
    if (!response.ok || response.redirected) throw new Error('Cannot read this location.');
    const data = await response.json();
    if (!Array.isArray(data?.folders) || typeof data.path !== 'string')
      throw new Error('Invalid directory listing.');
    return data;
  };
  function createFolderTreeNode(label, path) {
    const node = document.createElement('div');
    node.className = 'yrm-create-tree-node';
    node.dataset.folderPath = folderPathKey(path);
    node.setAttribute('role','treeitem');
    const row = document.createElement('div');row.className='yrm-create-tree-row';
    const toggle = document.createElement('button');
    toggle.type='button';toggle.className='yrm-create-tree-toggle';
    toggle.setAttribute('aria-label',`Expand ${label}`);toggle.setAttribute('aria-expanded','false');
    const chevron=document.createElementNS('http://www.w3.org/2000/svg','svg');chevron.classList.add('ui-icon');
    const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-chevron');
    chevron.append(use);toggle.append(chevron);
    const select=document.createElement('button');select.type='button';
    select.className='yrm-create-tree-select';select.dataset.folderTreeSelect='';
    select.setAttribute('aria-current','false');
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('ui-icon');
    const iconUse=document.createElementNS('http://www.w3.org/2000/svg','use');
    iconUse.setAttribute('href','#i-folder');icon.append(iconUse);
    const text=document.createElement('span');text.textContent=label;
    select.append(icon,text);row.append(toggle,select);
    const children=document.createElement('div');children.className='yrm-create-tree-children';
    children.setAttribute('role','group');children.hidden=true;
    node.append(row,children);
    select.addEventListener('click',()=>void listFolders(node.dataset.folderPath));
    toggle.addEventListener('click',()=>void expandFolderTreeNode(node,toggle.getAttribute('aria-expanded')!=='true'));
    return node;
  }
  async function expandFolderTreeNode(node, expanded) {
    const toggle=node.querySelector(':scope > .yrm-create-tree-row > .yrm-create-tree-toggle');
    const children=node.querySelector(':scope > .yrm-create-tree-children');
    if (!toggle || !children) return;
    toggle.setAttribute('aria-expanded',String(expanded));
    if (!expanded) {children.hidden=true;return;}
    if (children.dataset.loaded==='1') {children.hidden=!children.children.length;return;}
    if (children.dataset.loading==='1') {
      // Revealing a path and manually expanding it can overlap. Share the
      // same request rather than drawing a partial tree or losing selection.
      if (node.folderLoadPromise) await node.folderLoadPromise;
      children.hidden=!children.children.length || toggle.getAttribute('aria-expanded')!=='true';
      return;
    }
    children.dataset.loading='1';
    node.folderLoadPromise=folderTreeData(node.dataset.folderPath);
    try {
      const data=await node.folderLoadPromise;
      if (!children.isConnected) return;
      children.replaceChildren();
      for (const name of data.folders) {
        const child=data.path ? `${data.path}/${name}` : name;
        children.append(createFolderTreeNode(name,child));
      }
      children.dataset.loaded='1';
      // Empty folders still rotate their chevron; no fake empty row is added.
      children.hidden=!children.children.length || toggle.getAttribute('aria-expanded')!=='true';
    } catch (error) {
      if (children.isConnected) {
        children.replaceChildren();
        const warning=document.createElement('span');warning.className='yrm-create-tree-empty';
        warning.textContent=error.message || 'Cannot read folder.';
        children.append(warning);children.hidden=false;
        toggle.setAttribute('aria-expanded','false');
      }
    } finally {delete children.dataset.loading;delete node.folderLoadPromise;}
  }
  function resetFolderTree() {
    const tree=document.querySelector('#new-folder-tree');
    const volume=document.querySelector('#yrm-folder-volume');
    if (!tree || !(volume instanceof HTMLSelectElement)) return;
    tree.replaceChildren();
    for (const opt of volume.options) tree.append(createFolderTreeNode(opt.textContent.trim(),opt.value));
    tree.dataset.ready='1';
  }
  async function revealFolderTree(path, request) {
    const tree=document.querySelector('#new-folder-tree');if (!tree) return;
    const normalized=folderPathKey(path);
    const roots=Array.from(tree.children).filter(node=>{
      const key=node.dataset.folderPath;
      return key==='' || normalized===key || normalized.startsWith(key+'/');
    }).sort((a,b)=>b.dataset.folderPath.length-a.dataset.folderPath.length);
    let node=roots[0];if (!node) return;
    const base=node.dataset.folderPath;
    const rest=normalized.slice(base.length).replace(/^\//,'').split('/').filter(Boolean);
    for (const name of rest) {
      await expandFolderTreeNode(node,true);
      if (request!==folderLocationRequest || !tree.isConnected) return;
      const nextPath=node.dataset.folderPath ? node.dataset.folderPath+'/'+name : name;
      const children=node.querySelector(':scope > .yrm-create-tree-children');
      const next=Array.from(children?.children||[]).find(item=>item.dataset.folderPath===nextPath);
      if (!next) break;
      node=next;
    }
    await expandFolderTreeNode(node,true);
    if (request!==folderLocationRequest || !tree.isConnected) return;
    for (const item of tree.querySelectorAll('[data-folder-tree-select]'))
      item.setAttribute('aria-current',String(item.parentElement?.parentElement?.dataset.folderPath===normalized));
  }
  async function listFolders(path) {
    const dialog=document.querySelector('#new-folder-dialog');
    const tree=document.querySelector('#new-folder-tree');
    if (!dialog || !tree) return;
    if (tree.dataset.ready!=='1') resetFolderTree();
    const request=++folderLocationRequest;
    const submit=dialog.querySelector('button[type="submit"]');
    if (submit) submit.disabled=true;
    try {
      const data=await folderTreeData(path);
      if (request!==folderLocationRequest || !tree.isConnected) return;
      const parent=dialog.querySelector('#new-folder-parent');
      if (parent) parent.value=data.path;
      const selected=dialog.querySelector('#new-folder-parent-text');
      if (selected) selected.textContent=data.absolute;
      const volume=dialog.querySelector('#yrm-folder-volume');
      let volumeRoot=false;
      if (volume instanceof HTMLSelectElement) {
        const choices=Array.from(volume.options).filter(o=>o.value &&
          (data.path===o.value || data.path.startsWith(o.value+'/')));
        choices.sort((a,b)=>b.value.length-a.value.length);
        volume.value=choices[0]?.value || '';
        volumeRoot=choices.some(o=>o.value===data.path);
      }
      const canCreate=Boolean(data.canManage || !data.path || (data.canEnable && volumeRoot));
      if (submit) submit.disabled=!canCreate;
      const rights=dialog.querySelector('#new-folder-rights');
      if (rights) rights.textContent=canCreate?'':'This location is read-only.';
      const form=dialog.querySelector('.explorer-create-form');
      if (form) {
        if (data.canEnable && volumeRoot && !data.canManage)
          form.dataset.requiresAdmin='Enable volume access and create folder';
        else delete form.dataset.requiresAdmin;
      }
      await revealFolderTree(data.path,request);
    } catch (error) {
      if (request!==folderLocationRequest || !tree.isConnected) return;
      const rights=dialog.querySelector('#new-folder-rights');
      if (rights) rights.textContent=error.message || 'Cannot read this folder.';
    }
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
  // Rename / copy / move / share dialogs are opened by files-actions.js through one event,
  // so they are not tied to per-row buttons. `names` is the whole selection for a bulk copy/move.
  window.addEventListener("yrm-panel:file-action", event => {
    const {kind, name = "", source = "", names = [], absolute = "", path: workFolder, returnTo} = event.detail || {};
    if (kind === "share") {
      const full = $("share-absolute-folder");
      if (full) full.value = absolute;
      $("share-folder-name").value = name;
      $("share-folder-alias").value = name;
      $("share-folder-target").textContent = `Folder: ${name}`;
      openDialog("share-folder-dialog");
      return;
    }
    const rename = kind === "rename", copy = kind === "copy";
    if (!rename && !copy && kind !== "move") return;
    const form = $("file-action-form");
    if (!form) return;
    // The entries live in workFolder (an expanded folder may differ from the one on screen); the
    // server returns to the view the user was in.
    const path = workFolder ?? (form.dataset.currentRoute || "");
    const bulk = !rename && (names.length > 1 || !!source);
    const handler = rename ? "Rename" : bulk ? (copy ? "BulkCopy" : "BulkMove") : (copy ? "Copy" : "Move");
    form.action = `/Files?handler=${handler}&path=${encodeURIComponent(path)}` +
      `&return=${encodeURIComponent(returnTo ?? (form.dataset.currentRoute || ""))}`;
    form.querySelectorAll("[data-bulk-selected-name]").forEach(field => field.remove());
    if (bulk) for (const selected of names) {
      const field = document.createElement("input");
      field.type = "hidden"; field.name = "names"; field.value = selected; field.dataset.bulkSelectedName = "1";
      form.append(field);
    }
    $("file-action-name").value = name;
    const sourceField = $("file-action-source");
    if (sourceField) sourceField.value = source;
    const input = $("file-action-value");
    input.name = rename ? "newName" : "destination";
    input.type = rename ? "text" : "hidden";
    input.required = rename;
    input.value = rename ? name : "";
    $("yrm-b121-action-input-row")?.toggleAttribute("hidden", !rename);
    $("file-action-title").textContent = rename ? `Rename ${name}`
      : bulk && names.length > 1 ? `${copy ? "Copy" : "Move"} ${names.length} items to...`
      : `${copy ? "Copy" : "Move"} ${name} to...`;
    const chooser = $("yrm-b12-action-picker");
    if (chooser) chooser.hidden = rename;
    input.maxLength = rename ? 255 : 1024;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = !rename;
    $("file-action-label").textContent = "New name";
    if (submit) submit.textContent = rename ? "Rename" : copy ? "Copy" : "Move";
    openDialog("file-action-dialog");
    if (!rename) void listActionFolders(path === "@folders" ? (form.dataset.defaultActionFolder || "") : path);
  });
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
      resetFolderTree();
      void listFolders(initial);
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
  document.addEventListener('click',event=>{
    if (event.target.closest?.('[data-create-tree-root]')) void listFolders('');
  });
  document.addEventListener("change", event => {
    if (event.target.id === "yrm-folder-volume") void listFolders(event.target.value);
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
  // Keep short-lived, same-origin Files responses ready while the pointer is
  // over a folder. This is a bounded cache for navigation, not a separate file
  // database; any mutation/Refresh clears it. Other apps retain normal fetch.
  const filesPageCache = new Map();
  const filesCacheLifetime = 4500;
  async function fetchWorkspacePage(url, refresh = false) {
    if (canonicalPath(url.split('?')[0]) !== '/Files')
      return fetch(url, {credentials:'same-origin',headers:{'Accept':'text/html'},cache:'no-store'});
    if (refresh) filesPageCache.delete(url);
    const now = Date.now();
    let entry = filesPageCache.get(url);
    if (entry && now - entry.at >= filesCacheLifetime) {
      filesPageCache.delete(url); entry = null;
    }
    if (!entry) {
      const pending = fetch(url,{credentials:'same-origin',headers:{'Accept':'text/html',...(refresh?{'X-YRM-Refresh':'1'}:{})},cache:'no-store'});
      entry = {at:now,promise:pending};
      filesPageCache.set(url,entry);
      pending.catch(() => {if (filesPageCache.get(url) === entry) filesPageCache.delete(url);});
      if (filesPageCache.size > 7) filesPageCache.delete(filesPageCache.keys().next().value);
    }
    return (await entry.promise).clone();
  }
  let filesPrefetchTimer = null;
  document.addEventListener('pointerover', event => {
    if (!activeUrl?.startsWith('/Files')) return;
    const anchor = event.target instanceof Element ? event.target.closest(
      '.fm-explorer [data-fm-href],.fm-explorer [data-fm-inline-folder],.fm-explorer [data-fm-tree-folder],.fm-explorer .fm-locations a,.fm-explorer .fm-breadcrumbs a') : null;
    if (!anchor || (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) return;
    const url = internalUrl(anchor.getAttribute('href') || anchor.dataset.fmHref || '');
    if (!url || url === activeUrl || canonicalPath(url.split('?')[0]) !== '/Files' ||
        new URL(url,location.origin).searchParams.has('handler')) return;
    if (filesPrefetchTimer !== null) clearTimeout(filesPrefetchTimer);
    filesPrefetchTimer = setTimeout(() => {
      filesPrefetchTimer = null;
      void fetchWorkspacePage(url).catch(() => {});
    }, 100);
  }, true);
  document.addEventListener('pointerout', event => {
    if (filesPrefetchTimer === null || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href],a[data-fm-href]');
    if (anchor && !(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) {
      clearTimeout(filesPrefetchTimer); filesPrefetchTimer = null;
    }
  }, true);

  // A Files navigation changes the breadcrumb, toolbar actions and directory
  // rows, NOT the whole workspace pane. Keep the scroll host and sibling DOM.
  function reconcileFilesContent(oldContent, newContent) {
    const oldPath = oldContent.querySelector('.fm-unified-path');
    const freshPath = newContent.querySelector('.fm-unified-path');
    const oldTools = oldContent.querySelector('.fm-compact-toolbar');
    const freshTools = newContent.querySelector('.fm-compact-toolbar');
    const oldDirectory = oldContent.querySelector('[data-fm-directory-view]');
    const freshDirectory = newContent.querySelector('[data-fm-directory-view]');
    if (!oldPath || !freshPath || !oldTools || !freshTools || !oldDirectory || !freshDirectory)
      return false;
    const oldCrumbs = oldPath.querySelector('.fm-breadcrumbs');
    const freshCrumbs = freshPath.querySelector('.fm-breadcrumbs');
    if (!oldCrumbs || !freshCrumbs) return false;
    if (oldCrumbs.innerHTML !== freshCrumbs.innerHTML)
      oldCrumbs.replaceChildren(...Array.from(freshCrumbs.childNodes,node=>document.importNode(node,true)));
    const oldRefresh = oldPath.querySelector('.fm-history-refresh');
    const freshRefresh = freshPath.querySelector('.fm-history-refresh');
    if (oldRefresh && freshRefresh) {
      const freshTarget = freshRefresh.getAttribute('href') || freshRefresh.dataset.fmHref;
      if (freshTarget) oldRefresh.dataset.fmHref = freshTarget;
      oldRefresh.removeAttribute('href');
    }
    if (oldTools.innerHTML !== freshTools.innerHTML)
      oldTools.replaceChildren(...Array.from(freshTools.childNodes,node=>document.importNode(node,true)));
    // Replace the entries only; the directory's wrapper, layout, toolbar,
    // sidebar and window survive the navigation. No artificial fade/spinner.
    oldDirectory.replaceChildren(...Array.from(freshDirectory.childNodes,node=>document.importNode(node,true)));
    oldDirectory.querySelector('.responsive-table')?.scrollTo({top:0,left:0});
    return true;
  }

  // One owner for "hovering a link never shows a URL in the browser status bar".
  // The browser only previews anchors that carry an href, so every anchor loses
  // it the moment it enters the page (first render, fetched views, dialogs,
  // anything a script inserts or re-points). The original target moves to a
  // data attribute and the click handler below performs the action:
  //   data-fm-href / data-panel-route  in-app navigation (Files / other windows)
  //   data-yrm-download                file download, started from a detached anchor
  //   data-yrm-external                new browser tab
  //   data-yrm-open                    everything else (desktop, log viewer, other pages)
  const GUARDED_LINKS = '[data-yrm-download],[data-yrm-external],[data-yrm-open]';
  function linkRoute(a) {
    return a.getAttribute('href') || a.dataset.fmHref || a.dataset.panelRoute || a.dataset.yrmOpen || '';
  }
  function guardLink(a) {
    const raw = a.getAttribute('href');
    if (raw === null || a.hasAttribute('data-yrm-transient')) return;
    a.removeAttribute('href');
    if (!a.hasAttribute('role')) a.setAttribute('role', 'link');
    if (!a.hasAttribute('tabindex')) a.tabIndex = 0;
    if (!raw || raw === '#') return; // placeholder; a real href set later is guarded again
    let url = null;
    try { url = new URL(raw, location.href); } catch (_) { /* treated as external below */ }
    if (a.hasAttribute('download') || a.hasAttribute('data-native-download')) { a.dataset.yrmDownload = raw; return; }
    if (!url || url.origin !== location.origin || (a.target && a.target !== '_self')) { a.dataset.yrmExternal = raw; return; }
    if (a.hasAttribute('data-log-viewer') || !internalUrl(url.href)) { a.dataset.yrmOpen = raw; return; }
    if (a.closest('.fm-explorer')) a.dataset.fmHref = raw; else a.dataset.panelRoute = raw;
  }
  function guardLinks(root) {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && root.matches('a[href]')) guardLink(root);
    root.querySelectorAll('a[href]').forEach(guardLink);
  }
  function startLinkGuard() {
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target instanceof Element && record.target.matches('a[href]')) guardLink(record.target);
        } else record.addedNodes.forEach(node => { if (node instanceof Element) guardLinks(node); });
      }
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['href']});
    guardLinks(document.body);
  }
  function activateGuardedLink(el) {
    const raw = el.dataset.yrmDownload ?? el.dataset.yrmExternal ?? el.dataset.yrmOpen ?? '';
    if (!raw || raw === '#') return;
    if (el.dataset.yrmDownload !== undefined) {
      // Streamed natively by the browser (no blob in memory). The anchor is
      // removed within the same task, so it can never be hovered.
      const a = document.createElement('a');
      a.hidden = true; a.setAttribute('data-yrm-transient', '');
      a.href = raw; a.download = el.getAttribute('download') || '';
      document.body.append(a); a.click(); a.remove();
      return;
    }
    if (el.dataset.yrmExternal !== undefined) { window.open(raw, '_blank', 'noopener,noreferrer'); return; }
    if (el.hasAttribute('data-log-viewer')) { void openLogs(new URL(raw, location.href).href); return; }
    if (isDesktopUrl(raw)) { showDesktop(); return; }
    const url = internalUrl(raw);
    if (url) { void openPage(url); return; }
    location.assign(raw);
  }
  // Keyboard parity with the removed href: Enter activates a guarded link.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const el = event.target instanceof Element ? event.target.closest(GUARDED_LINKS + ',[data-panel-route]') : null;
    if (!el) return;
    event.preventDefault();
    el.click();
  });

  // Replacing a Settings pane recreates every <img>, so thumbnails that were
  // already decoded (Appearance > Recently Used) flash while they load again.
  // Carry the existing, fully loaded elements over whenever their src is unchanged.
  function adoptUnchangedImages(oldContent, freshContent) {
    const selector = '.yrm-wallpaper-recent-grid img';
    const loaded = new Map();
    oldContent.querySelectorAll(selector).forEach(img => {
      const src = img.getAttribute('src');
      if (src && img.complete && img.naturalWidth > 0 && !loaded.has(src)) loaded.set(src, img);
    });
    if (!loaded.size) return;
    freshContent.querySelectorAll(selector).forEach(img => {
      const src = img.getAttribute('src');
      const existing = loaded.get(src);
      if (!existing) return;
      loaded.delete(src);
      img.replaceWith(existing);
    });
  }

  // Preserve Files/Settings navigation DOM when loading an inner view.
  // The server may return a full Razor document, but only the working pane
  // changes. This avoids collapsing and rebuilding the sidebar on every click.
  function reconcileWorkspaceView(remotePage, targetUrl) {
    const previous = canonicalPath((activeUrl || '').split('?')[0]);
    const incoming = canonicalPath((targetUrl || '').split('?')[0]);
    if (previous !== incoming || !['/Files','/Settings'].includes(incoming)) return false;
    const rootSelector = incoming === '/Files' ? '.fm-explorer' : '.server-settings-layout';
    const navSelector = incoming === '/Files' ? '.fm-locations' : '.server-settings-nav';
    const contentSelector = incoming === '/Files' ? '.fm-content' : '.server-settings-content';
    const oldRoot=page.querySelector(rootSelector), newRoot=remotePage.querySelector(rootSelector);
    if (!oldRoot || !newRoot) return false;
    const oldContent=oldRoot.querySelector(contentSelector), newContent=newRoot.querySelector(contentSelector);
    const oldNav=oldRoot.querySelector(navSelector), newNav=newRoot.querySelector(navSelector);
    if (!oldContent || !newContent || !oldNav || !newNav) return false;
    // Keep expanded tree DOM, but reconcile newly created/removed top-level
    // My Files roots. Do not replace the whole sidebar on each navigation.
    if(incoming==='/Settings'){
      const currentDock=oldNav.querySelector('.yrm-profile-dock');
      const freshDock=newNav.querySelector('.yrm-profile-dock');
      if(currentDock&&freshDock)currentDock.replaceWith(document.importNode(freshDock,true));
      const currentDialog=oldNav.querySelector('#yrm-profile-photo-dialog');
      const freshDialog=newNav.querySelector('#yrm-profile-photo-dialog');
      if(currentDialog&&freshDialog)currentDialog.replaceWith(document.importNode(freshDialog,true));
    }
    if(incoming==='/Files'){
      // File preview, bulk actions and uploads read the live directory path
      // from this surviving root; never leave it at the previous folder.
      oldRoot.dataset.filesCurrentPath = newRoot.dataset.filesCurrentPath;
      const oldFolders=oldNav.querySelector('#yrm-my-files-children');
      const freshFolders=newNav.querySelector('#yrm-my-files-children');
      if(oldFolders&&freshFolders){
        const oldByRoute=new Map(Array.from(oldFolders.querySelectorAll(':scope > a'),
          node=>[linkRoute(node),node]));
        const ordered=Array.from(freshFolders.querySelectorAll(':scope > a[href]'),node=>
          oldByRoute.get(linkRoute(node))||document.importNode(node,true));
        if (ordered.length !== oldFolders.children.length ||
            ordered.some((node,index)=>oldFolders.children[index]!==node))
          oldFolders.replaceChildren(...ordered);
      }
      const oldQuick=oldNav.querySelector('.yrm-b10-quick-links');
      const freshQuick=newNav.querySelector('.yrm-b10-quick-links');
      if(oldQuick&&freshQuick&&oldQuick.textContent!==freshQuick.textContent)
        oldQuick.replaceChildren(...Array.from(freshQuick.childNodes,node=>document.importNode(node,true)));
    }
    const selected=new Set(Array.from(newNav.querySelectorAll('a.is-active'),linkRoute));
    const requestedPath=incoming==='/Files'?new URL(targetUrl,location.origin).searchParams.get('path'):null;
    oldNav.querySelectorAll('a').forEach(link=>{
      const route=linkRoute(link);
      const linkPath=incoming==='/Files'&&route?new URL(route,location.origin).searchParams.get('path'):null;
      link.classList.toggle('is-active',(route!==''&&selected.has(route))||
        (requestedPath!==null&&requestedPath!=='@folders'&&linkPath===requestedPath));
    });
    if (incoming !== '/Files' || !reconcileFilesContent(oldContent,newContent)) {
      const freshContent=document.importNode(newContent,true);
      if (incoming === '/Settings') adoptUnchangedImages(oldContent,freshContent);
      oldContent.replaceWith(freshContent);
    }
    // Replace route-sensitive dialogs and notices, keeping the original sidebar.
    for (const child of Array.from(page.children)) if (child !== oldRoot) child.remove();
    for (const child of Array.from(remotePage.children)) {
      if (child.matches(rootSelector)) continue;
      page.append(document.importNode(child,true));
    }
    return true;
  }
  async function loadPage(url, refresh = false, push = true) {
    const previousRoute = activeUrl;
    const token = ++navigationId;
    const sameWorkspace = !!activeUrl && ["/Files","/Settings"].includes(canonicalPath(url.split("?")[0])) &&
      canonicalPath(activeUrl.split("?")[0]) === canonicalPath(url.split("?")[0]);
    if (!sameWorkspace) appWindow?.classList.add("is-loading");
    try {
      const response = await fetchWorkspacePage(url,refresh);
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
      if (!reconcileWorkspaceView(remotePage,url)) page.replaceChildren(fragment);
      if (canonicalPath(url.split('?')[0]) === '/Files') window.dispatchEvent(new Event('yrm-panel:files-view-updated'));
      harvestNotices(page);
      scanDdnsFailures();
      if (!sameWorkspace) windowScroll.scrollTop = 0;
      setPageShell(false, title);
      renderTabs();
      closePopup(launcher, launcherButton);
      if (push) history.pushState({yrmPanelRoute:url,yrmPrevRoute:previousRoute}, "", "/");
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
    if (!refresh && tabs.get(url)?.fragment) {
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
  // Folder labels have no href (no browser status-bar URL); the Files tree
  // navigation module asks the shell to navigate instead.
  window.addEventListener('yrm-panel:navigate', event => {
    const url = typeof event.detail === 'string' ? internalUrl(event.detail) : null;
    if (url) void openPage(url);
  });
  document.addEventListener("click", (event) => {
    const guardedEl = event.target instanceof Element ? event.target.closest(GUARDED_LINKS) : null;
    if (guardedEl && event.button === 0) {
      event.preventDefault();
      activateGuardedLink(guardedEl);
      return;
    }
    // data-panel-route replaces href on in-app links so the browser never previews a URL
    const panelRouteEl = event.target instanceof Element ? event.target.closest('[data-panel-route]') : null;
    if (panelRouteEl && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const url = internalUrl(panelRouteEl.dataset.panelRoute);
      if (url) {
        event.preventDefault();
        void openPage(url, {refresh: url === activeUrl});
        return;
      }
    }
    const navItem = event.target instanceof Element ? event.target.closest("[data-fm-href]") : null;
    if (navItem && !navItem.matches('[data-fm-inline-folder],[data-fm-tree-folder],[data-my-files-toggle]')) {
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        const url = internalUrl(navItem.dataset.fmHref);
        if (url) {
          event.preventDefault();
          const refresh = url === activeUrl && !!navItem.closest("#window-page");
          if (refresh && url.startsWith('/Files')) filesPageCache.clear();
          void openPage(url, {refresh});
          return;
        }
      }
    }
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
    if (refresh && url.startsWith('/Files')) filesPageCache.clear();
    void openPage(url, {refresh});
  });
  document.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest('[data-fm-history-back]'):null;
    if(!button)return;
    event.preventDefault();
    const previous=history.state?.yrmPrevRoute;
    if(typeof previous==='string'&&canonicalPath(previous.split('?')[0])==='/Files'){
      history.back();
    }else if(activeUrl?.startsWith('/Files')){
      void openPage('/Files?path=%40folders');
    }
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
    if (form.hasAttribute('data-bulk-download-form')) return;
    if (form.method.toLowerCase() !== "post" || !activeUrl || !form.reportValidity()) return;
    const action = new URL(form.action, location.href);
    if (action.origin !== location.origin || !internalUrl(action.href)) return;

    // Optimistic wallpaper history: apply immediately from the thumbnail src,
    // then POST silently in the background — no page reload needed.
    if (action.searchParams.get('handler') === 'RestoreWallpaperHistory') {
      event.preventDefault();
      const btn = form.querySelector('button.yrm-wallpaper-recent-item');
      const img = btn?.querySelector('img');
      if (img?.src) {
        // Apply the thumbnail URL immediately as the wallpaper preview.
        const previewEl = document.getElementById('wallpaper-preview');
        if (previewEl) previewEl.src = img.src;
        // Update the CSS variable so the desktop background changes instantly.
        document.documentElement.style.setProperty('--wallpaper-image', `url("${img.src}")`);
        // Highlight selected thumbnail.
        document.querySelectorAll('.yrm-wallpaper-recent-item').forEach(el => el.classList.remove('is-selected'));
        btn.classList.add('is-selected');
      }
      // Fire-and-forget POST to persist the change server-side.
      try {
        await fetch(action.href, {
          method:'POST', body:new FormData(form),
          credentials:'same-origin', headers:{'Accept':'text/html'}, redirect:'follow'
        });
      } catch { /* non-critical — the visual change is already applied */ }
      return;
    }

    event.preventDefault();
    // Confirmation is handled once by v1-confirm.js before sudo authorization.
    if (actionPending) return; // Avoid overlapping state-changing POST requests from this shell.
    actionPending = true;
    filesPageCache.clear();
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
      if (!reconcileWorkspaceView(remotePage,targetUrl)) page.replaceChildren(fragment);
      if (canonicalPath(submittedUrl.split('?')[0]) === '/Files') {
        window.dispatchEvent(new Event('yrm-panel:files-data-changed'));
        window.dispatchEvent(new Event('yrm-panel:files-view-updated'));
      }
      harvestNotices(page);
      scanDdnsFailures();
      // Refresh Files on next opening after any disk mount-state change.
      if (canonicalPath(submittedUrl.split("?")[0]) === "/Settings" &&
          /^(Mount|Unmount|InitializeDisk|CompleteDisk)$/.test(action.searchParams.get("handler") || "")) {
        for (const [url, tab] of tabs) {
          if (canonicalPath(url.split("?")[0]) === "/Files") tab.fragment = null;
        }
      }
      if (canonicalPath(submittedUrl.split("?")[0]) === "/Applications") {
        desktopNeedsRefresh = true;
        void loadTaskbarPins();
      }
      if (canonicalPath(submittedUrl.split('?')[0]) !== '/Files') windowScroll.scrollTop = 0;
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
  // Metrics are rendered from the single shared channel (SSE with a polling
  // fallback). panel.js must not start its own interval or EventSource.
  if (window.YrmMetrics) window.YrmMetrics.subscribe(applySnapshot);
  startLinkGuard();
  // The wallpaper layer is sized from the physical screen, not the viewport, so a
  // docked developer-tools panel or a resized browser only crops it (it never
  // rescales or shifts). CSS falls back to the viewport until this runs.
  function syncWallpaperBox() {
    const style = document.documentElement.style;
    style.setProperty('--yrm-screen-w', `${Math.max(screen.width || 0, innerWidth)}px`);
    style.setProperty('--yrm-screen-h', `${Math.max(screen.height || 0, innerHeight)}px`);
  }
  syncWallpaperBox();
  window.addEventListener('resize', syncWallpaperBox);
})();
