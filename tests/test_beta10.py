"""BETA10 feature contracts retained across later UI implementations.

These are non-destructive source checks, not Linux integration tests.
"""
import pathlib
import re
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def source(path):
    return (ROOT / path).read_text(encoding='utf-8')


class ProductContracts(unittest.TestCase):

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
        """Test the current geometry, not a removed BETA10 CSS implementation.

        In BETA12.1 the fixed workspace begins beneath the topbar. A maximized
        window fills the workspace, rather than repeating a viewport subtraction.
        """
        css = source('YrmPanel/wwwroot/css/v1-stability.css')
        desktop = source('YrmPanel/wwwroot/css/desktop.css')

        # The last matching topbar height is the most recent declared override.
        topbar_rules = re.findall(r'\.os-topbar\s*\{([^{}]*)\}', desktop)
        heights = [int(height) for rule in topbar_rules
                   for height in re.findall(r'(?<![\w-])height\s*:\s*(\d+)px\b', rule)]
        self.assertTrue(heights, 'Topbar must declare a pixel height')
        topbar_height = heights[-1]

        stage = re.search(r'\.workspace-stage\s*\{([^{}]*)\}', css)
        self.assertIsNotNone(stage, 'Workspace positioning rule is missing')
        stage_css = stage.group(1)
        self.assertRegex(stage_css, r'\bposition\s*:\s*fixed\s*!important')
        inset = re.search(r'(?<![\w-])inset\s*:\s*(\d+)px\s+0\s+0\s*!important', stage_css)
        self.assertIsNotNone(inset, 'Workspace must be inset below the taskbar')
        self.assertEqual(int(inset.group(1)), topbar_height,
                         'Workspace must start at the bottom of the topbar')
        self.assertRegex(stage_css, r'(?<![\w-])padding\s*:\s*0\s*!important')

        maximized = re.search(
            r'\.workspace-stage\s*>\s*\.workspace-window\.is-maximized\s*\{([^{}]*)\}', css)
        self.assertIsNotNone(maximized, 'Maximized workspace window rule is missing')
        max_css = maximized.group(1)
        self.assertRegex(max_css, r'(?<![\w-])top\s*:\s*0\s*!important')
        self.assertRegex(max_css, r'(?<![\w-])left\s*:\s*0\s*!important')
        self.assertRegex(max_css, r'(?<![\w-])width\s*:\s*100%\s*!important')
        self.assertRegex(max_css, r'(?<![\w-])height\s*:\s*100%\s*!important')
        self.assertNotIn('height:calc(100dvh - 74px)!important', css)

    @unittest.skipUnless(shutil.which('node'), 'Node.js not available')
    def test_frontend_syntax(self):
        js = ROOT / 'YrmPanel/wwwroot/js/v1-stability.js'
        result = subprocess.run(['node', '--check', str(js)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
