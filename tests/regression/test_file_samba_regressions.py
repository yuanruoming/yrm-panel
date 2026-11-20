"""BETA8 follow-up checks. No real mounts, Samba settings, or user files modified."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, mock

ROOT = Path(__file__).resolve().parents[2]

def source(path):
    return (ROOT / path).read_text(encoding='utf-8')

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mount = load('yrm_beta8_fix_mount', 'scripts/yrm-panel-mount.py')
storage = load('yrm_beta8_fix_storage', 'scripts/yrm-panel-storage.py')

class VolumeOwnershipChecks(TestCase):
    def test_new_blank_numbered_ext4_volume_grants_single_root_only(self):
        with mock.patch.object(mount.os, 'listdir', return_value=['lost+found']), \
             mock.patch.object(mount.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='yuanruoming\n')), \
             mock.patch.object(mount.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1000, pw_gid=1000)), \
             mock.patch.object(mount.os, 'chown') as owner, \
             mock.patch.object(mount.os, 'chmod') as mode:
            self.assertTrue(mount.grant_owner_for_new_empty_volume(Path('/volume2'), {'fstype':'ext4'}))
            owner.assert_called_once_with(Path('/volume2'),1000,1000)
            mode.assert_called_once_with(Path('/volume2'),0o2770)

    def test_populated_volume_is_never_chowned(self):
        with mock.patch.object(mount.os, 'listdir', return_value=['lost+found','backup']), \
             mock.patch.object(mount.os, 'chown') as owner:
            self.assertFalse(mount.grant_owner_for_new_empty_volume(Path('/volume2'), {'fstype':'ext4'}))
            owner.assert_not_called()

    def test_home_path_must_not_chown_even_when_blank(self):
        with mock.patch.object(mount.os, 'listdir') as listing, \
             mock.patch.object(mount.os, 'chown') as owner:
            self.assertFalse(mount.grant_owner_for_new_empty_volume(Path('/home/yuanruoming'), {'fstype':'ext4'}))
            listing.assert_not_called()
            owner.assert_not_called()

    def test_existing_access_grant_is_acl_only_nonrecursive(self):
        with mock.patch.object(storage,'account',return_value=SimpleNamespace(pw_name='yuanruoming')), \
             mock.patch.object(storage,'reject_links'), \
             mock.patch.object(storage,'mount_ok',return_value=True), \
             mock.patch.object(storage.subprocess,'run') as execute, \
             mock.patch.object(storage.Path,'resolve',return_value=Path('/backup')), \
             mock.patch.object(storage.Path,'is_dir',return_value=True):
            self.assertEqual(storage.grant('/backup'), Path('/backup'))
            self.assertEqual(execute.call_count,2)
            commands=[call.args[0] for call in execute.call_args_list]
            self.assertEqual(commands[0],['setfacl','-m','u:yuanruoming:rwx','/backup'])
            self.assertEqual(commands[1],['setfacl','-m','d:u:yuanruoming:rwx','/backup'])
            self.assertNotIn('-R', str(commands))

class ProductChecks(TestCase):
    def test_storage_does_not_offer_whole_disk_share(self):
        ui=source('YrmPanel/Pages/Settings.cshtml')
        model=source('YrmPanel/Pages/Settings.cshtml.cs')
        self.assertNotIn('Share whole volume via SMB',ui)
        self.assertNotIn('asp-route-path="@partition.MountPoint.TrimStart',ui)
        self.assertNotIn('asp-page-handler="ShareVolume"',ui)
        self.assertIn('s.Path.StartsWith(root + "/"',model)
        self.assertIn('Unable to verify active SMB shares; unmount cancelled.',model)
        self.assertIn('/volume{index + 1}',model)

    def test_files_owns_share_and_existing_volume_can_be_enabled(self):
        ui=source('YrmPanel/Pages/Files.cshtml')
        model=source('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('asp-page-handler="Share"',ui)
        self.assertNotIn('Share this volume via SMB',ui)
        self.assertIn('v.MountPoint == absoluteParent',model)
        self.assertIn('_storage.RunAsync("grant", absoluteParent, adminPassword',model)
        self.assertIn('Model.FormatSize(item.Size)',ui)
        self.assertIn('title="@(item.IsDirectory ? "Folder" : $"{item.Size:N0} bytes")"',ui)

    def test_files_ignores_lost_found_without_deleting_it(self):
        files=source('YrmPanel/Services/FileManagerService.cs')
        samba=source('scripts/yrm-panel-samba.py')
        self.assertIn('entryName == "lost+found"',files)
        self.assertIn("'hide files': '/lost+found/'",samba)
        self.assertNotIn('rmtree',files)

    def test_confirmation_is_not_repeated_after_linux_password(self):
        panel=source('YrmPanel/wwwroot/js/panel.js')
        admin=source('YrmPanel/wwwroot/js/rc4-admin.js')
        confirm=source('YrmPanel/wwwroot/js/v1-confirm.js')
        self.assertNotIn('window.confirm(',panel)
        self.assertIn('form.dataset.yrmConfirmed = "1";',admin)
        self.assertIn("form.dataset.yrmConfirmed==='1'",confirm)

    def test_new_folder_tree_has_single_controller_and_fixed_layout(self):
        panel=source('YrmPanel/wwwroot/js/panel.js')
        stability=source('YrmPanel/wwwroot/js/v1-stability.js')
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        ui=source('YrmPanel/Pages/Files.cshtml')
        self.assertIn('async function listFolders(',panel)
        self.assertNotIn('drawFolderTree',stability)
        self.assertIn('#new-folder-dialog.explorer-dialog',css)
        self.assertIn('id="new-folder-parent-text"',ui)
        self.assertIn('name="parent" id="new-folder-parent"',ui)
        self.assertNotIn('readonly/>',ui)

if __name__ == '__main__':
    import unittest; unittest.main()
