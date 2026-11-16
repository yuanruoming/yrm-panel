"""Boundary tests for privileged root-folder creation and scoped directory ACLs."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'yrm-panel-storage.py'
spec = importlib.util.spec_from_file_location('storage_helper', SCRIPT)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class StorageHelperTests(unittest.TestCase):
    def test_reject_reserved_system_directory_creation(self):
        for name in ('etc','home','usr','../home','a/b',''):
            with self.subTest(name=name), self.assertRaises(ValueError):
                helper.create_root(name)

    def test_system_directory_cannot_be_managed(self):
        with self.assertRaisesRegex(ValueError,'System folders'):
            helper.allowed_path('/etc')

    def test_symlink_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as dirname:
            parent = Path(dirname)
            (parent/'target').mkdir()
            (parent/'link').symlink_to(parent/'target')
            with self.assertRaisesRegex(ValueError,'Symbolic links'):
                helper.reject_links(str(parent/'link'))

    def test_explicit_grant_is_non_recursive_and_limited(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(helper,'allowed_path',return_value=folder), \
                 patch.object(helper,'is_real_backup',return_value=True), \
                 patch.object(helper,'user_info',return_value=SimpleNamespace(pw_name='test-user')), \
                 patch.object(helper,'registry',return_value=[]), \
                 patch.object(helper,'write_registry') as write, \
                 patch.object(helper.subprocess,'run') as run:
                helper.grant(folder)
                self.assertEqual(run.call_count,4)
                for call in run.call_args_list:
                    self.assertEqual(call.args[0][-1],folder)
                    self.assertIn(call.args[0][0],('setfacl',))
                write.assert_called_once_with([folder])

if __name__ == '__main__': unittest.main()
