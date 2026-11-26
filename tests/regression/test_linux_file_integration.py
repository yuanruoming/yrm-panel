"""RC4 stabilization regression checks that do not require .NET or a root Ubuntu VM.

These are contract/static tests; the actual Kestrel+Samba integration still
requires the project's Windows Build and Ubuntu VM acceptance run.
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, mock
import configparser

ROOT = Path(__file__).resolve().parents[2]

spec = spec_from_file_location('samba_rc41', ROOT / 'scripts' / 'yrm-panel-samba.py')
samba = module_from_spec(spec)
spec.loader.exec_module(samba)


class FileAndUiIntegrationContracts(TestCase):
    def test_samba_writes_available_inside_protected_service(self):
        unit = (ROOT / 'packaging/yrm-panel.service').read_text()
        self.assertIn('ProtectSystem=full', unit)
        self.assertIn('ReadWritePaths=/var/lib/yrm-panel /etc', unit)

    def test_settings_model_matches_razor(self):
        view = (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text()
        model = (ROOT / 'YrmPanel/Pages/Settings.cshtml.cs').read_text()
        self.assertIn('public SambaOverview Sharing', model)
        self.assertIn('case "sharing":', model)
        self.assertIn('public bool IsVirtualAdapter', model)
        self.assertIn('public bool IsLinkLocalIpv6', model)
        self.assertIn('Model.Sharing', view)
        self.assertIn('Model.IsVirtualAdapter', view)

    def test_library_is_default_and_root_is_explicit(self):
        page = (ROOT / 'YrmPanel/Pages/Files.cshtml.cs').read_text()
        view = (ROOT / 'YrmPanel/Pages/Files.cshtml').read_text()
        self.assertIn('private const string FolderHome = "@folders"', page)
        self.assertIn('if (!Request.Query.ContainsKey("path")) Path = FolderHome;', page)
        self.assertIn('if (Path == "/") Path = "";', page)
        self.assertIn('asp-route-path="/"', view)
        self.assertIn('My Files', view)
        self.assertNotIn('My Folders', view)
        self.assertIn('DiscoverMyFiles()', page)
        # Hidden (dot) files are never listed; there is no toggle for them.
        self.assertNotIn('hidden files', view)
        self.assertNotIn('data-open-add-folder', view)
        self.assertIn('data-share-folder=', view)
        self.assertIn('data-share-absolute=', view)
        self.assertNotIn('Share via SMB', view)

    def test_wallpaper_has_explicit_apply_and_prevent_old_autosubmit(self):
        view = (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text()
        code = (ROOT / 'YrmPanel/wwwroot/js/rc41-ui.js').read_text()
        css = (ROOT / 'YrmPanel/wwwroot/css/v1.css').read_text()
        self.assertIn('id="wallpaper-apply"', view)
        self.assertIn('event.stopPropagation()', code)
        self.assertIn('field.id === \'wallpaper-select\'', code)
        self.assertIn('.wallpaper-actions form', css)
        self.assertIn('min-height:var(--rc-control-h)', css)

    def test_default_pin_and_release_metadata(self):
        code = (ROOT / 'YrmPanel/wwwroot/js/rc41-ui.js').read_text()
        layout = (ROOT / 'YrmPanel/Pages/Shared/_Layout.cshtml').read_text()
        project = (ROOT / 'YrmPanel/YrmPanel.csproj').read_text()
        self.assertIn("localStorage.setItem('yrm-panel:pinned-monitor', '1')", code)
        self.assertIn('src="~/js/rc41-ui.js"', layout)
        self.assertIn('href="~/css/v1.css"', layout)
        self.assertIn('<IncludeSourceRevisionInInformationalVersion>false', project)
        self.assertNotIn('Listening:', (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text())


class SambaConfigurationTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.main = self.root / 'smb.conf'
        self.managed = self.root / 'yrm-panel-shares.conf'
        self.main.write_text('[global]\n    include = /etc/samba/yrm-panel-shares.conf\n')
        self.managed.write_text('# Created by YRM Panel\n')
        self.patches = [
            mock.patch.object(samba, 'MAIN', self.main),
            mock.patch.object(samba, 'MANAGED', self.managed),
            mock.patch.object(samba, 'validate_path', return_value='/data/Photos'),
            mock.patch.object(samba, 'effective_names', return_value=set()),
            mock.patch.object(samba, 'account', return_value='yuanruoming'),
            mock.patch.object(samba, 'run', side_effect=lambda argv: self.managed.read_text()
                       if argv and argv[0] == 'testparm' else ''),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_share_write_and_unshare_keep_original_files(self):
        test_file = self.root / 'my-photo.txt'
        test_file.write_text('original user data')
        samba.save_share('Photos', '/data/Photos', False)
        cfg = samba.parse()
        self.assertTrue(cfg.has_section('Photos'))
        self.assertEqual(cfg.get('Photos', 'path'), '/data/Photos')
        self.assertEqual(cfg.get('Photos', 'valid users'), 'yuanruoming')
        self.assertFalse(cfg.getboolean('Photos', 'read only'))
        samba.remove_share('Photos')
        self.assertFalse(samba.parse().has_section('Photos'))
        self.assertEqual(test_file.read_text(), 'original user data')

    def test_read_only_share(self):
        samba.save_share('Archive', '/data/Photos', True)
        cfg = samba.parse()
        self.assertTrue(cfg.getboolean('Archive', 'read only'))
        self.assertEqual(cfg.get('Archive', 'guest ok'), 'no')

    def test_invalid_share_name_never_overwrites_config(self):
        original = self.managed.read_bytes()
        with self.assertRaises(ValueError):
            samba.save_share('../wrong', '/data/Photos', False)
        self.assertEqual(self.managed.read_bytes(), original)

    def test_save_failure_rolls_back_config(self):
        original = self.managed.read_bytes()
        with mock.patch.object(samba, 'run', side_effect=ValueError('reload failed')):
            with self.assertRaises(ValueError):
                samba.save_share('Broken', '/data/Photos', False)
        self.assertEqual(self.managed.read_bytes(), original)
