#!/usr/bin/env python3
"""Batch-managed UFW and Docker iptables firewall rules.

Only rules in /etc/yrm-panel/firewall.json are modified. Docker interception is
supported only when DOCKER-USER exists; otherwise requested Docker changes fail.
"""
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

STATE = pathlib.Path('/etc/yrm-panel/firewall.json')
IPTABLES = '/usr/sbin/iptables'
IP6TABLES = '/usr/sbin/ip6tables'
UFW = '/usr/sbin/ufw'


def run(cmd, timeout=20):
    process = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if process.returncode != 0:
        raise ValueError(f'{pathlib.Path(cmd[0]).name} failed: {process.stderr.strip()[:180]}')
    return process.stdout.strip()



def parse_ports(raw):
    """Return normalized spec and bounded (start,end) segments. No shell parsing."""
    if type(raw) is int:
        raw = str(raw)
    if not isinstance(raw, str) or len(raw) > 120:
        raise ValueError('Port must be a number, list (80,443) or range (20-442).')
    parts = raw.replace(' ', '').split(',')
    if not 1 <= len(parts) <= 20:
        raise ValueError('Use at most 20 port entries per rule.')
    spans = []
    for part in parts:
        matched = re.fullmatch(r'([0-9]{1,5})(?:-([0-9]{1,5}))?', part)
        if not matched:
            raise ValueError('Use single ports, comma lists or a dash range.')
        lo = int(matched.group(1))
        hi = int(matched.group(2) or lo)
        if not (1 <= lo <= hi <= 65535):
            raise ValueError('Port numbers must be between 1 and 65535.')
        spans.append((lo, hi))
    for index, (lo, hi) in enumerate(spans):
        if any(lo <= previous_hi and hi >= previous_lo for previous_lo, previous_hi in spans[:index]):
            raise ValueError('Overlapping ports are not supported in one rule.')
    return ','.join(str(lo) if lo == hi else f'{lo}-{hi}' for lo, hi in spans), spans


def port_arguments(rule):
    _, spans = parse_ports(rule['port'])
    return [str(lo) if lo == hi else f'{lo}:{hi}' for lo, hi in spans]

def validate(value):
    if not isinstance(value, dict): raise ValueError('Invalid firewall rule.')
    scope = value.get('scope')
    action = value.get('action')
    port = value.get('port')
    proto = value.get('protocol')
    source = value.get('source') or 'any'
    if scope not in ('host', 'docker') or action not in ('allow', 'deny', 'lan'):
        raise ValueError('Unsupported firewall scope or action.')
    if proto not in ('tcp', 'udp'):
        raise ValueError('Protocol must be TCP or UDP.')
    port, spans = parse_ports(port)
    if scope == 'host' and action == 'lan': raise ValueError('Use a source network for host rules.')
    if scope == 'docker' and source != 'any': raise ValueError('Docker rules use a preset LAN scope.')
    if source != 'any':
        try: source = str(ipaddress.ip_network(source, strict=False))
        except ValueError: raise ValueError('Source must be a valid IPv4/IPv6 CIDR.')
    if scope == 'host' and action == 'deny' and any(
            low <= protected <= high for low, high in spans for protected in (22, 6080, 6081)):
        raise ValueError('Refusing to block SSH or Panel management ports.')
    return {'scope':scope, 'action':action, 'port':port, 'protocol':proto, 'source':source}


def load():
    if not STATE.exists(): return []
    data = json.loads(STATE.read_text(encoding='utf-8'))
    if not isinstance(data, list): raise ValueError('Stored firewall rules are invalid.')
    return [validate(rule) for rule in data]


def ufw_args(rule, port):
    return [rule['action'], 'from', rule['source'], 'to', 'any', 'port', port, 'proto', rule['protocol']]


def docker_backend_check():
    settings = pathlib.Path('/etc/docker/daemon.json')
    if settings.exists():
        data = json.loads(settings.read_text(encoding='utf-8'))
        if data.get('firewall-backend') == 'nftables':
            raise ValueError('Docker nftables backend detected. Docker rules not applied; use the compatible backend.')
    run([IPTABLES, '-S', 'DOCKER-USER'])
    # A Docker nftables setup often lacks this iptables chain; fail instead of claiming protection.


def docker_specs(rule):
    if rule['action'] == 'allow': return []
    proto = rule['protocol']
    result = []
    for port in port_arguments(rule):
        main = ['-p', proto, '-m', 'conntrack', '--ctorigdstport', port]
        if rule['action'] == 'deny':
            result.append((IPTABLES, main + ['-j', 'DROP']))
        else:
            # Current Docker LAN preset is RFC1918 IPv4 only.
            result.extend((IPTABLES, main + ['-s', cidr, '-j', 'RETURN']) for cidr in
                         ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
            result.append((IPTABLES, main + ['-j', 'DROP']))
    return result


def install_rule(rule):
    if rule['scope'] == 'host':
        for port in port_arguments(rule):
            run([UFW] + ufw_args(rule, port) + ['comment', 'YRM-Panel'])
    elif rule['action'] != 'allow':
        docker_backend_check()
        for executable, spec in docker_specs(rule):
            run([executable, '-A', 'YRM-PANEL', *spec])


def delete_rule(rule):
    if rule['scope'] == 'host':
        for port in port_arguments(rule):
            run([UFW, '--force', 'delete'] + ufw_args(rule, port))
    # Docker rules are handled together by rebuilding our managed chain.


def ensure_chain():
    docker_backend_check()
    try: run([IPTABLES, '-S', 'YRM-PANEL'])
    except ValueError: run([IPTABLES, '-N', 'YRM-PANEL'])
    result = run([IPTABLES, '-S', 'DOCKER-USER'])
    if '-j YRM-PANEL' not in result:
        run([IPTABLES, '-I', 'DOCKER-USER', '1', '-j', 'YRM-PANEL'])
    run([IPTABLES, '-F', 'YRM-PANEL'])
    # RETURN at end lets Docker continue its normal flow.
    run([IPTABLES, '-A', 'YRM-PANEL', '-j', 'RETURN'])


def apply(payload):
    if len(payload) > 16384: raise ValueError('Too many firewall rules.')
    data = json.loads(payload)
    if not isinstance(data, list) or len(data) > 50: raise ValueError('Maximum 50 rules.')
    new = [validate(rule) for rule in data]
    ids = [(r['scope'],r['protocol'],r['port'],r['source']) for r in new]
    if len(ids) != len(set(ids)): raise ValueError('Duplicate port/scope rules are not supported.')
    old = load()
    docker_changed = any(x['scope']=='docker' for x in old + new)
    if docker_changed: docker_backend_check()
    # Verify no edits will touch policy/other users' UFW rules.
    try:
        for rule in old:
            if rule['scope']=='host': delete_rule(rule)
        for rule in new:
            if rule['scope']=='host': install_rule(rule)
        if docker_changed:
            ensure_chain()
            for rule in new:
                if rule['scope']=='docker' and rule['action'] != 'allow':
                    for exe, spec in reversed(docker_specs(rule)):
                        run([exe, '-I', 'YRM-PANEL', '1', *spec])
        write_state(new)
    except Exception:
        # Best-effort rollback to the last committed rules.
        for rule in new:
            if rule['scope']=='host':
                try: delete_rule(rule)
                except Exception: pass
        for rule in old:
            if rule['scope']=='host':
                try: install_rule(rule)
                except Exception: pass
        if docker_changed:
            try:
                ensure_chain()
                for rule in old:
                    if rule['scope']=='docker' and rule['action'] != 'allow':
                        for exe, spec in reversed(docker_specs(rule)): run([exe, '-I', 'YRM-PANEL', '1', *spec])
            except Exception: pass
        raise
    return 'Firewall draft applied to supported backends.'


def write_state(rules):
    fd, tmp = tempfile.mkstemp(dir=str(STATE.parent), prefix='.firewall-')
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as stream: json.dump(rules, stream, indent=2)
        os.replace(tmp, STATE)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def restore_docker():
    rules = [rule for rule in load() if rule['scope'] == 'docker' and rule['action'] != 'allow']
    if not rules: return 'No Docker firewall rules need restoring.'
    ensure_chain()
    for rule in rules:
        for executable, spec in reversed(docker_specs(rule)):
            run([executable, '-I', 'YRM-PANEL', '1', *spec])
    return 'Managed Docker firewall rules restored.'


def main():
    if os.geteuid()!=0: raise ValueError('Root helper required.')
    if sys.argv[1:] == ['list']:
        try: status = run([UFW, 'status', 'verbose'])
        except ValueError: status = 'UFW is unavailable.'
        print(json.dumps({'ok': True,'message':'Firewall state loaded.', 'status':status,
                          'rules':load(), 'dockerSupported':docker_support()}))
    elif sys.argv[1:] == ['restore']:
        print(json.dumps({'ok':True,'message':restore_docker()}))
    elif sys.argv[1:] == ['apply']:
        print(json.dumps({'ok':True,'message':apply(sys.stdin.read(16385))}))
    else: raise ValueError('Invalid firewall action.')


def docker_support():
    try: docker_backend_check(); return True
    except (OSError, ValueError, subprocess.TimeoutExpired): return False

if __name__=='__main__':
    try: main()
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as ex:
        print(json.dumps({'ok':False,'message':str(ex)}))
        raise SystemExit(1)
