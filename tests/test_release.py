"""RC4 static safety checks; no root or Ubuntu VM required."""
from pathlib import Path
import unittest
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
    def test_services_moved(self):
        s = (ROOT/'YrmPanel/Pages/Settings.cshtml').read_text()
        self.assertIn('"services", "Services"', s)
        self.assertNotIn('asp-page="/Services" class="launcher-app"',
                         (ROOT/'YrmPanel/Pages/Shared/_Layout.cshtml').read_text())
if __name__ == '__main__': unittest.main()
