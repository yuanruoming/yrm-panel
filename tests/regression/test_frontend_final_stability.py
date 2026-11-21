"""Final-stage contracts for the confirmed interaction and navigation performance design.

These checks complement (not replace) the existing regression suite. Full C# build
and Ubuntu integration remain required for release qualification.
"""
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]

def src(path):
    return (ROOT / path).read_text(encoding='utf-8')

class FinalNavigationContracts(TestCase):
    def test_open_only_on_double_click_and_expand_only_on_arrow(self):
        files = src('YrmPanel/Pages/Files.cshtml')
        tree = src('YrmPanel/wwwroot/js/v1-tree-navigation.js')
        css = src('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertEqual(files.count('data-fm-expand'), 2)
        self.assertEqual(files.count('data-fm-inline-folder'), 2)
        self.assertNotIn('const clickDelay', tree)
        self.assertNotIn('pending.set(action.surface', tree)
        self.assertIn('if (row) void toggleInline(row)', tree)
        self.assertIn('else void toggleNested(expand)', tree)
        self.assertIn("document.addEventListener('dblclick'", tree)
        self.assertIn('anchor.click()', tree)
        self.assertIn('header.append(expand,link)', tree)
        self.assertIn("expand.setAttribute('aria-expanded', String(expanding))", tree)
        self.assertIn('fm-folder-expand[aria-expanded="true"]', css)
        self.assertIn('.fm-folder-entry .fm-folder-icon{transform:none!important;transition:none!important;}',css)
        self.assertIn('data-my-files-toggle', files)
        self.assertIn('fm-my-files-folder', files)

    def test_readonly_navigation_does_not_spawn_helpers_on_every_click(self):
        catalog = src('YrmPanel/Services/FilesNavigationSnapshot.cs')
        files = src('YrmPanel/Pages/Files.cshtml.cs')
        program = src('YrmPanel/Program.cs')
        shell = src('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('AddSingleton<FilesNavigationSnapshot>()', program)
        self.assertIn('await Task.WhenAll(devicesTask, sambaTask)', catalog)
        self.assertIn('DateTimeOffset.UtcNow.AddSeconds(3)', catalog)
        self.assertIn('lock (_sync)', catalog)
        self.assertIn('if (_generation == generation)', catalog)
        self.assertIn('if (result.Ok) _filesNavigation.Invalidate()', src('YrmPanel/Pages/Settings.cshtml.cs'))
        self.assertIn('_navigation.GetAsync(HttpContext.RequestAborted, refresh)', files)
        self.assertIn('_navigation.Invalidate()', files)
        self.assertIn('Response.Headers["Server-Timing"]', files)
        self.assertIn('X-YRM-Refresh', files)
        self.assertIn('X-YRM-Refresh', shell)

    def test_wallpaper_history_survives_and_reuses_private_browser_cache(self):
        page = src('YrmPanel/Pages/Settings.cshtml')
        model = src('YrmPanel/Pages/Settings.cshtml.cs')
        store = src('YrmPanel/Services/PanelSettingsStore.cs')
        self.assertIn('wallpaper-history',store)
        self.assertIn('private, max-age=31536000, immutable', model)
        self.assertIn('loading="eager" decoding="async"', page)
        self.assertIn('_wallpaperDigests.TryGetValue(path',store)
        self.assertIn('System.Security.Cryptography.SHA256.HashData(file)',store)

    def test_diagnostic_orphan_is_precisely_hidden_without_deletion(self):
        files=src('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('name.StartsWith("ystemctl show yrm-panel.service"',files)
        self.assertIn('name.StartsWith("systemctl show yrm-panel.service"',files)
        self.assertIn('IsUserHomeDirectory(Absolute)',files)
        self.assertIn('item.IsDirectory || !IsPanelInstallArtifact(item.Name)',files)
        self.assertNotIn('System.IO.File.Delete(',files)
