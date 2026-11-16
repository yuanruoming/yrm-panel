"""Static distribution invariants, run before pushing a release."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ReleaseSafetyTests(unittest.TestCase):
    def test_no_user_data_directories_created_by_installer(self):
        script = (ROOT / 'scripts/install.sh').read_text()
        self.assertNotIn('install -d /data', script)
        self.assertNotIn('install -d /backup', script)
        self.assertIn('yrm-panel-storage.py', script)

    def test_systemd_supports_dynamic_data_directories(self):
        unit = (ROOT / 'packaging/yrm-panel.service').read_text()
        self.assertIn('ProtectSystem=full', unit)
        self.assertNotIn('ReadWritePaths=/data', unit)
        self.assertIn('CAP_DAC_OVERRIDE', unit)

    def test_both_install_and_uninstall_manage_storage_helper(self):
        self.assertIn('yrm-panel-storage', (ROOT/'scripts/install.sh').read_text())
        self.assertIn('yrm-panel-storage', (ROOT/'scripts/uninstall.sh').read_text())
        self.assertIn('yrm-panel-storage.py', (ROOT/'.github/workflows/dev-release.yml').read_text())

    def test_explorer_does_not_allow_public_root_mutations(self):
        service = (ROOT/'YrmPanel/Services/FileManagerService.cs').read_text()
        self.assertIn('ResolveWritable', service)
        self.assertIn('Symbolic links cannot be opened', service)

if __name__ == '__main__': unittest.main()
