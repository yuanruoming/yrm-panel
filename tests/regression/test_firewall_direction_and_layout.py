"""Firewall direction and compact-layout regressions (no real host operations)."""
import importlib.util
import json
from pathlib import Path
from unittest import TestCase, mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('fw_direction', ROOT / 'scripts/yrm-panel-firewall.py')
fw = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fw)

class FirewallDirectionTests(TestCase):
    def rule(self, **changes):
        value = {'scope':'host', 'direction':'inbound', 'action':'allow',
                 'port':'443', 'protocol':'tcp', 'source':'any', 'remarks':'HTTPS'}
        value.update(changes)
        return value

    def test_old_rule_without_direction_or_remarks_loads_as_inbound(self):
        rule = self.rule()
        del rule['direction']; del rule['remarks']
        normalized = fw.validate(rule)
        self.assertEqual(normalized['direction'], 'inbound')
        self.assertEqual(normalized['remarks'], '')
        self.assertEqual(fw.ufw_args(normalized, '443'),
                         ['allow', 'from', 'any', 'to', 'any', 'port', '443', 'proto', 'tcp'])

    def test_outbound_uses_destination_and_deletion_is_symmetric(self):
        rule = fw.validate(self.rule(direction='outbound', source='1.1.1.1'))
        self.assertEqual(fw.ufw_args(rule, '443'),
                         ['allow', 'out', 'to', '1.1.1.1/32', 'port', '443', 'proto', 'tcp'])
        with mock.patch.object(fw, 'run') as runner:
            fw.install_rule(rule)
            self.assertIn('out', runner.call_args.args[0])
            fw.delete_rule(rule)
            self.assertEqual(runner.call_args.args[0][:3], [fw.UFW, '--force', 'delete'])
            self.assertIn('out', runner.call_args.args[0])

    def test_outbound_docker_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Docker outbound'):
            fw.validate(self.rule(scope='docker', direction='outbound'))

    def test_duplicate_inbound_and_outbound_ports_do_not_collide(self):
        with mock.patch.object(fw, 'run', return_value=''), \
             mock.patch.object(fw, 'ufw_status', return_value=(True, True, 'Status: active')), \
             mock.patch.object(fw, 'load', return_value=[]), \
             mock.patch.object(fw, 'write_state') as saved:
            fw.apply(json.dumps([self.rule(), self.rule(direction='outbound')]))
            self.assertEqual(len(saved.call_args.args[0]), 2)

    def test_inbound_ssh_safety_preserved(self):
        with self.assertRaisesRegex(ValueError, 'Refusing'):
            fw.validate(self.rule(action='deny', port='22', direction='inbound'))
        # Unlike inbound blocking, outbound rules do not block inbound SSH.
        fw.validate(self.rule(action='deny', port='22', direction='outbound'))

    def test_remark_control_characters_are_invalid(self):
        with self.assertRaisesRegex(ValueError, 'Remarks'):
            fw.validate(self.rule(remarks='bad\nvalue'))

class FirewallInterfaceTests(TestCase):
    def test_single_status_and_save_cancel_actions(self):
        view = (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text()
        self.assertEqual(view.count('id="yrm-fw-enabled"'), 1)
        self.assertIn('data-b11-fw-discard', view)
        self.assertIn('>Done</button>', view)
        self.assertIn('>Direction<select', view)
        self.assertNotIn('Firewall Rules</strong>', view)
        self.assertNotIn('Host: UFW · Docker:', view)

    def test_frontend_backend_contract_both_store_direction_and_remarks(self):
        js = (ROOT / 'YrmPanel/wwwroot/js/v1-settings.js').read_text()
        helper = (ROOT / 'scripts/yrm-panel-firewall.py').read_text()
        service = (ROOT / 'YrmPanel/Services/FirewallService.cs').read_text()
        self.assertIn("field('direction'", js)
        self.assertIn("direction = value.get('direction', 'inbound')", helper)
        self.assertIn('string Direction = "inbound"', service)
        self.assertIn('remarks=x.Remarks', (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text())

    def test_network_editor_not_silently_added(self):
        view = (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text()
        self.assertNotIn('OnPostNetworkEdit', view)

    def test_file_navigation_defaults_collapsed(self):
        view = (ROOT / 'YrmPanel/Pages/Files.cshtml').read_text()
        self.assertIn('id="yrm-my-files-children" hidden', view)
        self.assertIn('data-my-files-toggle', view)
        self.assertNotIn('<div class="fm-locations-heading">FILES</div>', view)
