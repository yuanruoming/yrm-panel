"""Files actions: rows render no menu; one action list drives the toolbar, More and right-click.
Source checks only; the behaviour was exercised in a real Chromium run and is covered by the E2E."""
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class UnifiedFilesActions(unittest.TestCase):
    def test_rows_render_no_menu_and_carry_their_state_as_data(self):
        view=source('YrmPanel/Pages/Files.cshtml')
        for gone in ('explorer-menu-cell','data-copy-item','data-move-item','data-rename-item','data-b12-properties','data-b10-row-delete','aria-label="Actions"></th>'):
            self.assertNotIn(gone,view)
        self.assertEqual(view.count('explorer-item-menu'),1)   # only the Quick Access sidebar keeps one
        for attribute in ('data-fm-kind=','data-fm-name=','data-fm-rel=','data-fm-abs=','data-fm-writable=','data-fm-deletable=',
                          'data-fm-pinned=','data-fm-can-pin=','data-fm-share=','data-fm-can-share=','data-fm-can-enable='):
            self.assertEqual(view.count(attribute),2,attribute)  # My Files rows and folder rows
    def test_toolbar_has_more_and_the_shared_forms(self):
        view=source('YrmPanel/Pages/Files.cshtml')
        self.assertIn('data-fm-more aria-haspopup="menu" aria-expanded="false" disabled>More</button>',view)
        for form in ('data-fm-pin-form','data-fm-unpin-form','data-fm-unshare-form','data-fm-enable-form'):
            self.assertEqual(view.count(form),1,form)
        self.assertIn('asp-page-handler="PinFolder" asp-route-path="@currentRoute" data-fm-pin-form',view)
    def test_one_action_list_feeds_toolbar_more_and_context_menu(self):
        js=source('YrmPanel/wwwroot/js/files-actions.js')
        for action in ('open','download','copy','move','rename','pin','copypath','share','unshare','enable','delete','props'):
            self.assertIn(f"{{id: '{action}'",js)
        self.assertIn("addEventListener('contextmenu'",js)
        self.assertIn('[data-fm-more]',js)
        self.assertIn("event.key === 'ContextMenu'",js)
        # no more clicking hidden per-row buttons on the user's behalf
        self.assertNotIn("querySelector('[data-rename-item]')",js)
        stability=source('YrmPanel/wwwroot/js/v1-stability.js')
        for gone in ('setFileSelection','selectedFileRows','data-b12-properties','data-b10-copy-path'):
            self.assertNotIn(gone,stability)
        self.assertIn("if (target.closest('[data-b10-file-row]'))return;",stability)
    def test_dialogs_open_through_one_event(self):
        shell=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('window.addEventListener("yrm-panel:file-action"',shell)
        for gone in ('button.dataset.renameItem','data-share-folder'):
            self.assertNotIn(gone,shell)
        self.assertNotIn("data-share-folder",source('YrmPanel/wwwroot/js/rc41-ui.js'))
    def test_script_is_loaded_before_the_tree_script(self):
        layout=source('YrmPanel/Pages/Shared/_Layout.cshtml')
        self.assertLess(layout.index('files-actions.js'),layout.index('v1-tree-navigation.js'))
if __name__=='__main__':unittest.main()
