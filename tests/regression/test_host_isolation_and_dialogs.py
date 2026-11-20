"""BETA7 source and privileged-helper contract checks; NOT a VM mount test."""
import unittest
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
ROOT = Path(__file__).resolve().parents[2]

def source(path):
    return (ROOT / path).read_text(encoding='utf-8')

spec = importlib.util.spec_from_file_location('yrm_beta7_mount', ROOT/'scripts/yrm-panel-mount.py')
mount = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mount)

class StorageHostIsolation(unittest.TestCase):
    def test_host_dispatch_has_no_local_fallback(self):
        code=source('scripts/yrm-panel-mount.py')
        self.assertIn("'--system', '--quiet', '--wait', '--pipe', '--collect'", code)
        self.assertIn('dispatch_in_host_mount_namespace()', code)
        self.assertIn('Host storage operation failed', code)
    def test_correct_findmnt_no_mount_is_normal(self):
        code=source('scripts/yrm-panel-mount.py')
        self.assertIn("'--mountpoint', mount_point", code)
        self.assertIn('if found.returncode != 1:', code)
    def test_host_dispatch_preserves_result(self):
        fake=SimpleNamespace(returncode=0,stdout='{"ok": true, "message": "Mounted"}\n',stderr='')
        with patch.object(mount.os,'geteuid',return_value=0),patch.object(mount.shutil,'which',return_value='/usr/bin/systemd-run'),patch.object(mount.pathlib.Path,'exists',return_value=True),patch.object(mount.subprocess,'run',return_value=fake) as runner,patch.object(mount,'emit'):
            with self.assertRaises(SystemExit) as result:
                mount.dispatch_in_host_mount_namespace()
        self.assertEqual(result.exception.code,0)
        args=runner.call_args.args[0]
        self.assertEqual(args[1],'--system')
        self.assertIn('--setenv=YRM_PANEL_HOST_MOUNT_HELPER=1',args)
    def test_host_dispatch_refuses_failures(self):
        fake=SimpleNamespace(returncode=1,stdout='',stderr='bad')
        with patch.object(mount.os,'geteuid',return_value=0),patch.object(mount.shutil,'which',return_value='/usr/bin/systemd-run'),patch.object(mount.pathlib.Path,'exists',return_value=True),patch.object(mount.subprocess,'run',return_value=fake),patch.object(mount,'emit') as emit:
            with self.assertRaises(SystemExit) as result:
                mount.dispatch_in_host_mount_namespace()
        self.assertEqual(result.exception.code,1)
        self.assertIn('Host storage operation failed',emit.call_args.args[1])

class DdnsAndDialogs(unittest.TestCase):
    def test_saved_provider_secrets_not_emitted_in_profile_view(self):
        code=source('YrmPanel/Services/DdnsService.cs')
        view=code.split('public sealed record DdnsProfileView(')[1].split(');',1)[0]
        self.assertNotIn('string Token',view)
        self.assertIn('EditAsync(',code)
        self.assertIn('Token = newToken.Length > 0 ? newToken : old.Token',code)
    def test_current_domain_groups_and_edit(self):
        ui=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('GroupBy(p => new { Provider',ui)
        self.assertIn('asp-page-handler="DdnsEditGroup"',ui)
        self.assertNotIn('Test & Update',ui)
        self.assertIn('Update Now',ui)
        self.assertIn('asp-page-handler="DdnsGroupCheck"',ui)
    def test_one_custom_confirmation_for_all_forms(self):
        ui=source('YrmPanel/Pages/Shared/_Layout.cshtml')
        js=source('YrmPanel/wwwroot/js/v1-confirm.js')
        self.assertIn('id="yrm-action-confirm"',ui)
        self.assertIn("window.addEventListener('submit'",js)
        self.assertIn('form.requestSubmit(',js)
        self.assertIn('delete form.dataset.confirm',js)
        self.assertNotIn('window.confirm(',source('YrmPanel/wwwroot/js/v1-files.js'))
        self.assertNotIn('window.alert(',source('YrmPanel/wwwroot/js/v1-settings.js'))

if __name__ == '__main__':
    unittest.main()

class NewEmptyVolumeOwnership(unittest.TestCase):
    def test_existing_data_never_chowned(self):
        with patch.object(mount.os,'listdir',return_value=['lost+found','Photos']),patch.object(mount.os,'chown') as chown:
            self.assertFalse(mount.grant_owner_for_new_empty_volume(Path('/data'),{'fstype':'ext4'}))
        chown.assert_not_called()
    def test_other_mounts_never_chowned(self):
        with patch.object(mount.os,'chown') as chown:
            self.assertFalse(mount.grant_owner_for_new_empty_volume(Path('/home/yuanruoming'),{'fstype':'ext4'}))
        chown.assert_not_called()
