"""The "Show hidden files" feature is gone: dot files are never listed, nothing carries a hidden flag."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class HiddenFilesRemoved(unittest.TestCase):
    def test_page_model_has_no_hidden_flag(self):
        model=source('YrmPanel/Pages/Files.cshtml.cs')
        self.assertNotIn('public bool Hidden',model)
        self.assertNotIn('hidden = Hidden',model)
        self.assertNotIn('CurrentRelative, Hidden)',model)
        self.assertIn('View = _files.Browse("system", CurrentRelative);',model)
        self.assertIn('var view = _files.Browse("system", path);',model)
    def test_markup_and_styles_have_no_toggle(self):
        view=source('YrmPanel/Pages/Files.cshtml')
        self.assertNotIn('fm-hidden-toggle',view)
        self.assertNotIn('Model.Hidden',view)
        self.assertNotIn('route-hidden',view)
        self.assertNotIn('fm-hidden-toggle',source('YrmPanel/wwwroot/css/v1.css'))
if __name__=='__main__':unittest.main()
