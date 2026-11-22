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
        # The live file must never be written or checked in place.
        self.assertNotIn('visudo -cf /etc/sudoers.d/yrm-panel', install)
        self.assertNotIn('>/etc/sudoers.d/yrm-panel <<', install)

    def test_failed_upgrade_restores_helpers_sudoers_units_and_program(self):
        install = read('scripts/install.sh')
        for managed in ('/etc/sudoers.d/yrm-panel', '/usr/local/libexec/yrm-panel-firewall',
                        '/etc/systemd/system/yrm-panel.service', '/usr/local/sbin/yrm-panel-update'):
            self.assertIn(managed, install[:install.index('trap cleanup EXIT')])
        self.assertIn('trap cleanup EXIT', install)
        self.assertLess(install.index('backup_managed_files\n  rollback_armed=1'),
                        install.index('/usr/local/libexec/yrm-panel-samba\n'))
        self.assertLess(install.index('rollback_armed=1'), install.index('mv -f -- "$sudoers_tmp"'))
        self.assertIn('rollback_armed=0', install[install.index('health_ok == 0'):])

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
