"""Expanded sub-folders under a folder row: one CSS block, no guide lines, click highlights.
Source checks only; the browser behaviour was verified separately in a real Chromium run."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class SubFolderTree(unittest.TestCase):
    def test_sub_folder_look_is_owned_by_one_block(self):
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertNotIn('border-left:1px solid #343c46',css)          # no guide lines
        self.assertEqual(css.count('.fm-tree-preview-row[hidden]'),1)  # no duplicated rules
        self.assertEqual(css.count('.fm-explorer .fm-tree-node-header{'),1)
        self.assertNotIn('.fm-inline-preview .fm-tree-node-header{min-height:29px;}',css)
        self.assertIn('.fm-inline-preview{display:flex;flex-direction:column;gap:2px;padding:4px 12px 6px 24px;',css)
        self.assertIn('.fm-tree-descendants{display:flex;flex-direction:column;gap:2px;padding-left:21px;}',css)
        self.assertIn('.fm-explorer .fm-tree-node-header.is-selected{background:#334155;}',css)
    def test_a_click_highlights_but_never_joins_the_file_selection(self):
        js=source('YrmPanel/wwwroot/js/v1-tree-navigation.js')
        self.assertIn('function selectNode(header)',js)
        self.assertIn("target.closest('.fm-inline-preview .fm-tree-node-header')",js)
        self.assertIn("event.key === 'Escape'",js)
        self.assertIn("matches('.fm-inline-preview a[data-fm-tree-folder]')",js)
        # Highlight only: file operations act on direct children of the current folder.
        self.assertNotIn('setFileSelection',js)
        self.assertNotIn('data-b10-file-row',js)
if __name__=='__main__':unittest.main()
