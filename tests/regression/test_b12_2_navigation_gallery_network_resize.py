"""BETA12.2 UI fixes: explicit contracts for the latest agreed interactions."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
def content(path): return (ROOT / path).read_text(encoding="utf-8")

class RoundTwoContracts(unittest.TestCase):
    def test_consistent_files_breadcrumbs_and_history(self):
        view = content('YrmPanel/Pages/Files.cshtml')
        model = content('YrmPanel/Pages/Files.cshtml.cs')
        shell = content('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('class="fm-breadcrumbs"', view)
        self.assertIn('data-fm-history-back', view)
        self.assertIn('public IReadOnlyList<FileBreadcrumb> Breadcrumbs', model)
        self.assertIn('history.state?.yrmPrevRoute', shell)
        self.assertIn('yrmPrevRoute:previousRoute', shell)
        self.assertNotIn('aria-label="Parent folder"', view)
    def test_inline_expansion_uses_tree_endpoint(self):
        view = content('YrmPanel/Pages/Files.cshtml')
        tree = content('YrmPanel/wwwroot/js/v1-tree-navigation.js')
        model = content('YrmPanel/Pages/Files.cshtml.cs')
        layout = content('YrmPanel/Pages/Shared/_Layout.cshtml')
        self.assertIn('data-fm-inline-toggle', view)
        self.assertNotIn('data-fm-tree-toggle', view)
        self.assertIn('data-my-files-toggle', view)
        self.assertIn('data-fm-inline-toggle', view)
        self.assertIn("url.searchParams.set('handler', 'Tree')", tree)
        self.assertIn('public IActionResult OnGetTree(', model)
        self.assertIn('v1-tree-navigation.js', layout)
    def test_my_files_has_complete_toolbar_and_real_path_operations(self):
        view = content('YrmPanel/Pages/Files.cshtml')
        model = content('YrmPanel/Pages/Files.cshtml.cs')
        shell = content('YrmPanel/wwwroot/js/panel.js')
        tree = content('YrmPanel/wwwroot/js/v1-tree-navigation.js')
        for marker in ('data-b12-file-download', 'data-b10-file-rename',
                       'data-b12-file-copy', 'data-b10-file-move',
                       'data-b10-file-delete', 'data-root-upload-open'):
            self.assertIn(marker, view)
        self.assertLess(view.find('id="yrm-b10-file-selection"'),
                        view.find('@if (Model.IsMyFolders)', view.find('id="yrm-b10-file-selection"')))
        self.assertIn('data-current-route="@currentRoute"', view)
        self.assertIn('form.dataset.currentRoute', shell)
        self.assertIn('ResolveLibrarySelectionAsync(', model)
        self.assertIn('WriteDownloadZipFromPathsAsync(', model)
        self.assertNotIn('data-fm-tree-toggle', view)
        self.assertIn('folderNodes', tree)

    def test_profile_and_ddns_forms_use_current_backends(self):
        settings = content('YrmPanel/Pages/Settings.cshtml')
        page_model = content('YrmPanel/Pages/Settings.cshtml.cs')
        store = content('YrmPanel/Services/PanelSettingsStore.cs')
        js = content('YrmPanel/wwwroot/js/rc41-ui.js')
        self.assertIn('yrm-settings-nav-bottom', settings)
        self.assertIn('yrm-profile-photo-dialog', settings)
        self.assertIn('data-yrm-photo-open', settings)
        self.assertIn('OnPostProfilePhotoAsync(', page_model)
        self.assertIn('OnGetProfilePhoto()', page_model)
        self.assertIn('SetProfilePhotoAsync(', store)
        self.assertIn('data-yrm-profile-toggle', js)
        self.assertIn('data-yrm-system-time', settings)
        self.assertIn('data-yrm-system-uptime', settings)
        self.assertIn('ValidateDdnsSources(', page_model)
        self.assertIn('ipSource', settings)
        self.assertIn('name="enabled"', settings)
        self.assertIn('Notice = null;', page_model)

    def test_multi_item_zip_is_streamed_with_guards(self):
        model = content('YrmPanel/Pages/Files.cshtml.cs')
        service = content('YrmPanel/Services/FileManagerService.cs')
        js = content('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn('OnPostBulkDownloadAsync(string[] names)', model)
        self.assertIn('Response.Body', model)
        self.assertIn('new ZipArchive(output, ZipArchiveMode.Create', service)
        self.assertIn('FileAttributes.ReparsePoint', service)
        self.assertIn('nestedMounts.Any(', service)
        self.assertIn('data-bulk-download-form', js)
        self.assertNotIn("current.length!==1||!current[0]?.querySelector('a[data-native-download]')", js)
    def test_wallpaper_is_deduplicated_by_content(self):
        store = content('YrmPanel/Services/PanelSettingsStore.cs')
        view = content('YrmPanel/Pages/Settings.cshtml')
        actions = content('YrmPanel/wwwroot/js/rc41-ui.js')
        self.assertIn('SHA256.HashData', store)
        self.assertIn('PruneWallpaperHistory()', store)
        self.assertIn('GroupBy(WallpaperDigest', store)
        self.assertIn("field.closest('form')?.requestSubmit()", actions)
        self.assertIn('wallpaper-apply" type="submit" hidden', view)
    def test_network_linux_support_and_three_cards(self):
        view = content('YrmPanel/Pages/Settings.cshtml')
        model = content('YrmPanel/Pages/Settings.cshtml.cs')
        linux = content('YrmPanel/Services/NetworkConfigurationReader.cs')
        self.assertIn('yrm-network-interface-details', view)
        self.assertIn('Link Speed', view)
        self.assertNotIn('Virtual &amp; secondary interfaces', view)
        self.assertNotIn('IsDhcpEnabled', model)
        self.assertNotIn('v6?.PrefixOrigin', model)
        self.assertIn('networkctl', linux)
        self.assertIn('nmcli', linux)
        self.assertIn('resolvectl', linux)
    def test_window_resize_and_settings_height(self):
        shell = content('YrmPanel/wwwroot/js/panel.js')
        css = content('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn("['n','ne','e','se','s','sw','w','nw']", shell)
        self.assertIn('setPointerCapture(event.pointerId)', shell)
        self.assertIn('container-type:inline-size', css)
        self.assertIn('min-height:100%', css)
        self.assertIn('yrm-resize-handle', css)
    def test_about_restores_version_without_dev_badge(self):
        view = content('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('class="yrm-updates-current"', view)
        self.assertNotIn('<span class="tag">@Model.UpdateChannel</span>', view)

if __name__ == '__main__': unittest.main()
