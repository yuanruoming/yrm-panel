"""Expanded folders under a folder row: one CSS block, full-width rows, small indent, files listed.
Source checks only; the browser behaviour was verified separately in a real Chromium run."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class ExpandedFolderTree(unittest.TestCase):
    def test_look_is_owned_by_one_block_with_full_width_rows(self):
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertNotIn('border-left:1px solid #343c46',css)          # no guide lines
        self.assertEqual(css.count('.fm-tree-preview-row[hidden]'),1)  # no duplicated rules
        self.assertEqual(css.count('.fm-explorer .fm-tree-node-header{'),1)
        self.assertNotIn('.fm-inline-preview .fm-tree-node-header{min-height:29px;}',css)
        # indentation lives inside each row, so hover/selection spans the whole table width
        self.assertIn('--tree-pad:13px;--tree-indent:10px;',css)
        self.assertIn('padding-left:calc(var(--tree-pad) + var(--tree-depth,1) * var(--tree-indent))',css)
        self.assertNotIn('padding-left:21px',css.split('.fm-inline-preview{--tree-pad')[1].split('.fm-tree-empty')[0])
        self.assertIn('.fm-explorer .fm-tree-node-header.is-selected{background:#334155;}',css)
        self.assertIn(':has(:focus-visible){outline:2px solid #7bb4e7;outline-offset:-2px;}',css)
    def test_files_density_is_one_set_of_tokens(self):
        base=source('YrmPanel/wwwroot/css/v1.css')
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        panel=source('YrmPanel/wwwroot/css/panel.css')
        self.assertIn('.fm-explorer {--fm-row-height:40px;--fm-head-height:32px;--fm-control-height:32px;--rc-control-h:var(--fm-control-height);--fm-space:10px;--fm-pad:12px;--fm-font:13px;--fm-icon:18px;',base)
        self.assertIn('@media (pointer:coarse) {.fm-explorer {--fm-row-height:48px;--fm-control-height:40px;}}',base)
        # rows, head, toolbar and path row all read the tokens
        self.assertIn('font-size:var(--fm-font);padding-top:0;padding-bottom:0;height:var(--fm-row-height);border-bottom:1px solid var(--fm-row-line);}',base)
        self.assertIn('height:var(--fm-head-height);padding-top:0;padding-bottom:0;}',base)
        self.assertIn('margin:var(--fm-space) 0;min-height:var(--fm-control-height);}',base)
        self.assertIn('padding:0 0 var(--fm-space);}',css)
        self.assertIn('.yrm-flat-files .fm-content{padding:var(--fm-pad) calc(var(--fm-pad) + 4px);',css)
        self.assertIn('width:var(--fm-control-height);min-width:var(--fm-control-height);height:var(--fm-control-height)',css)
        self.assertIn('.fm-explorer .fm-folder-icon{width:var(--fm-icon);height:var(--fm-icon);flex:0 0 var(--fm-icon);',css)
        # the superseded layers are gone, not overridden
        self.assertNotIn('padding:15px 19px!important',css)
        self.assertNotIn('padding:9px 12px 0 20px',css)
        self.assertNotIn('min-height:43px',css)
        self.assertNotIn('margin:11px 0 13px',base)
        self.assertNotIn('padding:15px 0',panel)
        self.assertNotIn('padding-bottom:12px',panel.split('.explorer-path-row')[1].split('}')[0])
        # expanded rows share the main rows' height, font, icon size and separator line
        self.assertIn('min-height:var(--fm-row-height);border-bottom:1px solid var(--fm-row-line);',css)
        self.assertIn('min-height:calc(var(--fm-row-height) - 1px)',css)
        self.assertIn('font-size:var(--fm-font);color:#d1e0ef;',css)
    def test_icons_share_the_main_row_colour_rule(self):
        panel=source('YrmPanel/wwwroot/css/panel.css')
        self.assertIn('.explorer-name .ui-icon, .fm-tree-node-header .ui-icon {color:#6db9ec;',panel)
    def test_a_click_highlights_but_never_joins_the_file_selection(self):
        js=source('YrmPanel/wwwroot/js/v1-tree-navigation.js')
        self.assertIn('function selectNode(header)',js)
        self.assertIn("target.closest('.fm-inline-preview .fm-tree-node-header')",js)
        self.assertIn("event.key === 'Escape'",js)
        self.assertIn("matches('.fm-inline-preview a[data-fm-tree-folder]')",js)
        # Highlight only: file operations act on direct children of the current folder.
        self.assertNotIn('setFileSelection',js)
        self.assertNotIn('data-b10-file-row',js)
    def test_files_are_listed_and_opened_by_the_existing_preview_script(self):
        model=source('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('files = view.Items.Where(x => !x.IsDirectory).Select(x => x.Name),',model)
        tree=source('YrmPanel/wwwroot/js/v1-tree-navigation.js')
        self.assertIn('function fileNode(dir, name, depth)',tree)
        self.assertIn('async function loadChildren(path)',tree)
        self.assertNotIn('loadFolders',tree)
        self.assertIn("open.dataset.openDir = dir;",tree)
        files=source('YrmPanel/wwwroot/js/v1-files.js')
        self.assertIn('async function showFile(name, dir = null)',files)
        self.assertIn("target.getAttribute('data-open-dir')",files)
if __name__=='__main__':unittest.main()
