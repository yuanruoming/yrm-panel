"""Regression contracts for the final v1 usability pass.
These are source-level checks only; .NET build and Ubuntu VM are separate acceptance steps.
"""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]

def source(name):return (ROOT/name).read_text(encoding='utf-8')

class LoginTests(unittest.TestCase):
    def test_explicit_remember_me_is_opt_out_and_ticket_expires(self):
        view=source('YrmPanel/Pages/Account/Login.cshtml')
        model=source('YrmPanel/Pages/Account/Login.cshtml.cs')
        self.assertIn('name="RememberMe" value="true"',view)
        self.assertIn('name="RememberMe" value="false"',view)
        self.assertIn('IsPersistent = RememberMe',model)
        self.assertIn('DateTimeOffset.UtcNow.AddDays(30)',model)
        self.assertNotIn('localStorage.setItem("password"',view)
    def test_cache_version_only_and_private(self):
        program=source('YrmPanel/Program.cs')
        self.assertIn('context.Request.Query["v"]',program)
        self.assertIn('private, max-age=31536000, immutable',program)
        self.assertIn('private, no-cache',program)
        self.assertIn('}).RequireAuthorization();',program)
    def test_preload_and_both_branding_surfaces(self):
        shell=source('YrmPanel/Pages/Shared/_Layout.cshtml')
        login=source('YrmPanel/Pages/Account/Login.cshtml')
        self.assertIn('rel="preload" as="image"',shell)
        self.assertNotIn('yrm-topmark',shell)  # Topbar starts with Launcher / Home; logo remains in login and About.
        self.assertIn('yrm-panel-mark.png',login)
        self.assertIn('favicon.ico',shell)
        self.assertIn('favicon.ico',login)
        for path in ['YrmPanel/wwwroot/favicon.ico','YrmPanel/wwwroot/images/yrm-panel-mark.png']:
            self.assertTrue((ROOT/path).is_file())

class LayoutTests(unittest.TestCase):
    def test_security_tabs_show_only_selected_subpage(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        model=source('YrmPanel/Pages/Settings.cshtml.cs')
        self.assertIn('Model.SecuritySection == "firewall"',view)
        self.assertIn('asp-route-section="certificates"',view)
        self.assertIn('public string SecuritySection',model)
        self.assertIn('section = "certificates"',model)
        self.assertIn('section = "firewall"',model)
        self.assertEqual(view.count('{'),view.count('}'))
    def test_ddns_new_profile_collapsed(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('<details class="v1-new-provider">',view)
        self.assertIn('<summary class="button button-secondary">+ New Provider</summary>',view)
    def test_files_nav_and_storage_selection(self):
        view=source('YrmPanel/Pages/Files.cshtml')
        model=source('YrmPanel/Pages/Files.cshtml.cs')
        js=source('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn('data-persist-disclosure',view)
        self.assertNotIn('open="@(!Model.IsMyFolders)"',view)
        self.assertIn('id="yrm-folder-volume"',view)
        self.assertIn('MountedVolumes',model)
        self.assertIn('sessionStorage.setItem(fileNavKey',js)
    def test_disk_rows_identified_by_actual_parent_device(self):
        service=source('YrmPanel/Services/StorageDeviceService.cs')
        view=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('string ParentPath = ""',service)
        self.assertIn('Collect(child, devices, Field(item, "name"))',service)
        self.assertIn('x.ParentPath == disk.Path',view)
        self.assertIn('No filesystem detected',view)
        self.assertIn('YRM PANEL does not format disks.',view)
    def test_last_route_only_explicitly_allowed_pages(self):
        js=source('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn('const allowed = /^\\/(?:Files|Settings|Docker|Applications|Features|Shares|Services)',js)
        self.assertIn('sessionStorage.setItem(key, route)',js)
        self.assertIn('last && allowed.test(last)',js)

if __name__=='__main__':unittest.main()
