"""Pure-Python tests for the privileged Samba helper input boundaries.
Run: python3 -m unittest discover -s tests -v
"""
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

HELPER = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'yrm-panel-samba.py'
spec = importlib.util.spec_from_file_location('samba_adapter', HELPER)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class SambaPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.temp.name)
        self.data = self.base / 'data'
        self.backup = self.base / 'backup'
        self.data.mkdir()
        self.backup.mkdir()
        (self.data / 'downloads').mkdir()
        self.patcher = patch.object(helper, 'ROOTS', (self.data, self.backup))
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def test_directory_within_data_is_allowed(self):
        self.assertEqual(helper.validate_path(str(self.data / 'downloads')),
                         str(self.data / 'downloads'))

    def test_sibling_prefix_is_not_allowed(self):
        sibling = self.base / 'data-escape'
        sibling.mkdir()
        with self.assertRaisesRegex(ValueError, 'Only /data'):
            helper.validate_path(str(sibling))

    def test_symlink_escape_is_blocked(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (self.data / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symbolic links'):
            helper.validate_path(str(self.data / 'link'))

    def test_backup_unmounted_is_blocked(self):
        with self.assertRaisesRegex(ValueError, 'not mounted'):
            helper.validate_path(str(self.backup))

    def test_share_name_injection_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Invalid share name'):
            helper.update_share('[global]\nadmin users = root', str(self.data), False)

    def test_existing_share_is_visible_but_not_managed(self):
        managed = self.base / 'yrm-shares.conf'
        managed.write_text('[own]\npath = /data/own\nread only = no\n')
        output = '[global]\n    server min protocol = SMB2\n\n[own]\n  path = /data/own\n\n[Manual]\n  path = /data/manual\n  read only = Yes\n'
        with patch.object(helper, 'MANAGED', managed), patch.object(helper, 'run', return_value=output):
            rows = helper.list_shares()
        self.assertEqual(len(rows), 2)
        self.assertTrue(next(x for x in rows if x['name'] == 'own')['managed'])
        external = next(x for x in rows if x['name'] == 'Manual')
        self.assertFalse(external['managed'])
        self.assertTrue(external['readOnly'])

    def test_bootstrap_preserves_existing_share(self):
        original = '[global]\n  server min protocol = SMB2\n\n[Downloads]\n  path = /DATA/Downloads\n'
        config = self.base / 'smb.conf'
        managed = self.base / 'yrm-shares.conf'
        config.write_text(original)
        with patch.object(helper, 'MAIN', config), patch.object(helper, 'MANAGED', managed), \
             patch.object(helper, 'run', return_value=''):
            helper.bootstrap()
            self.assertIn('[Downloads]', config.read_text())
            self.assertIn('include = /etc/samba/yrm-panel-shares.conf', config.read_text())
            helper.bootstrap()  # idempotent
            self.assertEqual(config.read_text().count('include = /etc/samba/yrm-panel-shares.conf'), 1)


if __name__ == '__main__':
    unittest.main()
