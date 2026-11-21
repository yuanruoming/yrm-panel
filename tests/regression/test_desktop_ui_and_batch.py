"""New functionality contracts. Source checks; browser and .NET compile are separate."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class DesktopUiAndBatch(unittest.TestCase):
    def test_overview_has_six_cards_and_volume_cap(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('class="yrm-overview-grid"',view)
        self.assertIn('var i = 0; i < 2; i++',view)
        self.assertIn('overviewVolumes.Length > 2',view)
        self.assertIn('About YRMPanel',view)
        self.assertIn('System Volume',view)
        self.assertIn('Hardware Info',view)
    def test_network_two_families_are_read_only(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        model=source('YrmPanel/Pages/Settings.cshtml.cs')
        self.assertIn('class="yrm-network-family"',view)
        self.assertIn('<h4>IPv4</h4>',view)
        self.assertIn('<h4>IPv6</h4>',view)
        self.assertIn('Prefix Length',view)
        self.assertIn('GetNetworkDetails(string name)',model)
        self.assertNotIn('OnPostNetworkEdit',model)
    def test_shell_keeps_file_settings_navigation_without_url_reload(self):
        shell=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('function reconcileWorkspaceView(remotePage, targetUrl)',shell)
        self.assertIn('oldContent.replaceWith(document.importNode(newContent,true))',shell)
        self.assertIn('if (!reconcileWorkspaceView(remotePage,url)) page.replaceChildren(fragment);',shell)
        self.assertIn('if (!sameWorkspace) appWindow?.classList.add("is-loading")',shell)
        layout=source('YrmPanel/Pages/Shared/_Layout.cshtml')
        self.assertNotIn('class="window-title-dot"',layout)
        self.assertNotIn('asp-page="/Applications"',layout)
    def test_files_multiselect_and_real_server_batch_handlers(self):
        js=source('YrmPanel/wwwroot/js/v1-stability.js')
        model=source('YrmPanel/Pages/Files.cshtml.cs')
        view=source('YrmPanel/Pages/Files.cshtml')
        for phrase in ['selectedFileRows = new Set()',"event.shiftKey", "event.ctrlKey", 'BulkCopy','BulkMove', 'selectedRows()']:
            self.assertIn(phrase,js)
        for phrase in ['OnPostBulkDeleteAsync','OnPostBulkCopyAsync','OnPostBulkMove','smb.Shares.Any']:
            self.assertIn(phrase,model)
        self.assertIn('asp-page-handler="BulkDelete"',view)
    def test_wallpaper_and_updates_are_not_repetitive(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('Recently Used',view)
        self.assertNotIn('Full image</button>',view)
        self.assertNotIn('<small>Current Version</small>',view)
        self.assertIn('class="yrm-wallpaper-recent-grid"',view)
if __name__=='__main__':unittest.main()
