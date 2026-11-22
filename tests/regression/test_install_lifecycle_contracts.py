"""Source guards for the install/update/uninstall safety work.
Behaviour is proven by tests/lifecycle/lifecycle.sh (real root install on CI)."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


class InstallLifecycleContracts(unittest.TestCase):
    def test_sudoers_is_validated_before_it_becomes_live(self):
        install = read('scripts/install.sh')
        validate = install.index('visudo -cf "$sudoers_tmp"')
        move = install.index('mv -f -- "$sudoers_tmp" /etc/sudoers.d/yrm-panel')
        self.assertLess(validate, move)
        self.assertIn('mktemp /etc/sudoers.d/.yrm-panel.XXXXXX', install)
        # The live policy is checked after the atomic move, never written in place.
        self.assertGreater(install.index('visudo -cf /etc/sudoers.d/yrm-panel'), move)
        self.assertNotIn('>/etc/sudoers.d/yrm-panel <<', install)
        # A broken runner image must not be reported as a product regression.
        self.assertIn('sudoers_baseline_ok=0', install)
        self.assertIn('the existing sudoers configuration already fails visudo -c', install)

    def test_failed_upgrade_restores_helpers_sudoers_units_and_program(self):
        install = read('scripts/install.sh')
        for managed in ('/etc/sudoers.d/yrm-panel', '/usr/local/libexec/yrm-panel-firewall',
                        '/etc/systemd/system/yrm-panel.service', '/usr/local/sbin/yrm-panel-update',
                        '/etc/pam.d/yrm-panel', '/etc/yrm-panel/panel.env',
                        '/etc/yrm-panel/source.env', '/etc/yrm-panel/samba-user'):
            self.assertIn(managed, install[:install.index('trap cleanup EXIT')])
        self.assertIn('trap cleanup EXIT', install)
        # Back up before the first host mutation (config files are now written
        # after the verified release has been extracted).
        backup = install.index('backup_managed_files')
        self.assertLess(backup, install.index('/etc/pam.d/yrm-panel <<'))
        self.assertLess(install.index('rollback_armed=1'), install.index('mv -f -- "$sudoers_tmp"'))
        self.assertIn('rollback_armed=0', install[install.index('health_ok == 0'):])

    def test_failed_first_install_removes_only_what_it_created(self):
        install = read('scripts/install.sh')
        self.assertIn('fresh_install=1', install)
        self.assertIn('systemctl disable yrm-panel.service yrm-panel-firewall-restore.service', install)
        self.assertIn('docker_group_added=1', install)
        self.assertIn('gpasswd -d "$PANEL_USER" docker', install)

    def test_update_uses_the_verified_tarball_installer(self):
        update = read('scripts/update.sh')
        self.assertNotIn('raw.githubusercontent.com', update)
        self.assertIn('release.json.minisig', update)
        self.assertIn('verify_release_signature', update)
        self.assertIn('deployment/install.sh', update)
        self.assertIn('--local-dir', update)
        self.assertIn('--allow-unsigned', update)
        install = read('scripts/install.sh')
        self.assertIn('MINISIGN_PUBKEYS=(', install)
        self.assertIn('release_keys_configured', install)
        self.assertIn('--allow-unsigned', install)

    def test_older_previous_directory_is_never_swapped_in_by_mistake(self):
        install = read('scripts/install.sh')
        self.assertIn('if ((app_swapped == 1)) && [[ -d /opt/yrm-panel.previous ]]', install)
        self.assertIn('app_swapped=1', install[install.index('mv /opt/yrm-panel /opt/yrm-panel.previous'):])

    def test_local_release_option_is_cli_only_and_validated(self):
        install = read('scripts/install.sh')
        self.assertIn('--local-dir) LOCAL_DIR="${2:?}"', install)
        self.assertIn('--local-dir must be an existing absolute directory.', install)
        self.assertNotIn('YRM_PANEL_LOCAL', install)

    def test_uninstall_removes_helpers_and_sudoers_by_pattern(self):
        uninstall = read('scripts/uninstall.sh')
        self.assertIn('rm -f /usr/local/libexec/yrm-panel-*', uninstall)
        self.assertIn('/etc/sudoers.d/yrm-panel-*', uninstall)
        self.assertIn('/etc/sudoers.d/.yrm-panel.*', uninstall)
        self.assertIn('Linux accounts, files, Docker, and Samba shares remain.', uninstall)

    def test_release_is_published_only_after_e2e_and_lifecycle_pass(self):
        release = read('.github/workflows/dev-release.yml')
        self.assertIn('needs: [e2e, lifecycle]', release)
        self.assertIn('uses: ./.github/workflows/ci-lifecycle.yml', release)
        lifecycle = read('.github/workflows/ci-lifecycle.yml')
        self.assertIn('workflow_call:', lifecycle)
        self.assertIn('bash tests/lifecycle/lifecycle.sh', lifecycle)


if __name__ == '__main__':
    unittest.main()
