from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
import tempfile
from unittest import TestCase
ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location('yrm_samba', ROOT/'scripts/yrm-panel-samba.py')
samba = module_from_spec(spec); spec.loader.exec_module(samba)
class SambaPathTests(TestCase):
    def test_reserved_system_paths_are_rejected(self):
        for name in ('/etc','/root','/usr','/opt','/'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                samba.validate_path(name, False)
    def test_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            actual=Path(tmp)/'real';actual.mkdir()
            alias=Path(tmp)/'alias';alias.symlink_to(actual,target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'Symlink'):
                samba.validate_path(str(alias),False)
    def test_short_password_rejected(self):
        with self.assertRaises(ValueError): samba.set_password('short')
if __name__=='__main__':
    import unittest; unittest.main()
