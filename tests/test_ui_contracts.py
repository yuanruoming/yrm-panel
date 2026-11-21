"""Current UI contracts. They deliberately avoid pinning a beta version number.
These source checks are additive to real Linux integration testing, not a replacement.
"""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]

def source(path):
    return (ROOT / path).read_text(encoding='utf-8')

class DesktopUiContracts(unittest.TestCase):
    def test_ddns_is_one_full_width_row_per_provider_and_domain(self):
        view = source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('<table class="yrm-b11-table yrm-b11-ddns-table">', view)
        self.assertIn('<th>Provider</th><th>Domain</th><th>IPv4</th><th>IPv6</th>', view)
        self.assertNotIn('<th>Last Update</th>', view)
        self.assertIn('<tr class="yrm-b11-ddns-row" data-b9-ddns-provider=', view)
        self.assertIn('asp-page-handler="DdnsUpdateAll"', view)
        self.assertIn('asp-page-handler="DdnsDeleteGroup"', view)
        self.assertNotIn('class="yrm-ddns-group"', view)

    def test_ddns_edit_preserves_both_record_controls_and_credentials(self):
        view = source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('asp-page-handler="DdnsAddGroup"', view)
        self.assertIn('asp-page-handler="DdnsEditGroup"', view)
        # Edit form: IPv4 and IPv6 must use their respective field names.
        self.assertIn(
            'name="@(suffix == "4" ? "ipv4Enabled" : "ipv6Enabled")"',
            view
        )
        # Add form: the same field mapping must be preserved.
        self.assertIn(
            'name="@(family.Suffix == "4" ? "ipv4Enabled" : "ipv6Enabled")"',
            view
        )
        self.assertIn('Leave empty to keep saved credential', view)
        self.assertIn('yrm-b11-toggle-line', view)
        self.assertIn('yrm-b11-switch', view)
        self.assertNotIn('<label>Profile name', view)

    def test_file_context_actions_are_shared_not_duplicated(self):
        view=source('YrmPanel/Pages/Files.cshtml')
        script=source('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn('yrm-b11-quick-menu', view)
        self.assertIn('Unpin from Quick Access', view)
        self.assertNotIn('class="yrm-b10-unpin"',view)
        self.assertIn("addEventListener('contextmenu'",script)
        self.assertIn("summary.click()",script)
        self.assertIn("source.click()",script)

    def test_firewall_uses_existing_backend_and_rollback_semantics(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        script=source('YrmPanel/wwwroot/js/v1-stability.js')
        self.assertIn('id="v1-firewall-form"',view)
        self.assertIn('id="v1-firewall-rules"',view)
        self.assertIn('id="v1-fw-json"',view)
        self.assertIn('asp-page-handler="FirewallConfirm"',view)
        self.assertIn('id="yrm-b11-fw-body"',view)
        self.assertIn('id="yrm-b11-fw-dialog"',view)
        self.assertIn("querySelector('[data-fw-add]')",script)

    def test_selector_fallback_and_keyboard(self):
        script=source('YrmPanel/wwwroot/js/v1-stability.js')
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertIn('select.dispatchEvent(new Event(\'change\'',script)
        self.assertIn('ArrowDown',script)
        self.assertIn('yrm-b11-select-toggle',css)
        self.assertIn('select[data-b11-enhanced]',css)

    def test_flat_application_layouts_have_no_card_within_card(self):
        settings=source('YrmPanel/Pages/Settings.cshtml')
        files=source('YrmPanel/Pages/Files.cshtml')
        docker=source('YrmPanel/Pages/Docker.cshtml')
        self.assertNotIn('class="surface-card',settings)
        self.assertNotIn('class="v1-settings-panel',settings)
        self.assertNotIn('DDNS Profiles</h3>',settings)
        self.assertIn('yrm-ddns-header-actions',settings)
        self.assertNotIn('("accounts", "Accounts",',settings)
        self.assertNotIn('class="surface-card',files)
        self.assertNotIn('class="surface-card',docker)
        self.assertIn('yrm-docker-table',docker)

    def test_single_shell_route_and_taskbar(self):
        script=source('YrmPanel/wwwroot/js/panel.js')
        files=source('YrmPanel/Pages/Files.cshtml')
        self.assertIn('yrmPanelRoute:url',script)
        self.assertIn('history.pushState({yrmPanelRoute:url}, "", "/")',script)
        self.assertNotIn('history.pushState(null, "", url)',script)
        self.assertNotIn('taskbar-tab-close',script)
        self.assertIn('button.append(svg,label)',script)
        self.assertIn('data-b12-file-download',files)
        self.assertIn('asp-route-nav="quick"',files)
        self.assertIn('asp-route-nav="library"',files)

    def test_firewall_and_update_preserve_semantics(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        script=source('YrmPanel/wwwroot/js/v1-stability.js')
        controller=source('YrmPanel/wwwroot/js/v1-settings.js')
        self.assertIn('data-b11-fw-source-mode',view)
        self.assertIn('data-b11-fw-field="source" placeholder="192.168.0.0/24" disabled',view)
        self.assertIn("mode.value=source.toLowerCase()==='any'?'any':'custom'",script)
        self.assertIn("values.source=d.querySelector('[data-b11-fw-source-mode]')?.value==='any'?'any':values.source",script)
        self.assertNotIn('id="yrm-b9-update-stages"',view)
        self.assertIn('phaseNames[phase]',controller)

    @unittest.skipUnless(shutil.which('node'), 'Node not installed')
    def test_javascript_syntax(self):
        result=subprocess.run(['node','--check',str(ROOT/'YrmPanel/wwwroot/js/v1-stability.js')],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':
    unittest.main()
