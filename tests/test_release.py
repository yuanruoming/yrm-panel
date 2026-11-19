"""RC4 static safety checks; no root or Ubuntu VM required."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parents[1]

class ReleaseSafetyTests(unittest.TestCase):
    def test_installer_does_not_create_user_data(self):
        s = (ROOT/'scripts/install.sh').read_text()
        self.assertNotIn('install -d /data', s)
        self.assertNotIn('install -d /backup', s)
        self.assertIn('--user|--file-user', s)
        self.assertNotIn('useradd --system', s)
    def test_linux_service_selected_user(self):
        s = (ROOT/'packaging/yrm-panel.service').read_text()
        self.assertIn('User=@PANEL_USER@', s)
        self.assertIn('ProtectHome=false', s)
        self.assertIn('AF_NETLINK', s)
    def test_passworded_helpers(self):
        s = (ROOT/'scripts/install.sh').read_text()
        self.assertIn('PASSWD:', s)
        self.assertIn('NOPASSWD: /usr/local/libexec/yrm-panel-samba list', s)
        self.assertNotIn('NOPASSWD: ALL', s)
    def test_login_monitor(self):
        s = (ROOT/'YrmPanel/Program.cs').read_text()
        self.assertIn('/api/metrics/stream', s)
        self.assertIn('CookieSecurePolicy.Always', s)
        self.assertIn('LinuxPamAuthenticator', s)
    def test_release_bundle(self):
        s = (ROOT/'.github/workflows/dev-release.yml').read_text()
        self.assertIn('yrm-panel-update-trigger.sh', s)
        self.assertIn('yrm-panel-update-trigger.sh', (ROOT/'scripts/install.sh').read_text())
    def test_project_version_is_valid_semver(self):
        # One version contract for all betas and stable releases; no hard-coded beta number.
        project = ET.parse(ROOT / 'YrmPanel/YrmPanel.csproj')
        version = project.findtext('.//Version') or ''
        self.assertRegex(version, r'^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$')

    def test_removed_settings_pages_are_not_exposed(self):
        # BETA10 removes read-only Services and the duplicate File Sharing settings page.
        settings = (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text()
        self.assertNotIn('("services", "Services",', settings)
        self.assertNotIn('("sharing", "File Sharing",', settings)
        shell = (ROOT / 'YrmPanel/Pages/Shared/_Layout.cshtml').read_text()
        self.assertNotIn('asp-page="/Services" class="launcher-app"', shell)
if __name__ == '__main__': unittest.main()
