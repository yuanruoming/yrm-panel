"""BETA12.1 contracts: stable UX semantics, no duplicate state owners."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
def read(path): return (ROOT/path).read_text(encoding='utf-8')

class Beta121Contracts(unittest.TestCase):
    def test_monitor_visibility_has_one_owner(self):
        monitor=read('YrmPanel/wwwroot/js/rc4-monitor.js')
        panel=read('YrmPanel/wwwroot/js/panel.js')
        self.assertNotIn('pinned.hidden =',monitor)
        self.assertNotIn('MutationObserver(repair)',monitor)
        self.assertIn('pinned.hidden = !(pinnedEnabled && activeUrl === null)',panel)
    def test_ddns_table_does_not_receive_error_paragraphs(self):
        js=read('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertNotIn('info.dataset.b9DdnsResult',js)
        self.assertIn("CustomEvent('yrm:notification'",js)
        self.assertIn('scanDdnsFailures()',read('YrmPanel/wwwroot/js/panel.js'))
    def test_file_selected_row_uses_fixed_toolbar(self):
        markup=read('YrmPanel/Pages/Files.cshtml')
        self.assertEqual(markup.count('id="yrm-b10-file-selection"'),1)
        self.assertLess(markup.find('id="yrm-b10-file-selection"'),markup.find('responsive-table'))
        self.assertIn('data-b10-file-move disabled',markup)
        self.assertIn('data-b12-file-copy disabled',markup)
        self.assertIn('setFileSelection(row)',read('YrmPanel/wwwroot/js/v1-stability.js'))
    def test_copy_move_picker_hides_raw_path(self):
        js=read('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('input.type = rename ? "text" : "hidden";',js)
        self.assertIn('submit.textContent = rename ? "Rename" : copy ? "Copy" : "Move"',js)
    def test_window_geometry_and_taskbar_state(self):
        js=read('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('toggleWindowMaximize',js)
        self.assertIn('windowTitlebar.setPointerCapture(event.pointerId)',js)
        self.assertIn('createPinnedTaskbarApp',js)
        self.assertIn('taskbarPins',js)
    def test_no_new_bespoke_helper_or_system_changes(self):
        # Keep the existing BETA12.2 series; UI consolidation is not a new Beta.
        self.assertIn('<Version>1.0.0-beta.12.2</Version>',read('YrmPanel/YrmPanel.csproj'))

if __name__=='__main__': unittest.main()
