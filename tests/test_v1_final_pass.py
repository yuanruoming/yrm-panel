"""Focused safety and behavior contracts for the v1 final usability pass.
No devices are formatted or modified by these tests.
"""
import importlib.util
import json
import pathlib
from unittest import TestCase, mock

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/yrm-panel-mount.py'
spec=importlib.util.spec_from_file_location('yrm_mount_final',SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def read(path):return (ROOT/path).read_text(encoding='utf-8')

class BlankDiskSafetyTests(TestCase):
    def test_device_name_is_restricted(self):
        for name in ['/dev/sda2','/dev/mapper/root','/etc/passwd','/dev/../sdb','/dev/loop0']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.identify_blank_disk(name)
    def test_format_requires_exact_confirmation_before_any_lookup(self):
        with mock.patch.object(module,'identify_blank_disk') as identify:
            with self.assertRaises(ValueError): module.initialize_blank_disk('/dev/sdb','ERASE /dev/sda')
            identify.assert_not_called()
    def test_partitioned_disk_is_blocked(self):
        data={'blockdevices':[{'path':'/dev/sdb','type':'disk','ro':False,'rm':False,
               'fstype':None,'uuid':None,'pttype':'gpt','mountpoints':[None],
               'children':[{'path':'/dev/sdb1','type':'part','mountpoints':[None]}]}]}
        with mock.patch.object(module.pathlib.Path,'exists',return_value=True), \
             mock.patch.object(module.os.path,'realpath',side_effect=lambda s:s), \
             mock.patch.object(module.os,'stat') as st, \
             mock.patch.object(module,'run',return_value=json.dumps(data)):
            st.return_value.st_mode=0o060000
            with self.assertRaisesRegex(ValueError,'partitioned|partitions'):
                module.identify_blank_disk('/dev/sdb')
    def test_present_signature_is_blocked(self):
        data={'blockdevices':[{'path':'/dev/sdb','type':'disk','ro':False,'rm':False,
               'fstype':None,'uuid':None,'pttype':None,'mountpoints':[None]}]}
        with mock.patch.object(module.pathlib.Path,'exists',return_value=True), \
             mock.patch.object(module.os.path,'realpath',side_effect=lambda s:s), \
             mock.patch.object(module.os,'stat') as st, \
             mock.patch.object(module,'run',return_value=json.dumps(data)), \
             mock.patch.object(module.shutil,'which',side_effect=lambda s:'/usr/bin/'+s), \
             mock.patch.object(module.subprocess,'run') as proc:
            st.return_value.st_mode=0o060000
            proc.return_value.returncode=0
            proc.return_value.stdout='gpt\n'
            with self.assertRaisesRegex(ValueError,'signature'):
                module.identify_blank_disk('/dev/sdb')
    def test_non_destructive_mount_remains_separate(self):
        s=read('scripts/yrm-panel-mount.py')
        self.assertIn('initialize_blank_disk',s)
        self.assertIn("sys.argv[1] == 'initialize'",s)
        self.assertIn('mkfs.ext4',s)
        self.assertIn('Only YRM Panel managed volumes',s)
        view=read('YrmPanel/Pages/Settings.cshtml')
        self.assertIn('Initialize Empty Disk',view)
        self.assertIn('data-requires-admin="Permanently erase selected blank disk"',view)
        self.assertIn('ERASE @disk.Path',view)

class UpdateContracts(TestCase):
    def test_real_bytes_or_indeterminate_only(self):
        installer=read('scripts/install.sh')
        self.assertIn('received*100/expected',installer)
        self.assertIn('stat -c %s',installer)
        self.assertIn('expected>0',installer)
        self.assertIn("progress Verifying",installer)
        self.assertIn("progress Restarting",installer)
        self.assertIn('YRM_PANEL_UPDATE_STATUS_FILE',installer)
    def test_update_completed_and_reload_explicit(self):
        script=read('scripts/update.sh')
        js=read('YrmPanel/wwwroot/js/v1-settings.js')
        self.assertIn("write_status completed 'YRM Panel updated successfully.' Completed 100",script)
        self.assertIn('Reload Panel',read('YrmPanel/Pages/Settings.cshtml'))
        self.assertIn('sessionStorage.removeItem(updatePendingKey)',js)
        self.assertIn('location.reload()',js)
        self.assertNotIn('location.reload();\n        }\n      }',js)
    def test_progress_dto_matches_json(self):
        cs=read('YrmPanel/Services/UpdateService.cs')
        self.assertIn('string? Phase = null, int? Percent = null',cs)

class VisualContracts(TestCase):
    def test_maximize_and_no_redundant_brand(self):
        css=read('YrmPanel/wwwroot/css/v1-stability.css')
        shell=read('YrmPanel/Pages/Shared/_Layout.cshtml')
        self.assertIn('.workspace-window.is-maximized',css)
        self.assertIn('height:calc(100dvh - 74px)',css)
        self.assertNotIn('yrm-topmark',shell)
        self.assertIn('href="~/favicon.ico"',shell)
    def test_media_player_is_own_ui_and_cleanup(self):
        js=read('YrmPanel/wwwroot/js/v1-files.js')
        self.assertIn("video.controls=false",js)
        self.assertIn("video.addEventListener('loadedmetadata'",js)
        self.assertIn("previewVideo.pause();",js)
        self.assertIn("previewVideo.removeAttribute('src');",js)
        self.assertIn("Fullscreen video",js)
        self.assertIn("formatTime",js)
    def test_uptime_shows_seconds_all_day(self):
        js=read('YrmPanel/wwwroot/js/rc4-monitor.js')
        self.assertIn('${d}d ${h}h ${m}m ${sec}s',js)
        self.assertIn('latestUptimeText',js)
    def test_cookie_is_rolling_not_permanent(self):
        login=read('YrmPanel/Pages/Account/Login.cshtml')
        cs=read('YrmPanel/Pages/Account/Login.cshtml.cs')
        self.assertIn('Keep me signed in',login)
        self.assertIn('DateTimeOffset.UtcNow.AddDays(30)',cs)
