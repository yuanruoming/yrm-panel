from pathlib import Path
import shutil
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('[SKIP] Install Python Playwright to run browser interaction smoke.')
    raise SystemExit(0)
ROOT=Path(__file__).resolve().parents[1]
js=(ROOT/'YrmPanel/wwwroot/js/panel.js').read_text(encoding='utf-8')
html='''<!doctype html><html><head><base href="https://yrm.test/"></head><body class="os-shell is-desktop" data-initial-page="/Index" data-initial-title="Desktop">
<div id="desktop-main"></div><nav id="app-taskbar"><button id="taskbar-home">Home</button><div id="taskbar-tabs"></div></nav>
<div id="app-launcher"><div class="launcher-grid"><a class="launcher-app" href="/Applications">Apps</a><a class="launcher-app" href="/Docker">Docker</a><a class="launcher-app" href="/Files">Files</a></div><div class="launcher-grid"><a class="launcher-app" href="/Settings">Settings</a></div></div>
<button id="launcher-toggle">Toggle</button><button id="profile-toggle">Profile</button><div id="profile-menu" hidden></div>
<div id="workspace-stage"><div id="workspace-window"><div id="window-page"></div><div id="window-scroll"></div></div></div>
<button id="monitor-pin"></button><div id="pinned-monitor"></div><div id="monitor-drawer"></div><div id="toast-host"></div>
</body></html>'''
errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or shutil.which('chromium-browser') or None)
 page=browser.new_page()
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html)
 page.evaluate("""() => {
   const change = history.replaceState.bind(history);
   history.replaceState = (state,title,url) => change(state,title);
   const push = history.pushState.bind(history);
   history.pushState = (state,title,url) => push(state,title);
 }""")
 page.evaluate('''() => {
 window.__pins = ['/Files'];
 window.fetch = async (url, options={})=>{
   if (String(url).includes('handler=TaskbarPins')) return new Response(JSON.stringify({pins:window.__pins, shortcuts:[],token:'test_token'}),{status:200,headers:{'Content-Type':'application/json'}});
   if (String(url).includes('handler=TaskbarPin')) {
     const body = new URLSearchParams(options.body);
     const id=body.get('id');
     if (body.get('pinned')==='true' && !window.__pins.includes(id)) window.__pins.push(id);
     if (body.get('pinned')!=='true') window.__pins=window.__pins.filter(p=>p!==id);
     return new Response(JSON.stringify({ok:true}),{status:200});
   }
   return new Response('',{status:503});
 };
 }''')
 page.add_script_tag(content=js)
 page.locator('.taskbar-pin-app[data-taskbar-id="/Files"]').wait_for(timeout=5000)
 assert page.locator('.taskbar-pin-app[data-taskbar-id="/Files"]').inner_text().strip()=='Files', 'Pinned taskbar app must show its name'
 assert page.locator('.taskbar-tab-close').count()==0, 'No always-visible close buttons'
 print('initial pins',page.locator('.taskbar-pin-app').count())
 page.locator('[data-taskbar-app="/Docker"]').click()
 page.locator('.taskbar-pin-app[data-taskbar-id="/Docker"]').wait_for(timeout=5000)
 print('pins after add',page.locator('.taskbar-pin-app').count())
 page.locator('.taskbar-pin-app[data-taskbar-id="/Docker"]').click(button='right')
 page.get_by_role('button', name='Unpin from Taskbar').click()
 page.locator('.taskbar-pin-app[data-taskbar-id="/Docker"]').wait_for(state='detached',timeout=5000)
 print('pins after remove',page.locator('.taskbar-pin-app').count())
 print('JS errors',errors)
 browser.close()
if errors: raise SystemExit(1)
