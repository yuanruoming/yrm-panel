#!/usr/bin/env python3
"""Read-only Playwright UI/screenshot smoke against a disposable YRM Panel VM.

Env: YRM_URL, YRM_TEST_LOGIN, YRM_TEST_PASSWORD.
No clicking destructive buttons, DDNS updates, or firewall saves.
"""
import os
import sys
import ipaddress
from urllib.parse import urlparse
from pathlib import Path

url = os.getenv('YRM_URL', '').rstrip('/')
login = os.getenv('YRM_TEST_LOGIN', '')
password = os.getenv('YRM_TEST_PASSWORD', '')
if not (url and login and password):
    print('[SKIP] Web UI smoke: YRM_URL, YRM_TEST_LOGIN and YRM_TEST_PASSWORD are required.')
    sys.exit(0)
parsed = urlparse(url)
try:
    private_host = parsed.hostname in ('localhost', '127.0.0.1') or \
        ipaddress.ip_address(parsed.hostname or '').is_private
except ValueError:
    private_host = False
if parsed.scheme != 'https' or not private_host:
    print('[FAIL] UI smoke only allows private/local HTTPS test servers.')
    sys.exit(2)

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('[SKIP] pip install playwright && playwright install chromium to enable UI smoke.')
    sys.exit(0)

out = Path('artifacts/ui')
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/Account/Login', wait_until='domcontentloaded', timeout=30000)
    page.locator('#username').fill(login)
    page.locator('#password').fill(password)
    page.locator('button[type=submit]').click()
    page.wait_for_selector('#app-taskbar', timeout=20000)
    page.screenshot(path=str(out/'desktop.png'), full_page=True)

    # Authenticated pages can be opened without mutating state. These checks
    # run in a fresh browser and inspect layout rather than requiring SSH.
    pages = [
        ('files', '/Files', '.fm-explorer'),
        ('ddns', '/Settings?tab=ddns', '.yrm-b11-ddns-table'),
        ('firewall', '/Settings?tab=security&section=firewall', '#v1-firewall-form'),
    ]
    for name, path, selector in pages:
        page.goto(url + path, wait_until='domcontentloaded', timeout=30000)
        page.locator(selector).wait_for(timeout=20000)
        page.screenshot(path=str(out / f'{name}.png'), full_page=True)
        if name == 'ddns':
            for row in page.locator('.yrm-b11-ddns-row').all():
                bounds = row.bounding_box()
                if bounds and bounds['height'] > 155:
                    raise AssertionError(f'DDNS row taller than expected: {bounds["height"]} px')
            for item in page.locator('[data-b9-ddns-error]').all():
                assert item.evaluate('(el) => getComputedStyle(el).display') == 'none', 'DDNS error overflows the table'
        if name == 'files':
            file_rows = page.locator('[data-b10-file-row]')
            if file_rows.count():
                file_rows.first.click(button='right')
                menu = page.locator('body > .explorer-actions-popover')
                menu.wait_for(timeout=3000)
                rect = menu.bounding_box()
                assert rect and rect['x'] >= 0 and rect['x'] + rect['width'] <= 1441, 'Files context menu outside viewport'
                page.keyboard.press('Escape')
    browser.close()
    if errors:
        raise AssertionError('Browser JavaScript errors: ' + '; '.join(errors[:5]))
print('[PASS] Authenticated desktop, Files menu, DDNS row layout and Firewall screenshots')
print(f'UI screenshot directory: {out.resolve()}')
