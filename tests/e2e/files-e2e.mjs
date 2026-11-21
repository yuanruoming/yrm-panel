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
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
page = await context.newPage();
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
  await Promise.all([
    page.waitForURL(url => !url.pathname.includes('/Account/Login'), { timeout: 20000 }),
    page.click('button.login-submit')
  ]);
  await page.waitForSelector('body.os-shell', { timeout: 15000 });
});

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
