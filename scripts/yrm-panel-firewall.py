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
import secrets
import shutil
import time
import subprocess
import sys
import tempfile

STATE = pathlib.Path('/etc/yrm-panel/firewall.json')
PENDING = pathlib.Path('/var/lib/yrm-panel/firewall-pending.json')
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
            low <= protected <= high for low, high in spans for protected in management_ports()):
        raise ValueError('Refusing to block SSH or Panel management ports.')
    return {'scope':scope, 'action':action, 'port':port, 'protocol':proto, 'source':source}


def ufw_status():
    if not pathlib.Path(UFW).exists():
        return False, False, 'UFW is not installed.'
    try:
        output = run([UFW, 'status', 'verbose'])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False, False, 'UFW status is unavailable.'
    match = re.search(r'(?im)^Status:\s*(active|inactive)\b', output)
    if match is None:
        return False, False, 'UFW returned an unrecognized status.'
    return True, match.group(1).lower() == 'active', output


def management_ports():
    # The HTTPS and HTTP ports follow the selected install configuration.
    ports = {22, 6080, 6081}
    source = pathlib.Path('/etc/yrm-panel/source.env')
    if source.exists():
        for line in source.read_text(encoding='utf-8').splitlines():
            match = re.fullmatch(r'(PORT|HTTPS_PORT)=([0-9]{4,5})', line)
            if match and 1024 <= int(match.group(2)) <= 65535:
                ports.add(int(match.group(2)))
    # Don't assume SSH always uses port 22.
    sshd = shutil.which('sshd') or '/usr/sbin/sshd'
    if pathlib.Path(sshd).exists():
        result = subprocess.run([sshd, '-T'], capture_output=True, text=True, timeout=8)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                match = re.fullmatch(r'port\s+([0-9]{1,5})', line)
                if match and 1 <= int(match.group(1)) <= 65535:
                    ports.add(int(match.group(1)))
    return ports


def preserve_remote_access():
    for port in sorted(management_ports()):
        run([UFW, 'allow', str(port) + '/tcp', 'comment', 'YRM-Panel-Management'])
    # A host acting as a WireGuard endpoint may need its UDP listening ports.
    wg = shutil.which('wg')
    if wg:
        result = subprocess.run([wg, 'show', 'all', 'listen-port'], capture_output=True, text=True, timeout=8)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                fields = line.split()
                if len(fields) == 2 and fields[1].isdigit():
                    port = int(fields[1])
                    if 1 <= port <= 65535:
                        run([UFW, 'allow', str(port) + '/udp', 'comment', 'YRM-Panel-VPN'])


def pending_state():
    try:
        data = json.loads(PENDING.read_text(encoding='utf-8'))
        if isinstance(data, dict) and isinstance(data.get('nonce'), str):
            return data
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    return None


def schedule_rollback():
    # Always schedule this BEFORE activating UFW. Confirmation is intentionally
    # passwordless only for a random nonce that already exists on the server.
    if pending_state() is not None:
        raise ValueError('Confirm the previous firewall change before continuing.')
    systemd_run = shutil.which('systemd-run')
    if not systemd_run:
        raise ValueError('Automatic rollback is unavailable; refusing to enable UFW remotely.')
    nonce = secrets.token_hex(24)
    data = {'nonce': nonce, 'created': time.time(), 'wasActive': False}
    PENDING.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=str(PENDING.parent), prefix='.firewall-guard-')
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'w', encoding='utf-8') as f: json.dump(data, f)
        os.replace(temp, PENDING)
    finally:
        if os.path.exists(temp): os.unlink(temp)
    try:
        run([systemd_run, '--quiet', '--on-active=120s',
             '--unit=yrm-panel-fw-guard-' + nonce[:12],
             '/usr/local/libexec/yrm-panel-firewall', 'rollback'])
    except Exception:
        PENDING.unlink(missing_ok=True)
        raise
    return nonce


def confirm_activation(nonce):
    if not re.fullmatch(r'[a-f0-9]{48}', nonce):
        raise ValueError('Invalid firewall confirmation token.')
    state = pending_state()
    if state is None or not secrets.compare_digest(state['nonce'], nonce):
        raise ValueError('No matching pending firewall change.')
    available, active, _ = ufw_status()
    if not available or not active:
        raise ValueError('UFW is not active; cannot confirm.')
    PENDING.unlink(missing_ok=True)
    return 'Firewall connection confirmed. Automatic rollback cancelled.'


def rollback_activation():
    state = pending_state()
    if state is None: return 'No pending firewall activation.'
    # A failed browser reconnection leaves UFW disabled, not the host locked out.
    if not state.get('wasActive'):
        run([UFW, '--force', 'disable'])
    PENDING.unlink(missing_ok=True)
    return 'Unconfirmed UFW activation was rolled back.'


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
    body = json.loads(payload)
    # Existing BETA4 clients may still submit a bare list.
    if isinstance(body, dict):
        data, requested = body.get('rules'), body.get('enabled')
        if type(requested) is not bool: raise ValueError('Choose Active or Inactive.')
    else:
        data, requested = body, None
    if not isinstance(data, list) or len(data) > 50: raise ValueError('Maximum 50 rules.')
    new = [validate(rule) for rule in data]
    ids = [(r['scope'],r['protocol'],r['port'],r['source']) for r in new]
    if len(ids) != len(set(ids)): raise ValueError('Duplicate port/scope rules are not supported.')
    available, original_active, _ = ufw_status()
    if not available:
        raise ValueError('UFW is unavailable. Firewall editing is disabled.')
    old = load()
    docker_changed = any(x['scope']=='docker' for x in old + new)
    if docker_changed: docker_backend_check()
    enabling = requested is True and not original_active
    guard = None
    try:
        if enabling:
            preserve_remote_access()
            guard = schedule_rollback()
        # Verify that only YRM-managed rule definitions are changed.
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
        if requested is not None and requested != original_active:
            run([UFW, '--force', 'enable' if requested else 'disable'])
            active = ufw_status()[1]
            if active != requested:
                raise ValueError('UFW state did not match the requested setting.')
        write_state(new)
    except Exception:
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
        if enabling:
            try: run([UFW, '--force', 'disable'])
            except Exception: pass
            if guard: PENDING.unlink(missing_ok=True)
        raise
    return 'Firewall draft applied to supported backends.' + (' Confirm connectivity within 120 seconds to keep UFW enabled.' if enabling else '')


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
        available, active, status = ufw_status()
        pending = pending_state()
        print(json.dumps({'ok': True, 'message': 'Firewall state loaded.',
                          'available': available, 'active': active, 'status': status,
                          'pendingConfirmation': pending['nonce'] if pending else '',
                          'rules': load(), 'dockerSupported': docker_support()}))
    elif sys.argv[1:] == ['restore']:
        print(json.dumps({'ok':True,'message':restore_docker()}))
    elif sys.argv[1:] == ['apply']:
        print(json.dumps({'ok':True,'message':apply(sys.stdin.read(16385))}))
    elif len(sys.argv) == 3 and sys.argv[1] == 'confirm':
        print(json.dumps({'ok':True,'message':confirm_activation(sys.argv[2])}))
    elif sys.argv[1:] == ['rollback']:
        print(json.dumps({'ok':True,'message':rollback_activation()}))
    else: raise ValueError('Invalid firewall action.')


def docker_support():
    try: docker_backend_check(); return True
    except (OSError, ValueError, subprocess.TimeoutExpired): return False

if __name__=='__main__':
    try: main()
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as ex:
        print(json.dumps({'ok':False,'message':str(ex)}))
        raise SystemExit(1)
