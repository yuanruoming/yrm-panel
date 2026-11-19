"""BETA6 regression tests (Linux helpers mocked, no real device is modified)."""
import importlib.util
import pathlib
import stat
import unittest
from types import SimpleNamespace
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]

def source(path):
    return (ROOT/path).read_text(encoding='utf-8')

spec = importlib.util.spec_from_file_location('yrm_mount', ROOT/'scripts/yrm-panel-mount.py')
mount = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mount)

class DiskRecoveryTests(unittest.TestCase):
    def result(self, device, status=0, stdout=''):
        if 'wipefs' in device[0]:
            self.assertIn('--output', device)
            self.assertIn('TYPE', device)
            self.assertNotIn('-o', device)
            self.assertNotIn('-O', device)
            self.assertIn('--no-act', device)
            return SimpleNamespace(returncode=status, stdout=stdout)
        self.assertIn('-p',device)
        self.assertIn('-s',device)
        self.assertIn('TYPE',device)
        self.assertIn('-o',device)
        self.assertIn('value',device)
        return SimpleNamespace(returncode=status, stdout=stdout)

    def mock_recover(self, blkid_code=0, blkid_text='', wipefs_text=''):
        """User's QEMU /dev/sdb1: GPT only, no filesystem TYPE."""
        import json
        devices={'blockdevices':[{'path':'/dev/sdb','type':'disk','pttype':'gpt',
            'ro':False,'rm':False,'fstype':None,'uuid':None,'size':'32212254720',
            'mountpoints':[None], 'children':[{'path':'/dev/sdb1','type':'part',
             'fstype':None,'uuid':None,'partlabel':'primary','size':'32211206144',
             'mountpoints':[None], 'ro':False}]}]}
        def sub(args, **kwargs):
            if 'blkid' in args[0]:
                return self.result(args,blkid_code,blkid_text)
            return self.result(args,0,wipefs_text if args[-1]=='/dev/sdb1' else 'gpt\nPMBR')
        return [mock.patch.object(mount,'run',return_value=json.dumps(devices)),
            mock.patch.object(mount.pathlib.Path,'exists',return_value=True),
            mock.patch.object(mount.os,'stat',return_value=SimpleNamespace(st_mode=stat.S_IFBLK)),
            mock.patch.object(mount.os.path,'realpath',side_effect=lambda v:v),
            mock.patch.object(mount.subprocess,'run',side_effect=sub)]

    def verify(self, **kwargs):
        from contextlib import ExitStack
        with ExitStack() as ctx:
            for patcher in self.mock_recover(**kwargs):ctx.enter_context(patcher)
            return mount.identify_recoverable_partition('/dev/sdb1')

    def test_blank_gpt_partition_metadata_is_not_a_filesystem(self):
        self.assertEqual(self.verify(blkid_code=0,blkid_text=''),'/dev/sdb')

    def test_blkid_no_signatures_code_2_is_allowed(self):
        self.assertEqual(self.verify(blkid_code=2),'/dev/sdb')

    def test_existing_ext4_rejected(self):
        with self.assertRaisesRegex(ValueError,'signature'):
            self.verify(wipefs_text='ext4')

    def test_filesystem_type_rejected_even_when_blkid_exit_zero(self):
        with self.assertRaisesRegex(ValueError,'filesystem'):
            self.verify(blkid_code=0,blkid_text='ext4')

    def test_device_probe_error_rejected(self):
        with self.assertRaisesRegex(ValueError,'safely inspected'):
            self.verify(blkid_code=8,blkid_text='')

class DdnsContracts(unittest.TestCase):
    def test_cloudflare_separate_client_preserves_record(self):
        code=source('YrmPanel/Services/CloudflareDdnsClient.cs')
        for text in ('HttpMethod.Get','HttpMethod.Patch','dns_records?type=',
                     'name.exact=', 'new { type = record.Type, name = record.Hostname, content = newIp }',
                     'record.Content.Equals(newIp', 'profile.Token'):
            self.assertIn(text,code)
        self.assertNotIn('HttpMethod.Post',code)
        self.assertNotIn('HttpMethod.Delete',code)

    def test_ddns_profile_retains_legacy_storage_defaults(self):
        code=source('YrmPanel/Services/DdnsService.cs')
        self.assertIn('string Provider = "custom"',code)
        self.assertIn('Provider: provider',code)
        view=code.split('public sealed record DdnsProfileView(')[1].split(');')[0]
        self.assertNotIn('string Token',view)
        self.assertIn('profile.Provider == "cloudflare"',code)

    def test_hybrid_events_debounce_and_timer(self):
        code=source('YrmPanel/Services/DdnsService.cs')
        for key in ('NetworkChange.NetworkAddressChanged',
                    'NetworkChange.NetworkAvailabilityChanged',
                    'ArgumentList.Add("route")','Channel.CreateBounded<bool>',
                    'TimeSpan.FromSeconds(45)','TimeSpan.FromSeconds(10)',
                    'PeriodicTimer(TimeSpan.FromMinutes(1))',
                    'bool networkTriggered = false', '!networkTriggered'):
            self.assertIn(key,code)

    def test_dynu_basic_username_visible_and_required(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        js=source('YrmPanel/wwwroot/js/v1-settings.js')
        self.assertIn('data-ddns-auth="basic"',view)
        self.assertIn('Username is required for HTTP Basic',source('YrmPanel/Services/DdnsService.cs'))
        self.assertIn("input.required=!node.hidden&&auth==='basic'",js)
        self.assertIn("field('provider','dynu')",js)
        self.assertIn("field('provider','cloudflare')",js)

    def test_update_has_distinct_available_and_running_states(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        js=source('YrmPanel/wwwroot/js/v1-settings.js')
        prog=source('YrmPanel/Program.cs')
        self.assertIn('Update Available',view)
        self.assertIn("active?'Updating'",js)
        self.assertIn("available?'Update Available'",js)
        self.assertIn('availability = updates.LastCheck',prog)

    def test_beta6_version(self):
        self.assertRegex(source('YrmPanel/YrmPanel.csproj'), r'<Version>1\.0\.0-beta\.[67]</Version>')

if __name__ == '__main__':unittest.main()
