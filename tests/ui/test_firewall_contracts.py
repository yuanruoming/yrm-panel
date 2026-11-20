"""Firewall UI/backend contracts for the current compact inbound/outbound editor.

These tests check current behavior rather than obsolete explanatory copy.
No host firewall commands are executed.
"""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def firewall_module():
    spec = importlib.util.spec_from_file_location(
        "yrm_firewall_ui_contract", ROOT / "scripts/yrm-panel-firewall.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FirewallContracts(unittest.TestCase):
    def test_current_editor_retains_backends_and_address_fields(self):
        view = source("YrmPanel/Pages/Settings.cshtml")
        self.assertIn('<option value="host">Ubuntu (UFW)</option>', view)
        self.assertIn('<option value="docker">Docker (IPv4 inbound)</option>', view)
        self.assertIn('data-b11-fw-field="direction"', view)
        self.assertIn('<option value="outbound">Outbound</option>', view)
        self.assertIn('data-b11-fw-source-mode', view)
        self.assertIn('data-b11-fw-field="source"', view)
        self.assertIn('data-b11-fw-discard', view)
        self.assertIn('data-b11-fw-save', view)

    def test_host_outbound_targets_destination_not_inbound_source(self):
        fw = firewall_module()
        outbound = fw.validate({
            "scope": "host", "direction": "outbound", "action": "allow",
            "port": "443", "protocol": "tcp", "source": "1.1.1.1"
        })
        self.assertEqual(
            fw.ufw_args(outbound, "443"),
            ["allow", "out", "to", "1.1.1.1/32", "port", "443", "proto", "tcp"]
        )
        inbound = fw.validate({
            "scope": "host", "action": "allow", "port": "1433",
            "protocol": "tcp", "source": "any"
        })
        self.assertEqual(inbound["direction"], "inbound")
        self.assertEqual(
            fw.ufw_args(inbound, "1433"),
            ["allow", "from", "any", "to", "any", "port", "1433", "proto", "tcp"]
        )

    def test_docker_outbound_is_rejected_and_backend_checked(self):
        fw = firewall_module()
        with self.assertRaisesRegex(ValueError, "Docker outbound filtering is not supported"):
            fw.validate({
                "scope": "docker", "direction": "outbound", "action": "deny",
                "port": "443", "protocol": "tcp", "source": "any"
            })
        backend = source("scripts/yrm-panel-firewall.py")
        self.assertIn("def docker_backend_check():", backend)
        self.assertIn("if data.get('firewall-backend') == 'nftables':", backend)
        self.assertIn("run([IPTABLES, '-S', 'DOCKER-USER'])", backend)
        view = source("YrmPanel/Pages/Settings.cshtml")
        self.assertIn('Docker outbound filtering is not supported here.', view)


if __name__ == "__main__":
    unittest.main()
