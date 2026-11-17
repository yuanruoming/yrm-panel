from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
from unittest import TestCase
ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location('yrm_storage', ROOT/'scripts/yrm-panel-storage.py')
storage = module_from_spec(spec); spec.loader.exec_module(storage)
class StorageHelperTests(TestCase):
    def test_folder_names(self):
        self.assertIsNotNone(storage.FOLDER.fullmatch('data'))
        self.assertIsNone(storage.FOLDER.fullmatch('../etc'))
        self.assertIsNone(storage.FOLDER.fullmatch('.hidden/dir'))
    def test_system_paths_reserved(self):
        for x in ('etc','root','usr','home','var','proc'): self.assertIn(x,storage.RESERVED)
if __name__=='__main__':
    import unittest; unittest.main()
