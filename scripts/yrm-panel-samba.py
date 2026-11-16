#!/usr/bin/env python3
"""Minimal privileged Samba adapter. Shares must live in user-approved data roots.

Never pass arbitrary shell commands, write arbitrary files, or accept a path from
outside the two configured roots. The config file belongs to Samba, not the Panel.
"""
import configparser
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import sys
import tempfile

MAIN = pathlib.Path('/etc/samba/smb.conf')
MANAGED = pathlib.Path('/etc/samba/yrm-panel-shares.conf')
ACCOUNT = pathlib.Path('/etc/yrm-panel/samba-user')
NAME_PATTERN = re.compile(r'^[\w-]{1,32}$', re.UNICODE)
ROOTS = None  # Unit tests can substitute a tuple of temporary data roots.
REGISTRY = pathlib.Path('/etc/yrm-panel/managed-roots.json')

def allowed_roots():
    if ROOTS is not None: return ROOTS
    try:
        data = json.loads(REGISTRY.read_text(encoding='utf-8'))
        if not isinstance(data, list): return ()
        return tuple(pathlib.Path(value) for value in data if isinstance(value, str) and value.startswith('/'))
    except (FileNotFoundError, ValueError, OSError):
        return ()


def emit(ok, message, **kwargs):
    print(json.dumps({'ok': ok, 'message': message, **kwargs}))


def fail(reason):
    emit(False, reason)
    sys.exit(1)


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=12, **kwargs)
    if result.returncode:
        raise ValueError(f'{args[0]} operation failed; check system logs.')
    return result.stdout


def account():
    username = ACCOUNT.read_text(encoding='utf-8').strip()
    user = pwd.getpwnam(username)
    if user.pw_uid < 1000 or user.pw_name in ('root', 'yrm-panel'):
        raise ValueError('Only a regular Ubuntu user can be an SMB account.')
    return username


def samba_exists():
    if not MAIN.is_file():
        raise ValueError('Samba is not installed.')


def parse():
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    parser.optionxform = str.lower
    if MANAGED.exists():
        parser.read(MANAGED, encoding='utf-8')
    return parser


def save(parser):
    # Render to a temporary file, validate the complete Samba config, then reload.
    fd, path = tempfile.mkstemp(prefix='yrm-shares-', dir='/etc/samba', text=True)
    old = MANAGED.read_bytes() if MANAGED.exists() else None
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            parser.write(output)
        os.chmod(path, 0o644)
        os.replace(path, MANAGED)
        run(['testparm', '-s', '/etc/samba/smb.conf'])
        run(['systemctl', 'reload', 'smbd'])
    except Exception:
        if old is None:
            MANAGED.unlink(missing_ok=True)
        else:
            MANAGED.write_bytes(old)
            MANAGED.chmod(0o644)
        raise
    finally:
        if os.path.exists(path): os.unlink(path)


def is_mounted(path):
    with open('/proc/self/mountinfo', encoding='utf-8') as file:
        devices = {line.split()[4].replace('\\040', ' '): line.split()[2]
                   for line in file if len(line.split()) > 4}
    return str(path) in devices and '/' in devices and devices[str(path)] != devices['/']


def validate_path(raw):
    if not raw.startswith('/') or '\x00' in raw:
        raise ValueError('The share path must be an absolute folder.')
    # Do not allow symlink components, even if resolved path looks safe.
    source = pathlib.Path(raw)
    for component in (source, *source.parents):
        if component.is_symlink():
            raise ValueError('Symbolic links cannot be used in share paths.')
    resolved = source.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError('Share path must refer to a directory.')
    if not any(resolved == base or base in resolved.parents for base in allowed_roots()):
        raise ValueError('Share this folder only after enabling its management in Files.')
    backup = pathlib.Path('/backup') if ROOTS is None else ROOTS[-1]
    if (resolved == backup or backup in resolved.parents) and not is_mounted(backup):
        raise ValueError('Backup disk is not mounted; refusing to use the system disk as backup.')
    return str(resolved)


def bootstrap():
    samba_exists()
    raw = MAIN.read_text(encoding='utf-8')
    include = 'include = /etc/samba/yrm-panel-shares.conf'
    if include not in raw:
        match = re.search(r'^\s*\[global\]\s*$', raw, flags=re.M | re.I)
        if not match:
            raise ValueError('Could not find the [global] Samba section.')
        shutil.copy2(MAIN, str(MAIN) + '.before-yrm-panel')
        updated = raw[:match.end()] + '\n   ' + include + raw[match.end():]
        MAIN.write_text(updated, encoding='utf-8')
    if not MANAGED.exists():
        MANAGED.write_text('# YRM Panel managed shares; preserved after panel removal.\n', encoding='utf-8')
        MANAGED.chmod(0o644)
    try:
        run(['testparm', '-s', str(MAIN)])
        run(['systemctl', 'reload', 'smbd'])
    except Exception:
        if include not in raw:
            MAIN.write_text(raw, encoding='utf-8')
        raise


def effective_names():
    output = run(['testparm', '-s', str(MAIN)])
    return {match.group(1).lower() for match in re.finditer(r'^\[([^\]]+)\]', output, re.M)}


def update_share(name, path, readonly):
    if not NAME_PATTERN.fullmatch(name):
        raise ValueError('Invalid share name. Use 1-32 letters, numbers, underscore or dash.')
    if name.lower() in ('global', 'printers', 'print$', 'homes', 'ipc$'):
        raise ValueError('Reserved share name.')
    target = validate_path(path)
    user = account()
    parser = parse()
    if not parser.has_section(name) and name.lower() in effective_names():
        raise ValueError('A share with that name already exists outside YRM Panel.')
    # Avoid case-insensitive duplicate sections: Samba share names are case insensitive.
    for existing in parser.sections():
        if existing.lower() == name.lower() and existing != name:
            raise ValueError('A similarly named YRM share already exists.')
    if not parser.has_section(name): parser.add_section(name)
    for key, value in {
        'comment': 'YRM Panel shared folder', 'path': target, 'browseable': 'yes',
        'guest ok': 'no', 'valid users': user, 'read only': 'yes' if readonly else 'no',
        'create mask': '0660', 'directory mask': '0770'
    }.items():
        parser.set(name, key, value)
    save(parser)


def delete_share(name):
    parser = parse()
    if not parser.has_section(name):
        raise ValueError('Only YRM-managed shares may be removed here.')
    parser.remove_section(name)
    save(parser)


def list_shares():
    """Use Samba's effective config to show both managed and existing shares.

    Existing shares are read-only from the Panel's perspective; they cannot be
    overwritten or removed by the YRM helper.
    """
    managed = parse()
    result = [{'name': name, 'path': managed.get(name, 'path', fallback=''),
               'readOnly': managed.getboolean(name, 'read only', fallback=False),
               'managed': True} for name in managed.sections()]
    seen = {x['name'].casefold() for x in result}
    active = None
    for line in run(['testparm', '-s', str(MAIN)]).splitlines():
        section = re.match(r'^\s*\[([^\]]+)\]\s*$', line)
        if section:
            name = section.group(1)
            active = None
            if name.casefold() not in seen and name.casefold() not in ('global', 'printers', 'print$', 'homes', 'ipc$'):
                active = {'name': name, 'path': '', 'readOnly': True, 'managed': False}
                result.append(active)
                seen.add(name.casefold())
            continue
        if active is not None:
            option = re.match(r'^\s*(path|read only)\s*=\s*(.*?)\s*$', line, re.I)
            if option:
                if option.group(1).lower() == 'path':
                    active['path'] = option.group(2)
                else:
                    active['readOnly'] = option.group(2).lower() in ('yes', 'true', '1')
    return result


def password_state(user):
    try:
        return any(line.split(':', 1)[0] == user for line in run(['pdbedit', '-L']).splitlines())
    except ValueError:
        return False


def set_password(value):
    if len(value) < 12 or len(value) > 256 or '\n' in value or '\r' in value:
        raise ValueError('Password must be 12-256 characters and cannot contain newlines.')
    user = account()
    # Password flows via stdin, never command args, environment, stdout or disk.
    run(['smbpasswd', '-s', '-a', user], input=value + '\n' + value + '\n')
    if not password_state(user):
        raise ValueError('The Samba account was not confirmed by the account database.')


def main():
    if os.geteuid() != 0: fail('Requires root via the restricted sudoers rule.')
    if len(sys.argv) < 2: fail('Missing action.')
    action = sys.argv[1]
    try:
        if action == 'bootstrap' and len(sys.argv) == 2:
            bootstrap(); emit(True, 'Samba integration installed.')
        elif action == 'list' and len(sys.argv) == 2:
            samba_exists(); user = account(); parser = parse()
            shares = list_shares()
            emit(True, 'OK', shares=shares, account=user, accountConfigured=password_state(user))
        elif action == 'save' and len(sys.argv) == 5:
            update_share(sys.argv[2], sys.argv[3], sys.argv[4] == 'true')
            emit(True, 'Share saved. Samba configuration reloaded.')
        elif action == 'delete' and len(sys.argv) == 3:
            delete_share(sys.argv[2]); emit(True, 'Share removed. Files were not deleted.')
        elif action == 'set-password' and len(sys.argv) == 2:
            set_password(sys.stdin.read(512).rstrip('\n'))
            emit(True, 'Samba password saved for the existing Ubuntu account.')
        else: fail('Unsupported Samba helper action or arguments.')
    except (OSError, ValueError, configparser.Error, subprocess.TimeoutExpired, KeyError) as error:
        fail(str(error))


if __name__ == '__main__': main()
