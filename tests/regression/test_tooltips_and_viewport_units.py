"""No hover tooltips anywhere, no viewport-height sizing inside windows, no pointless Update Now.
Source checks only; the browser behaviour is covered by tests/e2e/files-e2e.mjs."""
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class NoTooltips(unittest.TestCase):
    def test_razor_pages_carry_no_title_attributes(self):
        for page in sorted((ROOT/'YrmPanel/Pages').rglob('*.cshtml')):
            text=page.read_text(encoding='utf-8')
            self.assertIsNone(re.search(r'\stitle=',text),f'{page.name} still has a title attribute')
    def test_scripts_do_not_set_title_on_elements(self):
        for script in sorted((ROOT/'YrmPanel/wwwroot/js').glob('*.js')):
            text=script.read_text(encoding='utf-8')
            self.assertNotIn('setAttribute("title"',text,script.name)
            self.assertNotIn("setAttribute('title'",text,script.name)
            for name in ('button','pin','opener','download','row','link','del','select','notificationTrigger'):
                self.assertIsNone(re.search(rf'\b{name}\.title\s*=[^=]',text),f'{script.name}: {name}.title')
    def test_icon_only_controls_keep_an_accessible_name(self):
        apps=source('YrmPanel/Pages/Applications.cshtml')
        self.assertIn('type="submit" aria-label="@(isPinned ? "Unpin from desktop" : "Pin to desktop")"',apps)
        panel=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn("'Restore window':'Maximize window'",panel)
        self.assertIn("setAttribute('aria-label',pinned?'Unpin from Taskbar':'Pin to Taskbar')",panel)
        self.assertIn("setAttribute('aria-label','Remove rule')",source('YrmPanel/wwwroot/js/v1-settings.js'))
class ViewportIndependentContent(unittest.TestCase):
    def test_wallpaper_preview_and_sidebar_list_do_not_use_viewport_height(self):
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn('aspect-ratio:3/1;min-height:185px;max-height:315px',css)
        self.assertNotIn('31vh',css)
        self.assertNotIn('42vh',css)
        self.assertIn('max-height:min(400px,45cqh)',css)
        self.assertIn('#window-scroll:has(.fm-explorer){container-type:size;}',css)
class UpdateNowOnlyWhenThereIsAnUpdate(unittest.TestCase):
    def test_no_disabled_placeholder_button(self):
        settings=source('YrmPanel/Pages/Settings.cshtml')
        self.assertNotIn('Check for updates first',settings)
        self.assertEqual(settings.count('Update Now'),1)
if __name__=='__main__':unittest.main()
