"""Non-destructive tests of the v1 helpers and release integration.

These do NOT claim actual Ubuntu/systemd/Windows SMB end-to-end coverage.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, mock
from importlib.util import module_from_spec, spec_from_file_location
import json

ROOT = Path(__file__).resolve().parents[1]

def load(name, path):
    spec = spec_from_file_location(name, ROOT / path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mounts = load('v1_mounts', 'scripts/yrm-panel-mount.py')
firewall = load('v1_firewall', 'scripts/yrm-panel-firewall.py')


class MountHelperTests(TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.fstab = root / 'fstab'
        self.fstab.write_text('UUID=existing / ext4 defaults 0 1\n')
        self.manual = root / 'manual.json'
        self.managed = root / 'Photos'
        self.ctx = mock.patch.multiple(mounts, FSTAB=self.fstab, MANUAL=self.manual)
        self.ctx.start(); self.addCleanup(self.ctx.stop)

    def test_protected_paths_rejected(self):
        for value in ('/', '/etc', '/etc/passwd', '/root/a', '/var/lib', '/boot/efi'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                mounts.path_check(value)

    def test_invalid_traversal_and_relative_paths(self):
        for value in ('home/user/Photos','/home/../etc','/home/user/./a','/home/user/foo bar'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                mounts.path_check(value)

    def test_non_empty_folder_is_never_covered(self):
        self.managed.mkdir()
        (self.managed / 'irreplaceable.txt').write_text('keep')
        with mock.patch.object(mounts, 'lookup', return_value={'fstype':'ext4'}):
            with self.assertRaisesRegex(ValueError,'empty'):
                mounts.create_mount('abcdef01', str(self.managed), True)
        self.assertEqual((self.managed/'irreplaceable.txt').read_text(),'keep')

    def test_persistent_mount_is_reversible_and_keeps_directory(self):
        with mock.patch.object(mounts, 'lookup', return_value={'fstype':'ext4'}), \
             mock.patch.object(mounts, 'run', return_value='/'):
            mounts.create_mount('abcdef01', str(self.managed), True)
        self.assertTrue(self.managed.exists())
        self.assertIn('yrm-panel-managed:', self.fstab.read_text())
        with mock.patch.object(mounts, 'run', return_value=''):
            mounts.unmount(str(self.managed))
        self.assertNotIn('yrm-panel-managed:', self.fstab.read_text())
        self.assertTrue(self.managed.is_dir())

    def test_manual_mount_can_be_unmounted(self):
        with mock.patch.object(mounts, 'lookup', return_value={'fstype':'ext4'}), \
             mock.patch.object(mounts, 'run', return_value='/'):
            mounts.create_mount('abcdef01', str(self.managed), False)
        self.assertIn(str(self.managed), json.loads(self.manual.read_text()))
        with mock.patch.object(mounts, 'run', return_value=''):
            mounts.unmount(str(self.managed))
        self.assertNotIn(str(self.managed), json.loads(self.manual.read_text()))

    def test_unmanaged_mount_cannot_be_unmounted(self):
        with self.assertRaisesRegex(ValueError,'managed'):
            mounts.unmount(str(self.managed))

    def test_mount_failure_rolls_back_new_directory_mounted_state(self):
        def fake_run(args, **kwargs):
            if args[0].endswith('/mount'): raise ValueError('kernel refused mount')
            return '/'
        with mock.patch.object(mounts,'lookup',return_value={'fstype':'ext4'}), \
             mock.patch.object(mounts,'run',side_effect=fake_run):
            with self.assertRaisesRegex(ValueError,'kernel refused'):
                mounts.create_mount('abcdef01',str(self.managed),True)
        self.assertNotIn('yrm-panel-managed:',self.fstab.read_text())


class FirewallTests(TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state=Path(self.tmp.name)/'firewall.json'
        self.patch=mock.patch.object(firewall,'STATE',self.state)
        self.patch.start();self.addCleanup(self.patch.stop)

    def test_refuse_protected_admin_port_deny(self):
        for port in (22,6080,6081):
            with self.subTest(port=port), self.assertRaisesRegex(ValueError,'Refusing'):
                firewall.validate(dict(scope='host', action='deny', port=port, protocol='tcp', source='any'))

    def test_reject_invalid_address_or_sudo_pseudorule(self):
        for source in ('0.0.0.0/99','127.0.0.1/garbage','localhost; rm -rf /'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                firewall.validate(dict(scope='host', action='allow', port=445, protocol='tcp', source=source))

    def test_reject_out_of_range_ports(self):
        for port in (0,65536,True,'abc', '80-10', '80,foo'):
            with self.subTest(port=port), self.assertRaises(ValueError):
                firewall.validate(dict(scope='host', action='allow', port=port, protocol='tcp', source='any'))

    def test_docker_rejects_unknown_actions(self):
        with self.assertRaises(ValueError):
            firewall.validate(dict(scope='docker', action='command', port=8080, protocol='tcp',source='any'))

    def test_host_draft_applies_and_tracks_only_owned_rules(self):
        calls=[]
        rule=dict(scope='host',action='allow',port=445,protocol='tcp',source='192.168.1.0/24')
        with mock.patch.object(firewall,'run',side_effect=lambda args,**k: calls.append(args) or ''), \
             mock.patch.object(firewall,'ufw_status',return_value=(True,False,'Status: inactive')):
            message=firewall.apply(json.dumps([rule]))
        self.assertIn('applied',message)
        self.assertEqual(firewall.load(),[dict(rule,port='445')])
        self.assertTrue(any('ufw' in call[0] for call in calls))

    def test_reject_duplicate_draft_before_mutation(self):
        rule=dict(scope='host',action='allow',port=445,protocol='tcp',source='any')
        with mock.patch.object(firewall,'run') as run:
            with self.assertRaisesRegex(ValueError,'Duplicate'):
                firewall.apply(json.dumps([rule,rule]))
            run.assert_not_called()

    def test_docker_lan_rule_order_is_allow_rfc1918_then_drop(self):
        rule=dict(scope='docker',action='lan',port=8080,protocol='tcp',source='any')
        specs=firewall.docker_specs(rule)
        self.assertEqual(len(specs),4)
        self.assertEqual([spec[-1][-1] for spec in specs],['RETURN','RETURN','RETURN','DROP'])

    def test_failed_ufw_install_keeps_state_unmodified(self):
        rule=dict(scope='host',action='allow',port=8080,protocol='tcp',source='any')
        with mock.patch.object(firewall,'run',side_effect=ValueError('ufw failure')):
            with self.assertRaises(ValueError):
                firewall.apply(json.dumps([rule]))
        self.assertFalse(self.state.exists())


class PackageContractTests(TestCase):
    def test_all_new_helpers_packaged(self):
        installer=(ROOT/'scripts/install.sh').read_text()
        workflow=(ROOT/'.github/workflows/dev-release.yml').read_text()
        for name in ('yrm-panel-firewall.py','yrm-panel-mount.py','yrm-panel-firewall-restore.service'):
            with self.subTest(name=name):
                self.assertIn(name,installer)
                self.assertIn(name,workflow)

    def test_stable_is_tagged_and_checksum_published(self):
        stable=(ROOT/'.github/workflows/stable-release.yml').read_text()
        self.assertIn("tags: ['v*.*.*']",stable)
        self.assertIn('sha256sum',stable)
        self.assertIn('gh release create',stable)

    def test_files_do_not_auto_rename_collisions(self):
        code=(ROOT/'YrmPanel/Services/FileManagerService.cs').read_text()
        js=(ROOT/'YrmPanel/wwwroot/js/v1-files.js').read_text()
        self.assertIn('File.Move(temp, target, replace)',code)
        self.assertIn('OK = Replace existing file',js)
        self.assertIn('Cancel = Skip',js)
        self.assertNotIn(' (1)',js)

    def test_upload_conflict_only_returns_when_file_exists(self):
        code=(ROOT/'YrmPanel/Pages/Files.cshtml.cs').read_text()
        conflict_branch="""            if (!replace && _files.Exists("system", CurrentRelative, upload.FileName))
            {
                if (ajax)
                    return new ConflictObjectResult(new { ok = false, conflict = true, message = "File exists." });
                Notice = "Error: File already exists. Choose Replace or Skip.";
                return Back();
            }
            await _files.UploadAsync("system", CurrentRelative, upload, replace, HttpContext.RequestAborted);"""
        self.assertIn(conflict_branch, code)

    def test_wallpaper_preview_and_csp(self):
        razor=(ROOT/'YrmPanel/Pages/Settings.cshtml').read_text()
        program=(ROOT/'YrmPanel/Program.cs').read_text()
        self.assertIn('<img class="v1-wallpaper-preview"',razor)
        self.assertIn("img-src 'self' data: blob:",program)

    def test_firewall_is_in_security_not_network(self):
        razor=(ROOT/'YrmPanel/Pages/Settings.cshtml').read_text()
        self.assertIn('("security", "Security"',razor)
        self.assertIn('activeTab == "security"',razor)
        self.assertIn('Save &amp; Apply',razor)

    def test_no_arbitrary_root_shell_api(self):
        service=(ROOT/'YrmPanel/Services/PrivilegedCommandService.cs').read_text()
        self.assertIn('ArgumentList.Add(action)',service)
        self.assertNotIn('"/bin/sh"',service)

