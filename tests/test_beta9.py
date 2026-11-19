"""BETA9 regression checks; real mount/smb interactions still require an isolated Ubuntu VM."""
import importlib.util
import pathlib
import shutil
import subprocess
import unittest
from unittest.mock import patch, Mock

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('yrm_b9_mount', ROOT/'scripts/yrm-panel-mount.py')
mount=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mount)

def source(relative):
    return (ROOT/relative).read_text(encoding='utf-8')


class UnmountSafety(unittest.TestCase):
    def test_uuid_validation_rejects_wrong_volume(self):
        with patch.object(mount.subprocess,'run',return_value=Mock(returncode=0,stdout='wrong-uuid\n')):
            with self.assertRaisesRegex(ValueError,'identity or mount location changed'):
                mount.verify_mounted_uuid('/volume2','expected-uuid')

    def test_uuid_validation_accepts_mounted_volume(self):
        with patch.object(mount.subprocess,'run',return_value=Mock(returncode=0,stdout='expected-uuid\n')):
            mount.verify_mounted_uuid('/volume2','expected-uuid')

    def test_busy_volume_never_modifies_fstab_or_tracking(self):
        entry='UUID=uuid-1234 /volume2 ext4 defaults 0 2 # yrm-panel-managed:uuid-1234\n'
        with patch.object(mount,'path_check',return_value=pathlib.Path('/volume2')), \
             patch.object(mount,'verify_mounted_uuid') as identity, \
             patch.object(mount,'fstab_lines',return_value=[entry]), \
             patch.object(mount,'manual_mounts',return_value=[]), \
             patch.object(mount,'describe_busy_volume',return_value='Volume is in use by: 150 smbd.'), \
             patch.object(mount.subprocess,'run',return_value=Mock(returncode=32,stderr='umount: target is busy')) as proc, \
             patch.object(mount,'replace_fstab') as replace, \
             patch.object(mount,'write_manual') as write:
            with self.assertRaisesRegex(ValueError,'smbd'):
                mount.unmount('/volume2','uuid-1234')
            identity.assert_called_once_with('/volume2','uuid-1234')
            proc.assert_called_once()
            self.assertEqual(proc.call_args.args[0], ['/usr/bin/umount','/volume2'])
            replace.assert_not_called()
            write.assert_not_called()

    def test_busy_probe_is_read_only(self):
        with patch.object(mount.shutil,'which',side_effect=lambda x:'/usr/bin/'+x), \
             patch.object(mount.subprocess,'run',side_effect=[
                 Mock(returncode=0,stdout=' 124 125 ',stderr=''),
                 Mock(returncode=0,stdout=' 124 smbd\n 125 rsync\n',stderr='')]) as run:
            info=mount.describe_busy_volume('/volume2')
            self.assertIn('smbd',info)
            self.assertIn('rsync',info)
            self.assertEqual(run.call_args_list[0].args[0],['/usr/bin/fuser','-m','/volume2'])
            self.assertNotIn('-k',repr(run.call_args_list))


class ProductContracts(unittest.TestCase):
    def test_disks_and_volumes_are_distinct(self):
        ui=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('>Volumes</h3>',ui)
        self.assertIn('>Physical Disks</h3>',ui)
        self.assertIn('name="uuid" value="@volume.Uuid"',ui)
        self.assertEqual(ui.count('asp-page-handler="Unmount"'),1)

    def test_ddns_ui_is_modal_and_direct(self):
        ui=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('id="yrm-b9-ddns-add"',ui)
        self.assertIn('data-b9-ddns-check',ui)
        self.assertNotIn('DdnsConnection',ui)
        self.assertNotIn('DdnsToggle',ui)
        self.assertNotIn('Hybrid monitoring',ui)
        js=source('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn("'X-Requested-With':'XMLHttpRequest'",js)
        self.assertIn('data-b9-secret-toggle',ui)

    def test_unshare_does_not_warn_or_toast(self):
        ui=source('YrmPanel/Pages/Files.cshtml')
        self.assertNotIn('data-confirm="Stop sharing ',ui)
        cs=source('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('Notice = message.StartsWith("Error:"',cs)

    def test_update_has_real_steps_and_http_health(self):
        ui=source('YrmPanel/Pages/Settings.cshtml')
        install=source('scripts/install.sh')
        self.assertIn('yrm-b9-update-stages',ui)
        self.assertIn('https://127.0.0.1:$HTTPS_PORT/Account/Login',install)
        self.assertIn('trap finish_update EXIT',source('scripts/update.sh'))

    @unittest.skipUnless(shutil.which('node'), 'Node.js is not installed')
    def test_frontend_syntax(self):
        completed=subprocess.run(['node','--check',str(ROOT/'YrmPanel/wwwroot/js/v1-stability.js')],
                                 capture_output=True,text=True)
        self.assertEqual(completed.returncode,0,completed.stderr)

if __name__=='__main__':unittest.main()
