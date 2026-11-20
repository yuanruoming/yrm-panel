"""One desktop shell owns title, two action pin icons, and widget layering."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class ShellContracts(unittest.TestCase):
    def test_browser_chrome_stays_constant(self):
        js=source('YrmPanel/wwwroot/js/panel.js')
        layout=source('YrmPanel/Pages/Shared/_Layout.cshtml')
        self.assertIn('<title>YRM PANEL</title>',layout)
        self.assertIn('document.title = "YRM PANEL";',js)
        self.assertNotIn('document.title = `${title} · YRM Panel`',js)
    def test_pin_actions_use_two_different_svg_symbols(self):
        js=source('YrmPanel/wwwroot/js/panel.js')
        markup=source('YrmPanel/Pages/Applications.cshtml')
        layout=source('YrmPanel/Pages/Shared/_Layout.cshtml')
        self.assertIn('id="i-pin-off"',layout)
        self.assertIn("pinnedEnabled ? '#i-pin-off' : '#i-pin'",js)
        self.assertIn("taskbarPins.includes(id)?'#i-pin-off':'#i-pin'",js)
        self.assertEqual(markup.count('isPinned ? "#i-pin-off" : "#i-pin"'),2)
    def test_pinned_monitor_not_hidden_by_app_selection(self):
        js=source('YrmPanel/wwwroot/js/panel.js')
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn('pinned.hidden = !pinnedEnabled',js)
        self.assertNotIn('pinned.hidden = !(pinnedEnabled && activeUrl === null)',js)
        self.assertIn('.workspace-stage > .workspace-window { pointer-events: auto; }',css)
    def test_showing_desktop_does_not_always_refetch_it(self):
        js=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('let desktopNeedsRefresh = false;',js)
        self.assertIn('if (desktopNeedsRefresh) { desktopNeedsRefresh = false; void refreshDesktop(); }',js)
        self.assertIn('desktopNeedsRefresh = true;',js)
        self.assertNotIn('if (["/Settings","/Applications"].includes',js)
    def test_firewall_select_uses_svg_not_text_glyph(self):
        js=source('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn("createElementNS('http://www.w3.org/2000/svg','svg')",js)
        self.assertNotIn("arrow.textContent='⌄'",js)
if __name__=='__main__':unittest.main()
