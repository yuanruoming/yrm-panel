"""BETA8: mocked host SMB integration tests; no real Samba/host writes."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'yrm-panel-samba.py'
spec = importlib.util.spec_from_file_location('yrm_beta8_samba', SCRIPT)
samba = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samba)


class HostSambaTests(unittest.TestCase):
    def dispatch(self, argv, result, stdin=''):
        out = io.StringIO()
        with mock.patch.object(samba.sys, 'argv', ['yrm-panel-samba', *argv]), \
             mock.patch.dict(samba.os.environ, {}, clear=True), \
             mock.patch.object(samba.os, 'geteuid', return_value=0), \
             mock.patch.object(samba.shutil, 'which', return_value='/usr/bin/systemd-run'), \
             mock.patch.object(samba.pathlib.Path, 'is_dir', return_value=True), \
             mock.patch.object(samba.sys, 'stdin', io.StringIO(stdin)), \
             mock.patch.object(samba.subprocess, 'run', return_value=result) as spawn, \
             contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as state:
                samba.host_dispatch()
        return state.exception.code, json.loads(out.getvalue()), spawn

    def test_save_uses_host_worker_and_preserves_json(self):
        response = SimpleNamespace(returncode=0, stdout='{"ok":true,"message":"SMB share saved."}\n', stderr='')
        code, output, spawn = self.dispatch(['save','Data','/data','false'], response)
        self.assertEqual(code, 0)
        self.assertTrue(output['ok'])
        command = spawn.call_args.args[0]
        self.assertEqual(command[1:5], ['--system','--quiet','--wait','--pipe'])
        self.assertIn('--setenv=YRM_PANEL_SAMBA_HOST_WORKER=1', command)
        self.assertEqual(command[-4:], ['save','Data','/data','false'])
        self.assertEqual(spawn.call_args.kwargs['input'], None)

    def test_password_transferred_via_stdin_not_argv(self):
        response = SimpleNamespace(returncode=0, stdout='{"ok":true,"message":"Password configured."}', stderr='')
        code, output, spawn = self.dispatch(['set-password'], response, 'private-smb-password\n')
        self.assertEqual(code, 0)
        self.assertTrue(output['ok'])
        self.assertNotIn('private-smb-password', ' '.join(spawn.call_args.args[0]))
        self.assertEqual(spawn.call_args.kwargs['input'], 'private-smb-password\n')

    def test_host_failure_does_not_attempt_local_mutation(self):
        response = SimpleNamespace(returncode=1, stdout='{"ok":false,"message":"testparm rejected configuration"}', stderr='')
        code, output, spawn = self.dispatch(['delete', 'Data'], response)
        self.assertEqual(code, 1)
        self.assertFalse(output['ok'])
        self.assertIn('testparm', output['message'])
        self.assertEqual(spawn.call_count, 1)

    def test_invalid_read_only_value_is_rejected_before_spawn(self):
        out = io.StringIO()
        with mock.patch.object(samba.sys, 'argv', ['helper','save','Data','/data','garbage']), \
             mock.patch.dict(samba.os.environ, {}, clear=True), \
             mock.patch.object(samba.os, 'geteuid', return_value=0), \
             mock.patch.object(samba.subprocess, 'run') as spawn, \
             contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as state:
                samba.host_dispatch()
        self.assertEqual(state.exception.code, 1)
        spawn.assert_not_called()

    def test_atomic_write_preserves_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'smb.conf'
            path.write_bytes(b'old')
            path.chmod(0o640)
            samba.atomic_bytes(path, b'new')
            self.assertEqual(path.read_bytes(), b'new')
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_failed_reload_restores_previous_shares(self):
        with tempfile.TemporaryDirectory() as folder:
            main = pathlib.Path(folder) / 'smb.conf'
            managed = pathlib.Path(folder) / 'shares.conf'
            main.write_text('[global]\n')
            original = b'[Original]\npath = /data\n'
            managed.write_bytes(original)
            config = samba.configparser.ConfigParser(interpolation=None)
            config.add_section('New')
            config.set('New','path','/data')
            with mock.patch.object(samba, 'MAIN', main), \
                 mock.patch.object(samba, 'MANAGED', managed), \
                 mock.patch.object(samba, 'run', side_effect=['[global]\n[New]\n', ValueError('reload failed'), '[global]\n', 'ok']) as shell:
                with self.assertRaises(ValueError):
                    samba.save_config(config)
                self.assertEqual(shell.call_count, 4)
            self.assertEqual(managed.read_bytes(), original)

    def test_bootstrap_moves_existing_beta7_include_to_last_global_option(self):
        with tempfile.TemporaryDirectory() as folder:
            main = pathlib.Path(folder) / 'smb.conf'
            managed = pathlib.Path(folder) / 'shares.conf'
            original = ('[global]\n   include = /etc/samba/yrm-panel-shares.conf\n'
                        '   server role = standalone server\n[printers]\n   printable = yes\n')
            main.write_text(original)
            managed.write_text('# managed\n')
            with mock.patch.object(samba, 'MAIN', main), \
                 mock.patch.object(samba, 'MANAGED', managed), \
                 mock.patch.object(samba, 'run', return_value='OK'):
                samba.bootstrap()
                updated = main.read_text()
                self.assertIn('server role = standalone server\n\n    include = /etc/samba/yrm-panel-shares.conf\n\n[printers]', updated)
                self.assertLess(updated.index('server role = standalone server'), updated.index('include = /etc/samba/yrm-panel-shares.conf'))
                self.assertLess(updated.index('include = /etc/samba/yrm-panel-shares.conf'), updated.index('[printers]'))
                self.assertEqual(updated.count('include = /etc/samba/yrm-panel-shares.conf'), 1)
                samba.bootstrap()
                self.assertEqual(main.read_text(), updated)

    def test_files_no_longer_require_my_folders_registration(self):
        text = (ROOT/'YrmPanel/Pages/Files.cshtml.cs').read_text()
        self.assertNotIn('Add the folder to My Folders before sharing it.', text)
        self.assertIn('_files.IsManaged(full)', text)

    def test_storage_volume_share_has_server_side_discovery(self):
        model = (ROOT/'YrmPanel/Pages/Settings.cshtml.cs').read_text()
        view = (ROOT/'YrmPanel/Pages/Settings.cshtml').read_text()
        self.assertIn('OnPostShareVolumeAsync(', model)
        self.assertIn('IsShareableVolume(item)', model)
        self.assertIn('OnPostUnshareVolumeAsync(', model)
        self.assertIn('asp-page-handler="ShareVolume"', view)
        self.assertIn('asp-page-handler="UnshareVolume"', view)

    def test_testparm_must_include_requested_share(self):
        with tempfile.TemporaryDirectory() as folder:
            main = pathlib.Path(folder) / 'smb.conf'
            managed = pathlib.Path(folder) / 'shares.conf'
            main.write_text('[global]\n')
            original = b'[Old]\npath = /data\n'
            managed.write_bytes(original)
            config = samba.configparser.ConfigParser(interpolation=None)
            config.add_section('New')
            config.set('New', 'path', '/data')
            with mock.patch.object(samba, 'MAIN', main), \
                 mock.patch.object(samba, 'MANAGED', managed), \
                 mock.patch.object(samba, 'run', return_value='[global]\n') as shell:
                with self.assertRaisesRegex(ValueError, 'activate'):
                    samba.save_config(config)
            self.assertEqual(managed.read_bytes(), original)
            self.assertEqual(shell.call_count, 3)  # failed validation, rollback validate/reload

    def test_unshare_requires_absence_in_testparm(self):
        with tempfile.TemporaryDirectory() as folder:
            main = pathlib.Path(folder) / 'smb.conf'
            managed = pathlib.Path(folder) / 'shares.conf'
            main.write_text('[global]\n')
            original = b'[Data]\npath = /data\n'
            managed.write_bytes(original)
            config = samba.configparser.ConfigParser(interpolation=None)
            with mock.patch.object(samba, 'MAIN', main), \
                 mock.patch.object(samba, 'MANAGED', managed), \
                 mock.patch.object(samba, 'run', return_value='[global]\n[Data]\n'):
                with self.assertRaisesRegex(ValueError, 'activate'):
                    samba.save_config(config, removed_names=('Data',))
            self.assertEqual(managed.read_bytes(), original)

    def test_control_chars_in_share_path_rejected(self):
        with self.assertRaisesRegex(ValueError, 'normal absolute path'):
            samba.validate_path('/data\n[Injected]', False)

if __name__ == '__main__':
    unittest.main()
