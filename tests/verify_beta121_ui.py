from pathlib import Path
import os, shutil
from playwright.sync_api import sync_playwright
W=Path(__file__).resolve().parents[1]
html='''<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#101925;color:white;font:13px system-ui}.os-topbar{position:fixed;top:0;height:49px;left:0;right:0;display:flex;justify-content:space-between;align-items:center;background:#202630;z-index:65}.os-top-right{display:flex;align-items:center;gap:10px;padding-right:10px}.os-topbar #app-taskbar{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.os-topbar #taskbar-home{width:45px;height:35px;flex:none}.os-topbar #taskbar-tabs{display:flex;align-items:center;gap:5px;flex:1;min-width:0}.os-topbar #launcher-toggle{flex:none;width:45px;height:35px}.taskbar-pin-app{flex:none}.workspace-stage{padding-top:69px}.workspace-window{height:650px;background:#202833;border:1px solid #446;display:flex;flex-direction:column;overflow:hidden}.window-titlebar{display:flex;height:48px;justify-content:space-between;align-items:center;background:#293342}.window-scroll{flex:1;overflow:auto}.is-minimized{display:none}button{cursor:pointer} .yrm-b11-provider-cell{vertical-align:middle}.yrm-b11-ddns-table{border-collapse:collapse;width:100%}.yrm-b11-ddns-table td,.yrm-b11-ddns-table th{border-bottom:1px solid #3c4d5b;padding:8px}.yrm-b11-ddns-table .yrm-b9-ddns-feedback{display:none}.explorer-table{width:100%}.explorer-table tr.is-selected{background:#354b66}.explorer-toolbar{padding:12px;display:flex;gap:7px}.panel-modal{border:1px solid #567;color:white;background:#203047}.panel-modal-actions{display:flex;justify-content:flex-end}
</style></head>
<body class="os-shell has-window" data-initial-title="Settings" data-initial-page="/Settings">
<header class="os-topbar"><button id="launcher-toggle">Apps</button><nav id="app-taskbar"><button id="taskbar-home">Home</button><div id="taskbar-tabs"></div></nav><div class="os-top-right"><span id="clock-text">15:00</span><button id="profile-toggle">Profile</button></div></header>
<nav id="app-launcher" hidden><a class="launcher-app" href="/Settings">Settings</a><a class="launcher-app" href="/Files">Files</a></nav><div id="profile-menu" hidden></div>
<main id="workspace-stage" class="workspace-stage"><section id="workspace-window" class="workspace-window"><div class="window-titlebar"><span id="window-active-title">Settings</span><div class="window-controls"><button id="window-minimize">–</button><button id="window-maximize">□</button><button id="window-close">×</button></div></div><div id="window-scroll" class="window-scroll"><div id="window-page">
<table class="yrm-b11-ddns-table"><tbody><tr class="yrm-b11-ddns-row" data-b9-ddns-provider="dynu" data-b9-ddns-hostname="nas.example.com"><td class="yrm-b11-provider-cell"><strong>Dynu</strong><span data-b9-ddns-status hidden>Failed</span></td><td>nas.example.com</td><td><div data-b9-ddns-record="a" data-b12-ddns-detail><span data-b11-family-state>Failed</span><span data-b9-ddns-error hidden>Failed: badauth (HTTP 200).</span></div></td><td>Off</td><td>20 Nov</td><td><form data-b9-ddns-check action="/Settings?handler=DdnsGroupCheck"><button type="submit">Update Now</button></form></td></tr></tbody></table>
</div></div></section></main>
<aside id="pinned-monitor" hidden>System monitor</aside><aside id="monitor-drawer"><button id="monitor-close">close</button></aside><button id="monitor-pin">pin monitor</button><button id="pinned-unpin">unpin</button>
<div id="toast-host"></div>
</body></html>'''
with sync_playwright() as p:
  executable=os.environ.get('YRM_CHROMIUM') or shutil.which('chromium') or shutil.which('chromium-browser')
  options={'headless':True}
  if executable: options['executable_path']=executable
  browser=p.chromium.launch(**options)
  page=browser.new_page(viewport={'width':1360,'height':900})
  errs=[];page.on('pageerror',lambda e:errs.append(str(e)))

  page.set_content(html)
  page.evaluate('''() => {Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>k==='yrm-panel:pinned-monitor'?'1':null,setItem:()=>{}}}); Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{}}}); history.pushState=()=>{};history.replaceState=()=>{};}''')
  page.evaluate('''
    localStorage.setItem('yrm-panel:pinned-monitor','1');
    window.EventSource = class { constructor(){this.onmessage=null;} };
    window.fetch = async (url,opts) => {
      const u=String(url);
      if (u.includes('TaskbarPins')) return new Response(JSON.stringify({pins:['/Files','/Settings'],shortcuts:[],token:'abc'}),{status:200,headers:{'Content-Type':'application/json'}});
      if (u.includes('DdnsGroupCheck')) return new Response(JSON.stringify({ok:false,message:'badauth (HTTP 200)',records:[{id:'a',status:'Failed: badauth',ipSource:'public',lastRun:'15:05'}]}),{status:200,headers:{'Content-Type':'application/json'}});
      if(u.includes('handler=Tree'))return new Response(JSON.stringify({path:'home/test',absolute:'/home/test',folders:['backup','downloads'],canManage:true}),{status:200,headers:{'Content-Type':'application/json'}});
      if(u.includes('/api/metrics')) return new Response(JSON.stringify({cpuPercent:1,memoryPercent:14}),{status:200,headers:{'Content-Type':'application/json'}});
      return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
    };
  ''')
  page.add_style_tag(path=str(W/'YrmPanel/wwwroot/css/v1-stability.css'))
  panel_js=(W/'YrmPanel/wwwroot/js/panel.js').read_text().replace('new URL(value, location.href)','new URL(value, "http://fixture.local")').replace('url.origin !== location.origin','false').replace('url.origin === location.origin','true').replace('const route = internalUrl(location.href);','const route = internalUrl("/Settings?tab=ddns");')
  page.add_script_tag(content=panel_js)
  page.add_script_tag(path=str(W/'YrmPanel/wwwroot/js/v1-stability.js'))
  page.add_script_tag(path=str(W/'YrmPanel/wwwroot/js/rc4-monitor.js'))
  page.wait_for_timeout(250)
  assert page.locator('#pinned-monitor').evaluate('(e)=>e.hidden'), 'Pinned monitor must be hidden in Settings'
  assert page.locator('.yrm-b11-provider-cell').inner_text().strip()=='Dynu', 'Provider cell must not display error'
  assert page.locator('.yrm-notif-count').inner_text()=='1','Initial DDNS failures must be notifications'
  page.locator('.yrm-notif-trigger').click()
  assert 'badauth' in page.locator('.yrm-notif-list').inner_text()
  assert page.locator('.yrm-notif-count').evaluate('(e)=>e.hidden')
  page.locator('.yrm-notif-trigger').click()
  page.locator('#taskbar-home').click()
  assert not page.locator('#pinned-monitor').evaluate('(e)=>e.hidden'),'Pinned monitor should appear on desktop'
  # Simulate switching to Settings through an already-open tab.
  page.locator('[data-taskbar-id="/Settings"]').first.click()
  page.wait_for_timeout(60)
  assert page.locator('#pinned-monitor').evaluate('(e)=>e.hidden'), 'Monitor must stay hidden when returning to Settings'
  page.locator('#window-maximize').click()
  box=page.locator('#workspace-window').bounding_box()
  assert abs(box['y']-49)<2,box
  assert box['height']>=849,box
  page.locator('#window-maximize').click()
  old=page.locator('#workspace-window').bounding_box()
  tb=page.locator('.window-titlebar').bounding_box()
  page.mouse.move(tb['x']+90,tb['y']+25);page.mouse.down();page.mouse.move(tb['x']+130,tb['y']+50,steps=6);page.mouse.up()
  new=page.locator('#workspace-window').bounding_box()
  assert new['x']>old['x']+15,(old,new)
  # DDNS Update Now never creates a paragraph in provider cell.
  page.locator('[data-b9-ddns-check] button').click();page.wait_for_timeout(200)
  assert not page.locator('.yrm-b11-provider-cell .yrm-b9-ddns-feedback').count()
  # Test file selection and the persistent toolbar with a Files fragment.
  page.evaluate('''() => {document.querySelector('#window-page').innerHTML=`<div class="fm-explorer"><div class="explorer-toolbar fm-compact-toolbar"><button data-open-new-folder>New</button><div id="yrm-b10-file-selection" class="yrm-b10-file-selection"><button data-b10-file-rename disabled>Rename</button><button data-b12-file-copy disabled>Copy To</button><button data-b10-file-move disabled>Move To</button><button data-b10-file-delete disabled>Delete</button></div></div><table class="explorer-table"><tbody><tr data-b10-file-row data-b10-filename="sample.txt"><td class="explorer-name"><button data-open-file="sample.txt">sample.txt</button></td><td><details class="explorer-item-menu"><summary>...</summary><div class="explorer-actions-popover"><button data-copy-item="sample.txt">Copy To...</button><button data-move-item="sample.txt">Move To...</button><button data-rename-item="sample.txt">Rename</button><form data-b10-row-delete><button>Delete</button></form></div></details></td></tr></tbody></table></div><dialog id="file-action-dialog"><div class="panel-modal-head"><strong id="file-action-title">File action</strong></div><form id="file-action-form"><input id="file-action-name"/><div id="yrm-b121-action-input-row"><label id="file-action-label"></label><input id="file-action-value" required></div><div id="yrm-b12-action-picker" hidden><div id="yrm-b12-action-tree"></div><p id="yrm-b12-action-rights"></p></div><div class="panel-modal-actions"><button type="submit">Save</button></div></form></dialog>`;}''')
  row=page.locator('[data-b10-file-row]')
  row.locator('td.explorer-name').click(position={'x':95,'y':12})
  assert 'is-selected' in row.get_attribute('class'),'File click should select row'
  row.locator('[data-open-file]').click()
  assert 'is-selected' in row.get_attribute('class'),'Clicking the filename must preserve selection'
  assert page.locator('#yrm-b10-file-selection').bounding_box() is not None,'Toolbar is fixed, not added on selection'
  assert page.locator('[data-b12-file-copy]').is_enabled()
  page.locator('[data-b12-file-copy]').click()
  assert page.locator('#file-action-title').inner_text().startswith('Copy')
  assert page.locator('#file-action-value').get_attribute('type')=='hidden'
  assert page.locator('#file-action-form button[type="submit"]').inner_text()=='Copy'
  page.keyboard.press('Escape')
  page.locator('[data-b10-file-move]').click()
  assert page.locator('#file-action-form button[type="submit"]').inner_text()=='Move'
  assert page.locator('#file-action-value').get_attribute('type')=='hidden'
  print('PASS browser: monitor visibility, desktop switch, maximize/drag, DDNS notifications, fixed Files toolbar, Copy destination UI')
  if errs: print('JS errors:',errs);raise AssertionError(errs)
  browser.close()
