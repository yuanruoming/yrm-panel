"""BETA5 safety regressions. ALL system-changing calls are mocked."""
import importlib.util
import json
import pathlib
import stat
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]

def load_script(filename):
    spec = importlib.util.spec_from_file_location(filename.replace('-', '_').replace('.py',''), ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mount = load_script('yrm-panel-mount.py')
firewall = load_script('yrm-panel-firewall.py')

def src(name): return (ROOT/name).read_text(encoding='utf-8')

class StorageTests(unittest.TestCase):
    def test_lsblk_tree_option_is_explicit_everywhere(self):
        script = src('scripts/yrm-panel-mount.py')
        self.assertEqual(script.count("'/usr/bin/lsblk', '-J', '--tree'"), 4)

    def test_recovery_reads_tree_not_flat_devices(self):
        data = {'blockdevices':[{'path':'/dev/sdb','type':'disk','pttype':'gpt',
            'ro':False,'rm':False,'size':'32212254720','mountpoints':[None],
            'children':[{'path':'/dev/sdb1','type':'part','fstype':None,'uuid':None,
            'mountpoints':[None],'partlabel':'primary','ro':False,'size':'32211206144'}]}]}
        calls=[]
        def fake_run(args,**kwargs):
            calls.append(args)
            return json.dumps(data)
        def fake_sub(args,**kwargs):
            from types import SimpleNamespace
            return SimpleNamespace(returncode=2 if 'blkid' in args[0] else 0,stdout='')
        with mock.patch.object(mount, 'run', side_effect=fake_run), \
             mock.patch.object(mount.pathlib.Path,'exists',return_value=True), \
             mock.patch.object(mount.os,'stat') as st, \
             mock.patch.object(mount.os.path,'realpath',side_effect=lambda x:x), \
             mock.patch.object(mount.subprocess,'run',side_effect=fake_sub):
            st.return_value.st_mode=stat.S_IFBLK
            self.assertEqual(mount.identify_recoverable_partition('/dev/sdb1'),'/dev/sdb')
        self.assertIn('--tree',calls[0])

class FirewallTests(unittest.TestCase):
    def setUp(self):
        self.rule = dict(scope='host',action='allow',port='445',protocol='tcp',source='any')

    def test_unavailable_ufw_refuses_mutation(self):
        with mock.patch.object(firewall,'ufw_status',return_value=(False,False,'Missing UFW')):
            with mock.patch.object(firewall,'run') as cmd:
                with self.assertRaisesRegex(ValueError,'unavailable'):
                    firewall.apply(json.dumps({'enabled':True,'rules':[self.rule]}))
                cmd.assert_not_called()

    def test_activation_must_schedule_guard_before_enable(self):
        calls=[]
        def fake_run(args,**kwargs):
            calls.append(('exec',args))
            return ''
        with mock.patch.object(firewall,'ufw_status',side_effect=[(True,False,'inactive'),(True,True,'active')]), \
             mock.patch.object(firewall,'run',side_effect=fake_run), \
             mock.patch.object(firewall,'preserve_remote_access',side_effect=lambda:calls.append(('preserve',None))), \
             mock.patch.object(firewall,'schedule_rollback',side_effect=lambda:calls.append(('schedule',None)) or 'f'*48), \
             mock.patch.object(firewall,'write_state'):
            message=firewall.apply(json.dumps({'enabled':True,'rules':[self.rule]}))
        self.assertIn('Confirm connectivity', message)
        guard=next(i for i,x in enumerate(calls) if x[0]=='schedule')
        enable=next(i for i,x in enumerate(calls) if x[0]=='exec' and x[1][-1]=='enable')
        self.assertLess(guard,enable)
        self.assertLess(next(i for i,x in enumerate(calls) if x[0]=='preserve'),enable)

    def test_failure_before_rollback_scheduling_never_enables(self):
        calls=[]
        with mock.patch.object(firewall,'ufw_status',return_value=(True,False,'inactive')), \
             mock.patch.object(firewall,'run',side_effect=lambda args,**k:calls.append(args) or ''), \
             mock.patch.object(firewall,'preserve_remote_access'), \
             mock.patch.object(firewall,'schedule_rollback',side_effect=ValueError('No systemd-run')):
            with self.assertRaisesRegex(ValueError,'No systemd-run'):
                firewall.apply(json.dumps({'enabled':True,'rules':[]}))
        self.assertNotIn('enable',[a[-1] for a in calls])

    def test_confirmation_checks_nonce_and_active_ufw(self):
        token='a'*48
        with mock.patch.object(firewall,'pending_state',return_value={'nonce':token}), \
             mock.patch.object(firewall,'ufw_status',return_value=(True,True,'active')), \
             mock.patch.object(pathlib.Path,'unlink') as remove:
            self.assertIn('confirmed', firewall.confirm_activation(token))
            remove.assert_called_once()
        with mock.patch.object(firewall,'pending_state',return_value={'nonce':token}):
            with self.assertRaisesRegex(ValueError,'matching pending'):
                firewall.confirm_activation('b'*48)

    def test_unconfirmed_activation_rolls_back(self):
        calls=[]
        with mock.patch.object(firewall,'pending_state',return_value={'nonce':'a'*48,'wasActive':False}), \
             mock.patch.object(firewall,'run',side_effect=lambda args,**k:calls.append(args) or ''), \
             mock.patch.object(pathlib.Path,'unlink'):
            self.assertIn('rolled back',firewall.rollback_activation())
        self.assertIn([firewall.UFW,'--force','disable'],calls)

    def test_install_preserves_one_password_per_apply(self):
        install=src('scripts/install.sh')
        self.assertIn('/usr/local/libexec/yrm-panel-firewall apply',install)
        self.assertIn('/usr/local/libexec/yrm-panel-firewall confirm *',install)

class DdnsContracts(unittest.TestCase):
    def test_existing_profiles_have_optional_fields_and_no_ui_secret(self):
        service=src('YrmPanel/Services/DdnsService.cs')
        self.assertIn('string DetectionUrl = ""',service)
        self.assertIn('string ResponseMode = "legacy"',service)
        view=service.split('public sealed record DdnsProfileView(')[1].split(');',1)[0]
        self.assertNotIn('string Token',view)

    def test_provider_response_does_not_treat_http200_as_automatic_success(self):
        service=src('YrmPanel/Services/DdnsService.cs')
        self.assertIn('if (profile.ResponseMode == "http") return "Updated";',service)
        self.assertIn('CodeMatch(profile.ErrorCodes, code)',service)
        self.assertIn('CodeMatch(profile.UnchangedCodes, code)',service)
        self.assertIn('returned.ToString().Equals(expectedIp',service)

    def test_detect_update_verify_are_separate_and_background_is_rate_limited(self):
        service=src('YrmPanel/Services/DdnsService.cs')
        for text in ('DetectAsync(', 'VerifyAsync(', 'UpdateAsync(', 'NextAttemptAt',
                     'ConnectCallback', 'IsPublic', 'DetectIpAsync', 'VerifyDnsAsync'):
            self.assertIn(text,service)
        self.assertIn('return "Not due."',service)

    def test_dynu_template_and_advanced_custom_ui(self):
        view=src('YrmPanel/Pages/Settings.cshtml')
        script=src('YrmPanel/wwwroot/js/v1-settings.js')
        for key in ('detectionUrl','authType','responseMode','successCodes',
                    'unchangedCodes','errorCodes','verifyDns'):
            self.assertIn('name="'+key+'"',view)
        self.assertIn('api-ipv4.dynu.com',script)
        self.assertIn('api-ipv6.dynu.com',script)
        self.assertIn('yrm-ddns-new-form',view)

if __name__=='__main__':unittest.main()
