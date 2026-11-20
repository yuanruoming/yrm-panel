"""Firewall UI assertions without pretending unsupported Docker networking is protected."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]

def source(path):
    return (ROOT / path).read_text(encoding="utf-8")

class FirewallContracts(unittest.TestCase):
    def test_existing_scope_and_user_source_fields_survive(self):
        view=source("YrmPanel/Pages/Settings.cshtml")
        self.assertIn('<option value="host">Host (UFW)</option>', view)
        self.assertIn('<option value="docker">Docker</option>', view)
        self.assertIn('data-b11-fw-source-mode', view)
        self.assertIn('data-b11-fw-field="source"', view)
    def test_existing_helper_and_scope_limitations_are_honest(self):
        js=source("YrmPanel/wwwroot/js/v1-stability.js")
        self.assertIn('not a general outbound rule', js)
        self.assertIn('Docker published ports may use another path', js)
        view=source("YrmPanel/Pages/Settings.cshtml")
        self.assertIn('Docker: separate supported IPv4 iptables rules', view)

if __name__ == '__main__':
    unittest.main()
