"""Cross-version contracts for the single-administrator taskbar and safe copy.
Not a substitute for the live Linux smoke or a browser run.
"""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
def read(path): return (ROOT/path).read_text(encoding='utf-8')
class TaskbarAndCopyContracts(unittest.TestCase):
    def test_taskbar_uses_existing_persistent_settings(self):
        code=read('YrmPanel/Pages/Settings.cshtml.cs')
        js=read('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('_settings.SetPinnedAsync(id, pinned)',code)
        self.assertIn('OnGetTaskbarPins',code)
        self.assertIn('OnPostTaskbarPinAsync',code)
        self.assertIn('RequestVerificationToken',js)
        self.assertIn('createPinnedTaskbarApp',js)
        self.assertIn('taskbarPins',js)
        self.assertNotIn('desktop-pins',read('YrmPanel/Pages/Index.cshtml'))
    def test_file_copy_does_not_overwrite_or_cross_links(self):
        manager=read('YrmPanel/Services/FileManagerService.cs')
        self.assertIn('public async Task CopyAsync',manager)
        self.assertIn('EnsureAbsent(target);',manager)
        self.assertIn('EnsureNoNestedMounts(source)',manager)
        self.assertIn('FileAttributes.ReparsePoint',manager)
        self.assertIn('FileMode.CreateNew',manager)
        view=read('YrmPanel/Pages/Files.cshtml')
        handler=read('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('data-copy-item',view)
        self.assertIn('OnPostCopyAsync',handler)
    def test_ddns_error_is_details_only(self):
        view=read('YrmPanel/Pages/Settings.cshtml')
        css=read('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn('data-b12-ddns-detail',view)
        self.assertIn('id="yrm-b12-ddns-detail"',view)
        self.assertIn('[data-b9-ddns-error]{display:none!important;}',css)
if __name__=='__main__':unittest.main()
