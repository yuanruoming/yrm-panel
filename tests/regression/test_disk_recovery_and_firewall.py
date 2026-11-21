"""BETA4 regression contracts. Never execute mount/partition/firewall mutations on the host."""
import importlib.util
import json
import pathlib
import stat
from types import SimpleNamespace
from unittest import TestCase, mock

ROOT = pathlib.Path(__file__).resolve().parents[2]

def load_script(name):
    path = ROOT / 'scripts' / name
    spec = importlib.util.spec_from_file_location(name.replace('-', '_').removesuffix('.py'), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

mount = load_script('yrm-panel-mount.py')
firewall = load_script('yrm-panel-firewall.py')

def source(path):
    return (ROOT/path).read_text(encoding='utf-8')

BLANK_PARTITION = {
    'blockdevices': [
        {'path':'/dev/sdb','type':'disk','ro':False,'rm':False,'pttype':'gpt',
         'fstype':None,'uuid':None,'mountpoints':[None],'size':'32212254720',
         'children':[{'path':'/dev/sdb1','type':'part','ro':False,'fstype':None,
                      'uuid':None,'mountpoints':[None],'partlabel':'primary','size':'32211206144'}]}
    ]
}

class DiskRecoverySafety(TestCase):
    def identify(self, data=BLANK_PARTITION, sig=False):
        def fake_subprocess(args, **kw):
            if 'wipefs' in args[0]:
                return SimpleNamespace(returncode=0,stdout='ext4\n' if sig else '')
            return SimpleNamespace(returncode=2,stdout='')
        with mock.patch.object(mount.pathlib.Path,'exists',return_value=True), \
             mock.patch.object(mount.os,'stat') as st, \
             mock.patch.object(mount.os.path,'realpath',side_effect=lambda x:x), \
             mock.patch.object(mount,'run',return_value=json.dumps(data)), \
             mock.patch.object(mount.subprocess,'run',side_effect=fake_subprocess):
            st.return_value.st_mode=stat.S_IFBLK
            return mount.identify_recoverable_partition('/dev/sdb1')

    def test_beta3_single_unformatted_gpt_partition_is_recoverable(self):
        self.assertEqual(self.identify(),'/dev/sdb')

    def test_reject_unrecognized_signature(self):
        with self.assertRaisesRegex(ValueError,'signature'):
            self.identify(sig=True)

    def test_reject_mounted_or_used_partition(self):
        data=json.loads(json.dumps(BLANK_PARTITION))
        data['blockdevices'][0]['children'][0]['mountpoints']=['/data']
        with self.assertRaisesRegex(ValueError,'Mounted'):
            self.identify(data)

    def test_reject_multiple_partitions(self):
        data=json.loads(json.dumps(BLANK_PARTITION))
        data['blockdevices'][0]['children'].append({'path':'/dev/sdb2','type':'part'})
        with self.assertRaisesRegex(ValueError,'exactly one'):
            self.identify(data)

    def test_reject_system_disk_with_mounted_root(self):
        data=json.loads(json.dumps(BLANK_PARTITION))
        data['blockdevices'][0]['mountpoints']=['/']
        with self.assertRaisesRegex(ValueError,'Mounted'):
            self.identify(data)

    def test_recovery_needs_exact_confirmation_before_lookup(self):
        with mock.patch.object(mount,'identify_recoverable_partition') as lookup:
            with self.assertRaisesRegex(ValueError,'Type FORMAT'):
                mount.complete_setup('/dev/sdb1','FORMAT /dev/sda2')
            lookup.assert_not_called()

    def test_initialization_still_requires_exact_erase_confirmation(self):
        with mock.patch.object(mount,'identify_blank_disk') as lookup:
            with self.assertRaisesRegex(ValueError,'Type ERASE'):
                mount.initialize_blank_disk('/dev/sdb','ERASE /dev/sda')
            lookup.assert_not_called()

    def test_helper_format_only_after_double_check(self):
        s=source('scripts/yrm-panel-mount.py')
        self.assertIn('identify_recoverable_partition(partition)\n    identify_recoverable_partition(partition)',s)
        self.assertIn("elif len(sys.argv) == 4 and sys.argv[1] == 'complete'",s)
        self.assertIn('verify_ext4(partition)',s)
        self.assertIn("shutil.which('partprobe')",s)

class FirewallPortSpec(TestCase):
    def rule(self,port,**extra):
        return dict(scope='host',action='allow',port=port,protocol='tcp',source='192.168.0.5',**extra)
    def test_single_legacy_int_normalized(self):
        self.assertEqual(firewall.validate(self.rule(80))['port'],'80')
    def test_list_and_range(self):
        self.assertEqual(firewall.parse_ports('80,81,443')[1],[(80,80),(81,81),(443,443)])
        self.assertEqual(firewall.port_arguments(self.rule('20-442')),['20:442'])
        self.assertEqual(firewall.validate(self.rule('20-442'))['source'],'192.168.0.5/32')
    def test_reject_unsafe_and_overlap(self):
        for bad in ['6080-6082','22,80','1-65536','80,80','20-50,45-60','abc','80;rm -rf /']:
            with self.subTest(port=bad):
                if bad in ('6080-6082','22,80'):
                    with self.assertRaises(ValueError): firewall.validate(dict(scope='host',action='deny',port=bad,protocol='tcp',source='any'))
                else:
                    with self.assertRaises(ValueError): firewall.parse_ports(bad)
    def test_list_generates_multiple_ufw_rule_invocations(self):
        calls=[]
        with mock.patch.object(firewall,'run',side_effect=lambda a, **kw: calls.append(a) or ''):
            firewall.install_rule(self.rule('80,443'))
        self.assertEqual(len(calls),2)
        self.assertIn('80',calls[0]);self.assertIn('443',calls[1])

class UiIntegration(TestCase):
    def test_folder_location_picker_uses_selected_parent_even_in_nested_folders(self):
        files=source('YrmPanel/Pages/Files.cshtml')
        model=source('YrmPanel/Pages/Files.cshtml.cs')
        js=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('id="yrm-folder-volume"',files)
        self.assertIn('id="new-folder-tree"',files)
        self.assertIn('id="new-folder-parent"',files)
        self.assertNotIn('Model.CanSelectStorage',files)
        self.assertNotIn('var fixedLocation =',model)
        self.assertIn('var normalizedParent = (parent ?? string.Empty).Trim',model)
        self.assertIn('_files.CreateFolder("system", normalizedParent, name)',model)
        self.assertIn('parent.value=data.path',js)
        self.assertIn('createFolderTreeNode(',js)
        self.assertIn('revealFolderTree(',js)
        self.assertIn("listFolders('')",js)
        self.assertNotIn('This folder will be created in the current location',files)
        self.assertNotIn('Parent location</span>',files)
        self.assertNotIn('Double-click to open',files)
        # Existing custom upload remains functional from My Files.
        self.assertIn('class="fm-visually-hidden" id="fm-root-upload-file" type="file"',files)
        self.assertIn('data-file-picker="fm-root-upload-file"',files)
        self.assertIn('id="fm-root-upload-name" class="muted" aria-live="polite"',files)
        picker_js=source('YrmPanel/wwwroot/js/rc41-ui.js')
        self.assertIn("field.id === 'fm-upload-file' || field.id === 'fm-root-upload-file'",picker_js)
        self.assertIn("field.files?.[0]?.name || 'No file selected'",picker_js)
    def test_image_only_shows_after_decode_and_private_revalidation(self):
        js=source('YrmPanel/wwwroot/js/v1-files.js')
        cs=source('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('await view.decode()',js)
        self.assertIn('view.classList.remove(\'yrm-image-loading\')',js)
        self.assertIn('private, no-cache',cs)
        self.assertIn('EnableRangeProcessing = true',cs)
        self.assertIn('EntityTag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue(etag)',cs)
        self.assertIn('LastModified = new DateTimeOffset(',cs)
        self.assertNotIn('Request.Headers["If-None-Match"]',cs)
    def test_update_completed_acknowledgement_removes_100_percent(self):
        js=source('YrmPanel/wwwroot/js/v1-settings.js')
        self.assertIn("available?'Update Available'",js)
        self.assertIn('const awaitingReload=completed&&pending',js)
        self.assertIn('bar.hidden=!(active||awaitingReload)',js)
    def test_firewall_input_describes_cidr_and_ranges(self):
        view=source('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('Source IP / CIDR',view)
        self.assertIn('20-442',view)
        self.assertIn('Complete Incomplete Setup',view)

