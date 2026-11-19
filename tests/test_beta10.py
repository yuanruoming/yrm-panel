"""BETA10 source contracts and non-destructive tests. Not a Linux integration test."""
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

def source(path):
    return (ROOT / path).read_text(encoding='utf-8')


class ProductContracts(unittest.TestCase):
    def test_release_version(self):
        self.assertIn('<Version>1.0.0-beta.10</Version>', source('YrmPanel/YrmPanel.csproj'))

    def test_settings_removes_readonly_service_and_duplicate_share_page(self):
        view = source('YrmPanel/Pages/Settings.cshtml')
        self.assertNotIn('("services", "Services",', view)
        self.assertNotIn('("sharing", "File Sharing",', view)
        self.assertIn('asp-page-handler="DdnsGroupCheck"', view)

    def test_storage_uses_subpages_and_never_lists_optical_media_as_volume(self):
        view = source('YrmPanel/Pages/Settings.cshtml')
        code = source('YrmPanel/Services/StorageDeviceService.cs')
        self.assertIn('data-b10-storage-panel="volumes"', view)
        self.assertIn('data-b10-storage-panel="disks" hidden', view)
        self.assertIn('data-b10-storage-tab="disks"', view)
        self.assertIn('new[] { "ext4", "xfs", "btrfs", "vfat", "exfat", "ntfs" }', view)
        self.assertIn('points.Contains("/", StringComparer.Ordinal)', code)
        self.assertIn('"/usr/bin/findmnt"', code)

    def test_my_folders_delete_is_real_but_quick_access_is_bookmark_only(self):
        view = source('YrmPanel/Pages/Files.cshtml')
        handler = source('YrmPanel/Pages/Files.cshtml.cs')
        store = source('YrmPanel/Services/MyFoldersStore.cs')
        manager = source('YrmPanel/Services/FileManagerService.cs')
        self.assertIn('asp-page-handler="DeleteLibrary"', view)
        self.assertIn('asp-page-handler="UnpinFolder"', view)
        self.assertIn('QuickAccess', handler)
        self.assertIn('_files.DeleteLibraryFolder(absolute)', handler)
        self.assertIn('SaveFileUnsafe(_pinsFile', store)
        self.assertIn('Directory.Delete(path, recursive: true)', manager)
        self.assertIn('mount.StartsWith(path + "/"', manager)
        self.assertIn('FileAttributes.ReparsePoint', manager)
        self.assertIn('AssertNoSharesAsync(absolute)', handler)
        self.assertNotIn('RecycleBin', manager)

    def test_grouped_ddns_actions_and_inline_secret(self):
        ui = source('YrmPanel/Pages/Settings.cshtml')
        code = source('YrmPanel/Pages/Settings.cshtml.cs')
        css = source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn('asp-page-handler="DdnsAddGroup"', ui)
        self.assertIn('asp-page-handler="DdnsEditGroup"', ui)
        self.assertIn('asp-page-handler="DdnsDeleteGroup"', ui)
        self.assertIn('IPv4 · A Record', ui)
        self.assertIn('IPv6 · AAAA Record', ui)
        self.assertNotIn('Automatic monitoring', ui)
        self.assertIn('yrm-b10-secret-field', ui)
        self.assertIn('position:absolute!important', css)
        self.assertIn('OnPostDdnsAddGroupAsync', code)
        self.assertIn('OnPostDdnsEditGroupAsync', code)

    def test_update_details_not_permanently_six_cards(self):
        ui = source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('yrm-b10-update-details', ui)
        self.assertIn('<summary>Update details</summary>', ui)

    def test_maximize_aligns_with_real_topbar(self):
        css = source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn('padding:49px 0 0!important', css)
        self.assertIn('height:calc(100dvh - 49px)!important', css)
        self.assertNotIn('height:calc(100dvh - 74px)!important', css)

    @unittest.skipUnless(shutil.which('node'), 'Node.js not available')
    def test_frontend_syntax(self):
        js = ROOT / 'YrmPanel/wwwroot/js/v1-stability.js'
        result = subprocess.run(['node','--check',str(js)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == '__main__':
    unittest.main()
