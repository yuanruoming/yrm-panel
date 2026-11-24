// Real-browser end-to-end checks against a running YRM Panel (real PAM login,
// real Linux filesystem). Behaviour only: nothing here inspects source text.
// Required environment: E2E_URL, E2E_USER, E2E_PASS, E2E_FIXTURE.
import { chromium, request as pwRequest } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_URL;
const USER = process.env.E2E_USER;
const PASS = process.env.E2E_PASS;
const FIXTURE = process.env.E2E_FIXTURE;
if (!BASE || !USER || !PASS || !FIXTURE) throw new Error('E2E_URL, E2E_USER, E2E_PASS and E2E_FIXTURE are required.');
const FIXTURE_REL = FIXTURE.replace(/^\/+/, '');
const OUT = path.resolve('out');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
let page;
async function check(name, action) {
  try { await action(); console.log('PASS:', name); }
  catch (error) {
    failures.push(name);
    console.log('FAIL:', name, '\n      ', String(error?.message ?? error).split('\n')[0]);
    try { await page?.screenshot({ path: path.join(OUT, name.replace(/\W+/g, '_') + '.png') }); } catch { /* best effort */ }
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (predicate, message, timeout = 8000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > end) throw new Error('Timed out: ' + message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
page = await context.newPage();
page.setDefaultTimeout(10000);   // fail quickly; CI runners are fast enough
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

// ---------- Login page must never rate-limit viewing --------------------
const anonymous = await pwRequest.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
await check('login page can be viewed repeatedly without 429', async () => {
  for (let i = 0; i < 14; i++) {
    const response = await anonymous.get('/Account/Login');
    assert(response.status() === 200, `GET #${i + 1} returned ${response.status()}`);
  }
});

// ---------- Login -------------------------------------------------------
await check('login page shows the neutral address and the plain panel title', async () => {
  await page.goto(BASE + '/Account/Login');
  await until(async () => new URL(page.url()).pathname === '/', 'address bar shows / instead of /Account/Login');
  assert(await page.title() === 'YRM PANEL', 'title was ' + await page.title());
  assert(await page.locator('form.login-form-v2 input[name="__RequestVerificationToken"]').count() === 1,
    'the login form has no antiforgery token, so every sign-in would be rejected');
});
await check('wrong password is rejected with a visible error', async () => {
  await page.goto(BASE + '/Account/Login');
  await page.fill('#username', USER);
  await page.fill('#password', 'definitely-wrong-password');
  await page.click('button.login-submit');
  await page.waitForSelector('.notice.error', { timeout: 15000 });
});
await check('real Linux (PAM) login succeeds and shows the desktop shell', async () => {
  await page.goto(BASE + '/Account/Login');
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button.login-submit');
  await page.waitForSelector('body.os-shell', { timeout: 20000 });
});

if (failures.includes('real Linux (PAM) login succeeds and shows the desktop shell')) {
  // Nothing after this can work without a session; stop instead of waiting for timeouts.
  await browser.close();
  console.log(`\nStopped early: sign-in failed.\n - ${failures.join('\n - ')}`);
  process.exit(1);
}

// ---------- Open Files from the launcher (the way a user does) ----------
await check('Files opens from the launcher and lists My Files', async () => {
  await page.click('#launcher-toggle');
  await page.locator('.launcher-app', { hasText: 'Files' }).first().click();
  await page.waitForSelector('.fm-explorer', { timeout: 15000 });
  await page.locator('a[data-fm-inline-folder]', { hasText: 'e2e-fixture' }).first()
    .waitFor({ timeout: 15000 });
});

const rowFor = name => page.locator(`tr[data-b10-file-row][data-b10-filename="${name}"]`);

await check('double-click enters a folder without a browser page reload', async () => {
  await page.evaluate(() => { window.__yrmE2eMarker = 'alive'; });
  await page.locator('a[data-fm-inline-folder]', { hasText: 'e2e-fixture' }).first().dblclick();
  await rowFor('alpha').waitFor({ timeout: 15000 });
  assert(await page.evaluate(() => window.__yrmE2eMarker) === 'alive',
    'the document was reloaded during folder navigation');
});

await check('single-click selects a folder and does not navigate', async () => {
  await rowFor('alpha').locator('a.fm-folder-entry').click();
  await until(async () => (await rowFor('alpha').getAttribute('aria-selected')) === 'true', 'row becomes selected');
  await page.waitForTimeout(600);   // longer than any click-delay navigation
  assert(await rowFor('notes.txt').count() === 1, 'still inside the fixture folder after a single click');
  assert(await rowFor('inner.txt').count() === 0, 'single click must not enter the folder');
});

await check('chevron expands and collapses a folder in place', async () => {
  const button = rowFor('beta').locator('button[data-fm-expand]');
  await button.click();
  await until(async () => (await button.getAttribute('aria-expanded')) === 'true', 'chevron reports expanded');
  await page.getByText('inner-folder').first().waitFor({ timeout: 8000 });
  assert(await rowFor('notes.txt').count() === 1, 'expanding must not navigate away');
  await button.click();
  await until(async () => (await button.getAttribute('aria-expanded')) === 'false', 'chevron reports collapsed');
});

await check('large folder lists the alphabetically first 1000 rows', async () => {
  await page.evaluate(() => { window.__yrmE2eMarker = 'alive'; });
  await rowFor('many').locator('a.fm-folder-entry').dblclick();
  await rowFor('f0000.txt').waitFor({ timeout: 20000 });
  const names = await page.locator('tr[data-b10-file-row]').evaluateAll(
    rows => rows.map(row => row.getAttribute('data-b10-filename')));
  assert(names.length === 1000, `expected 1000 rows, got ${names.length}`);
  assert(names[0] === 'f0000.txt' && names[999] === 'f0999.txt', 'rows are not the first 1000 in order');
});

// ---------- Layout: windows fit their content area, no stray scrollbars --
await check('My Files sidebar never shows a horizontal scrollbar, even for very long folder names', async () => {
  await page.goto(BASE + '/Files?path=' + encodeURIComponent(FIXTURE_REL));
  await page.waitForSelector('.fm-explorer');
  const m = await page.evaluate(() => {
    const box = document.getElementById('yrm-my-files-children');
    box.hidden = false;
    for (let i = 0; i < 3; i++) {
      const link = document.createElement('a');
      link.className = 'fm-location-link fm-location-child';
      link.innerHTML = '<svg class="ui-icon"><use href="#i-folder"/></svg><span></span>';
      link.querySelector('span').textContent = 'a-very-long-folder-name-'.repeat(8) + i;
      box.append(link);
    }
    return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth, overflowX: getComputedStyle(box).overflowX };
  });
  assert(m.overflowX !== 'auto' && m.overflowX !== 'scroll', 'sidebar folder list may scroll sideways (overflow-x: ' + m.overflowX + ')');
  assert(m.scrollWidth <= m.clientWidth, `sidebar folder list is wider than its box (${m.scrollWidth} > ${m.clientWidth})`);
});
for (const tab of ['overview', 'network', 'appearance', 'about']) {
  await check(`Settings ${tab} tab fits its window: sidebar pinned, no outer scrollbar`, async () => {
    await page.goto(BASE + '/Settings?tab=' + tab);
    await page.waitForSelector('.server-settings-layout');
    await new Promise(resolve => setTimeout(resolve, 300));
    const m = await page.evaluate(() => {
      const scroller = document.getElementById('window-scroll');
      const pane = document.getElementById('window-page');
      const nav = document.querySelector('.server-settings-nav');
      return {
        scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
        pageHeight: pane.getBoundingClientRect().height, navHeight: nav.getBoundingClientRect().height
      };
    });
    assert(m.scrollHeight <= m.clientHeight + 1, `outer window scrolls (${m.scrollHeight} > ${m.clientHeight})`);
    assert(Math.abs(m.navHeight - m.pageHeight) <= 1, `sidebar is not pinned to the window height (${m.navHeight} vs ${m.pageHeight})`);
  });
}

// ---------- No URL previews, stable wallpaper and window, filled cards -----
// Emulates a docked DevTools panel: the viewport shrinks, the physical screen does not.
// (page.setViewportSize would shrink window.screen too, which real DevTools never does.)
let devtoolsSession = null;
async function dockDevtools(width, height) {
  devtoolsSession ??= await context.newCDPSession(page);
  await devtoolsSession.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
}
await check('Settings sidebar keeps the active section highlighted across guarded navigation', async () => {
  await page.goto(BASE + '/Settings?tab=overview');
  await page.waitForSelector('.server-settings-layout');
  for (const tab of ['network', 'overview']) {
    await page.locator(`.settings-nav-link[data-panel-route*="tab=${tab}"]`).first().click();
    await page.waitForFunction(t => document.querySelector('.settings-nav-link.is-active')?.dataset.panelRoute?.includes('tab=' + t), tab);
  }
});
for (const route of ['/', '/Files?path=' + encodeURIComponent(FIXTURE_REL), '/Settings?tab=overview', '/Settings?tab=about']) {
  await check(`no link on ${route.split('?')[0]} can show a URL preview (even ones added later)`, async () => {
    await page.goto(BASE + route);
    await page.waitForSelector('body.os-shell');
    await new Promise(resolve => setTimeout(resolve, 300));
    const m = await page.evaluate(async () => {
      const inApp = document.createElement('a'); inApp.href = '/Settings?tab=network'; inApp.textContent = 'x';
      const file = document.createElement('a'); file.href = '/Files?handler=Download&path=x'; file.setAttribute('download', ''); file.textContent = 'y';
      document.body.append(inApp, file);
      await new Promise(resolve => setTimeout(resolve, 50));
      const added = { inApp: inApp.hasAttribute('href'), file: file.hasAttribute('href'),
        route: inApp.dataset.panelRoute, download: file.dataset.yrmDownload };
      inApp.remove(); file.remove();
      return { added, left: Array.from(document.querySelectorAll('a[href]'), a => a.outerHTML.slice(0, 90)) };
    });
    assert(!m.added.inApp && !m.added.file, 'a dynamically added link kept its href');
    assert(m.added.route === '/Settings?tab=network' && m.added.download, 'the link target was not kept for the click handler');
    assert(m.left.length === 0, 'links with a real href remain: ' + m.left.join(' | '));
  });
}
await check('wallpaper layer does not move or rescale when the viewport shrinks (DevTools)', async () => {
  await page.goto(BASE + '/');
  await page.waitForSelector('.desktop-background', { state: 'attached' });
  const box = () => page.evaluate(() => { const r = document.querySelector('.desktop-background').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const before = await box();
  await dockDevtools(1000, 600);
  await new Promise(resolve => setTimeout(resolve, 200));
  const during = await box();
  await dockDevtools(1440, 900);
  for (const key of Object.keys(before)) assert(Math.abs(before[key] - during[key]) <= 1, `wallpaper ${key} changed: ${before[key]} -> ${during[key]}`);
});
await check('desktop window keeps its position and size when the viewport shrinks (DevTools)', async () => {
  await page.goto(BASE + '/Settings?tab=overview');
  await page.waitForSelector('.server-settings-layout');
  await new Promise(resolve => setTimeout(resolve, 300));
  const rect = () => page.evaluate(() => { const r = document.getElementById('workspace-window').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const before = await rect();
  await dockDevtools(1100, 700);
  await new Promise(resolve => setTimeout(resolve, 200));
  const during = await rect();
  await dockDevtools(1440, 900);
  await new Promise(resolve => setTimeout(resolve, 200));
  const after = await rect();
  for (const key of Object.keys(before)) {
    assert(Math.abs(before[key] - during[key]) <= 1, `window ${key} moved while the viewport was smaller: ${before[key]} -> ${during[key]}`);
    assert(Math.abs(before[key] - after[key]) <= 1, `window ${key} did not return: ${before[key]} -> ${after[key]}`);
  }
});
await check('Network cards fill the window and do not scroll for a single adapter', async () => {
  await page.goto(BASE + '/Settings?tab=network');
  await page.waitForSelector('.server-settings-layout');
  await new Promise(resolve => setTimeout(resolve, 300));
  const m = await page.evaluate(() => {
    const content = document.querySelector('.server-settings-content');
    const layout = document.querySelector('.yrm-network-layout');
    if (!content || !layout) return null;
    const cs = getComputedStyle(content);
    const innerBottom = content.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom);
    const last = layout.lastElementChild;
    return { interfaces: layout.querySelectorAll('.yrm-network-interface').length,
      scroll: content.scrollHeight - content.clientHeight, gap: innerBottom - last.getBoundingClientRect().bottom };
  });
  if (!m || m.interfaces !== 1) return; // nothing, or several adapters (which may legitimately scroll)
  assert(m.scroll <= 1, `content scrolls by ${m.scroll}px`);
  assert(m.gap <= 24, `cards leave ${Math.round(m.gap)}px unused below them`);
});

// ---------- No tooltips, viewport-independent content, no pointless Update Now ----
for (const route of ['/', '/Files?path=' + encodeURIComponent(FIXTURE_REL), '/Settings?tab=overview', '/Settings?tab=network', '/Settings?tab=appearance', '/Settings?tab=about']) {
  await check(`${route.split('?')[0]}${route.includes('tab=') ? ' ' + route.split('tab=')[1] : ''} has no hover tooltips (title attributes)`, async () => {
    await page.goto(BASE + route);
    await page.waitForSelector('body.os-shell');
    await new Promise(resolve => setTimeout(resolve, 300));
    const found = await page.evaluate(() => Array.from(document.querySelectorAll('[title]'))
      .filter(el => el.tagName !== 'IFRAME' && !(el instanceof SVGElement)).map(el => el.outerHTML.slice(0, 100)));
    assert(found.length === 0, 'elements still carry a title: ' + found.join(' | '));
  });
}
await check('Settings > About does not offer a disabled Update Now button', async () => {
  await page.goto(BASE + '/Settings?tab=about');
  await page.waitForSelector('.server-settings-layout');
  const disabled = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .filter(b => b.textContent.trim() === 'Update Now' && b.disabled).length);
  assert(disabled === 0, 'a disabled Update Now button is rendered');
});
await check('Appearance wallpaper preview keeps its size when the viewport gets shorter (DevTools)', async () => {
  await page.goto(BASE + '/Settings?tab=appearance');
  await page.waitForSelector('#wallpaper-preview');
  await new Promise(resolve => setTimeout(resolve, 300));
  const height = () => page.evaluate(() => document.getElementById('wallpaper-preview').getBoundingClientRect().height);
  const before = await height();
  await dockDevtools(1440, 600);
  await new Promise(resolve => setTimeout(resolve, 200));
  const during = await height();
  await dockDevtools(1440, 900);
  assert(Math.abs(before - during) <= 1, `preview height changed: ${before} -> ${during}`);
});
await check('My Files list is capped by the window height and scrolls inside itself', async () => {
  await page.goto(BASE + '/Files?path=' + encodeURIComponent(FIXTURE_REL));
  await page.waitForSelector('.fm-explorer');
  const m = await page.evaluate(() => {
    const box = document.getElementById('yrm-my-files-children');
    box.hidden = false;
    for (let i = 0; i < 80; i++) {
      const link = document.createElement('a');
      link.className = 'fm-location-link fm-location-child';
      link.innerHTML = '<svg class="ui-icon"><use href="#i-folder"/></svg><span></span>';
      link.querySelector('span').textContent = 'folder-' + i;
      box.append(link);
    }
    return { height: box.clientHeight, scrolls: box.scrollHeight > box.clientHeight + 1,
      windowHeight: document.getElementById('window-scroll').clientHeight };
  });
  assert(m.scrolls, 'a long folder list does not scroll inside the sidebar');
  assert(m.height <= m.windowHeight * 0.45 + 1 && m.height <= 401, `folder list is ${m.height}px in a ${m.windowHeight}px window`);
});

// ---------- HTTP behaviour with the logged-in session -------------------
await page.goto(BASE + '/Files?path=' + encodeURIComponent(FIXTURE_REL));
await page.waitForSelector('.fm-explorer');
const token = await page.evaluate(() => document.querySelector('input[name="__RequestVerificationToken"]')?.value ?? '');
const api = context.request;
const q = (handler, extra = {}) => `/Files?${new URLSearchParams({ handler, path: FIXTURE_REL, ...extra })}`;

await check('image preview returns the correct media type', async () => {
  const response = await api.get(BASE + q('Preview', { name: 'pic.png' }));
  assert(response.status() === 200, 'status ' + response.status());
  assert((response.headers()['content-type'] ?? '').startsWith('image/png'), 'content-type ' + response.headers()['content-type']);
});
await check('text preview supports a byte range', async () => {
  const response = await api.get(BASE + q('Preview', { name: 'notes.txt' }), { headers: { Range: 'bytes=0-4' } });
  assert(response.status() === 206, 'expected 206, got ' + response.status());
  assert((await response.text()) === 'hello', 'range body mismatch');
});
await check('file download returns the exact bytes', async () => {
  const response = await api.get(BASE + q('Download', { name: 'notes.txt' }));
  assert(response.status() === 200 && (await response.text()) === 'hello notes', 'download mismatch');
});
await check('Tree listing returns sub-folders and the names of the files', async () => {
  const response = await api.get(BASE + q('Tree'));
  assert(response.status() === 200, 'status ' + response.status());
  const data = await response.json();
  assert(Array.isArray(data.folders) && Array.isArray(data.files), 'folders/files arrays missing');
  assert(data.files.includes('notes.txt') && data.files.includes('pic.png'), 'files missing: ' + data.files.join(','));
});
await check('ZIP download streams a valid archive with folders preserved', async () => {
  assert(token, 'no antiforgery token on the Files page');
  const body = new URLSearchParams();
  body.append('names', 'notes.txt'); body.append('names', 'alpha');
  body.append('__RequestVerificationToken', token);
  const response = await api.post(BASE + q('BulkDownload'), {
    data: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert(response.status() === 200, 'status ' + response.status());
  assert((response.headers()['content-type'] ?? '').includes('application/zip'), 'content-type ' + response.headers()['content-type']);
  const bytes = await response.body();
  const text = bytes.toString('latin1');
  assert(bytes.subarray(0, 2).toString() === 'PK', 'not a ZIP');
  assert(text.includes('notes.txt') && text.includes('alpha/inner.txt'), 'ZIP entries missing');
});
await check('upload writes the file to the folder as the Linux user', async () => {
  const response = await api.post(BASE + q('Upload'), {
    headers: { Accept: 'application/json' },
    multipart: {
      upload: { name: 'e2e-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded body') },
      __RequestVerificationToken: token
    }
  });
  assert(response.status() === 200, `status ${response.status()}`);
  assert((await response.json()).ok === true, 'upload did not report ok');
  assert(fs.readFileSync(path.join(FIXTURE, 'e2e-upload.txt'), 'utf8') === 'uploaded body', 'uploaded content mismatch');
});
await check('unauthenticated API and file requests are refused', async () => {
  for (const url of ['/api/metrics', q('Download', { name: 'notes.txt' })]) {
    const response = await anonymous.get(url, { maxRedirects: 0 });
    assert([301, 302, 401].includes(response.status()), `${url} returned ${response.status()}`);
  }
});
await check('metrics API answers for the signed-in session', async () => {
  const response = await api.get(BASE + '/api/metrics');
  assert(response.status() === 200, 'status ' + response.status());
});
await check('no uncaught JavaScript errors occurred in the shell', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '));
});

// ---------- Password submissions are still rate-limited (run last) ------
await check('repeated password submissions are rate-limited, but viewing is not', async () => {
  let limited = false;
  for (let i = 0; i < 10; i++) {
    const response = await anonymous.post('/Account/Login', { form: { Username: USER, Password: 'x' + i } });
    if (response.status() === 429) { limited = true; break; }
  }
  assert(limited, 'no 429 after 10 POSTs');
  const view = await anonymous.get('/Account/Login');
  assert(view.status() === 200, 'login page view returned ' + view.status() + ' while POSTs are limited');
});

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} end-to-end check(s) failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed.');
