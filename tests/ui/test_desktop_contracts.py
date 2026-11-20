"""Feature-based checks for desktop, Files, Taskbar, and notification invariants."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

def source(relative):
    return (ROOT / relative).read_text(encoding="utf-8")

class DesktopContracts(unittest.TestCase):
    def test_existing_bundles_are_used_without_beta_overlay(self):
        shell = source("YrmPanel/Pages/Shared/_Layout.cshtml")
        self.assertIn('~/css/v1-stability.css', shell)
        self.assertIn('~/js/v1-stability.js', shell)
        self.assertEqual(shell.count('~/css/v1-stability.css'), 1)
        self.assertEqual(shell.count('~/js/v1-stability.js'), 1)

    def test_monitor_is_accessible_above_window_and_taskbar_above_monitor(self):
        css = source("YrmPanel/wwwroot/css/v1-stability.css")
        self.assertIn('.workspace-stage { z-index: 35', css)
        self.assertIn('.monitor-drawer { z-index: 60', css)
        self.assertIn('.os-topbar { z-index: 65', css)
        self.assertIn('.pinned-monitor { z-index: 24', css)

    def test_files_quick_access_divider_is_not_duplicated(self):
        page = source("YrmPanel/Pages/Files.cshtml")
        self.assertEqual(page.count('<div class="yrm-b10-nav-divider"></div>'), 1)
        self.assertIn('yrm-b10-quick-links', page)

    def test_pinned_app_icon_uses_existing_svg_symbol(self):
        js = source("YrmPanel/wwwroot/js/panel.js")
        self.assertIn('pin.innerHTML=`<svg', js)
        self.assertIn("'#i-pin-off'", js)
        self.assertIn("'#i-pin'", js)
        self.assertIn('pinned.hidden = !pinnedEnabled', js)
        self.assertNotIn('pin.textContent=taskbarPins.includes(id)', js)

    def test_ddns_notification_key_has_kind_provider_domain_family(self):
        shell = source("YrmPanel/wwwroot/js/panel.js")
        settings = source("YrmPanel/wwwroot/js/v1-stability.js")
        self.assertIn("const key=kind==='ddns'", shell)
        self.assertIn('provider,domain,family', shell)
        self.assertIn("family:record.closest('td')?.cellIndex===2?'ipv4':'ipv6'", shell)
        self.assertIn('failures.push({', settings)
        self.assertIn('family:failure.family', settings)

if __name__ == "__main__":
    unittest.main()
