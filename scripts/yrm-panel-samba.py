#!/usr/bin/env python3
"""YRM Panel native Samba adapter. The Linux account is the only SMB identity.

Share metadata is stored in Samba's standard configuration, not Panel-private
file storage. Root actions are fixed and input-validated. Unsharing never
removes the underlying files.
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
NAME = re.compile(r'^[\w-]{1,32}$', re.UNICODE)
RESERVED = frozenset(('bin', 'boot', 'dev', 'etc', 'lib', 'lib64', 'proc', 'root',
                      'run', 'sbin', 'sys', 'usr', 'var', 'opt', 'snap', '.'))


def emit(ok, message, **values):
    print(json.dumps({'ok': ok, 'message': message, **values}))


def fail(message):
    emit(False, message)
    raise SystemExit(1)


def run(command, **kwargs):
    completed = subprocess.run(command, capture_output=True, text=True, timeout=15, **kwargs)
    if completed.returncode:
        raise ValueError(f'{pathlib.Path(command[0]).name} operation failed. Check system logs.')
    return completed.stdout


def account():
    username = ACCOUNT.read_text(encoding='utf-8').strip()
    info = pwd.getpwnam(username)
    if info.pw_uid < 1000 or username in ('root', 'yrm-panel'):
        raise ValueError('A regular Linux account is required.')
    return username


def parse():
    config = configparser.ConfigParser(interpolation=None, strict=True)
    config.optionxform = str.lower
    if MANAGED.exists():
        config.read(MANAGED, encoding='utf-8')
    return config


def bootstrap():
    if not MAIN.is_file():
        raise ValueError('Samba configuration is missing.')
    source = MAIN.read_text(encoding='utf-8')
    include = 'include = /etc/samba/yrm-panel-shares.conf'
    if include not in source:
        match = re.search(r'^\s*\[global\]\s*$', source, re.M | re.I)
        if match is None:
            raise ValueError('The Samba global section could not be found.')
        shutil.copy2(MAIN, str(MAIN) + '.before-yrm-panel')
        MAIN.write_text(source[:match.end()] + '\n   ' + include + source[match.end():], encoding='utf-8')
    if not MANAGED.exists():
        MANAGED.write_text('# YRM Panel managed Samba shares; preserved on uninstall.\n', encoding='utf-8')
        MANAGED.chmod(0o644)
    try:
        run(['testparm', '-s', str(MAIN)])
        run(['systemctl', 'reload', 'smbd'])
    except Exception:
        if include not in source:
            MAIN.write_text(source, encoding='utf-8')
        raise


def save_config(config):
    fd, temp = tempfile.mkstemp(prefix='yrm-smb-', dir='/etc/samba', text=True)
    previous = MANAGED.read_bytes() if MANAGED.exists() else None
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as target:
            config.write(target)
        os.chmod(temp, 0o644)
        os.replace(temp, MANAGED)
        run(['testparm', '-s', str(MAIN)])
        run(['systemctl', 'reload', 'smbd'])
    except Exception:
        if previous is None:
            MANAGED.unlink(missing_ok=True)
        else:
            MANAGED.write_bytes(previous)
            MANAGED.chmod(0o644)
        raise
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def backup_mounted():
    try:
        devices = {}
        for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
            parts = line.split()
            if len(parts) > 4:
                devices[parts[4].replace('\\040', ' ')] = parts[2]
        return '/backup' in devices and '/' in devices and devices['/backup'] != devices['/']
    except OSError:
        return False


def validate_path(raw, readonly):
    if not raw.startswith('/') or '\x00' in raw or '..' in pathlib.PurePath(raw).parts:
        raise ValueError('A normal absolute path is required.')
    source = pathlib.Path(raw)
    for element in (source, *source.parents):
        if element.is_symlink():
            raise ValueError('Symlink paths cannot be shared.')
    target = source.resolve(strict=True)
    if not target.is_dir() or target == pathlib.Path('/'):
        raise ValueError('Select a normal directory to share.')
    components = target.parts
    if len(components) < 2 or components[1] in RESERVED or components[1].startswith('.'):
        raise ValueError('System folders cannot be shared.')
    username = account()
    if components[1] == 'home' and (len(components) < 3 or components[2] != username):
        raise ValueError('Only your own Linux home folder may be shared.')
    if target == pathlib.Path('/backup') or pathlib.Path('/backup') in target.parents:
        if not backup_mounted():
            raise ValueError('The backup disk is not mounted.')
    # Root itself can read everything; verify the real Linux user's rights.
    for mode in ('-r', '-x') + (() if readonly else ('-w',)):
        result = subprocess.run(['runuser', '-u', username, '--', '/usr/bin/test', mode, str(target)],
                                capture_output=True, timeout=10)
        if result.returncode:
            raise ValueError('The Linux user does not have the required file permissions.')
    return str(target)


def effective_names():
    output = run(['testparm', '-s', str(MAIN)])
    return {match.group(1).casefold() for match in re.finditer(r'^\[([^\]]+)\]', output, re.M)}


def save_share(name, path, readonly):
    if not NAME.fullmatch(name) or name.casefold() in ('global', 'printers', 'print$', 'homes', 'ipc$'):
        raise ValueError('Invalid or reserved share name.')
    target = validate_path(path, readonly)
    config = parse()
    for existing in config.sections():
        if existing.casefold() == name.casefold() and existing != name:
            raise ValueError('Another managed share has a similar name.')
    if not config.has_section(name) and name.casefold() in effective_names():
        raise ValueError('A share with that name already exists outside YRM Panel.')
    if not config.has_section(name):
        config.add_section(name)
    values = {
        'comment': 'YRM Panel shared folder',
        'path': target,
        'browseable': 'yes',
        'guest ok': 'no',
        'valid users': account(),
        'read only': 'yes' if readonly else 'no',
        'create mask': '0660',
        'directory mask': '0770',
    }
    for key, value in values.items():
        config.set(name, key, value)
    save_config(config)


def remove_share(name):
    config = parse()
    if not config.has_section(name):
        raise ValueError('Only shares created by YRM Panel may be removed.')
    config.remove_section(name)
    save_config(config)


def list_shares():
    config = parse()
    shares = [
        {'name': name, 'path': config.get(name, 'path', fallback=''),
         'readOnly': config.getboolean(name, 'read only', fallback=False), 'managed': True}
        for name in config.sections()
    ]
    known = {s['name'].casefold() for s in shares}
    current = None
    for line in run(['testparm', '-s', str(MAIN)]).splitlines():
        heading = re.match(r'^\s*\[([^\]]+)\]\s*$', line)
        if heading:
            name = heading.group(1)
            current = None
            if name.casefold() not in known and name.casefold() not in ('global', 'printers', 'homes', 'ipc$', 'print$'):
                current = {'name': name, 'path': '', 'readOnly': True, 'managed': False}
                shares.append(current)
                known.add(name.casefold())
            continue
        if current is not None:
            value = re.match(r'^\s*(path|read only)\s*=\s*(.*?)\s*$', line, re.I)
            if value:
                if value.group(1).lower() == 'path':
                    current['path'] = value.group(2)
                else:
                    current['readOnly'] = value.group(2).lower() in ('yes', 'true', '1')
    return shares


def account_configured(username):
    try:
        return any(line.split(':', 1)[0] == username for line in run(['pdbedit', '-L']).splitlines())
    except ValueError:
        return False


def set_password(password):
    if not (12 <= len(password) <= 256) or '\r' in password or '\n' in password:
        raise ValueError('SMB password must contain 12–256 characters.')
    username = account()
    run(['smbpasswd', '-s', '-a', username], input=password + '\n' + password + '\n')
    if not account_configured(username):
        raise ValueError('The SMB account was not created.')


def main():
    if os.geteuid() != 0:
        fail('Restricted root helper is required.')
    if len(sys.argv) < 2:
        fail('Missing action.')
    action = sys.argv[1]
    try:
        if action == 'bootstrap' and len(sys.argv) == 2:
            bootstrap(); emit(True, 'Samba integration installed.')
        elif action == 'list' and len(sys.argv) == 2:
            if not MAIN.is_file():
                raise ValueError('Samba is unavailable.')
            user = account()
            emit(True, 'OK', account=user, accountConfigured=account_configured(user), shares=list_shares())
        elif action == 'save' and len(sys.argv) == 5:
            save_share(sys.argv[2], sys.argv[3], sys.argv[4] == 'true')
            emit(True, 'SMB share saved.')
        elif action == 'delete' and len(sys.argv) == 3:
            remove_share(sys.argv[2]); emit(True, 'SMB share removed. Files are preserved.')
        elif action == 'set-password' and len(sys.argv) == 2:
            set_password(sys.stdin.readline(300).rstrip('\n'))
            emit(True, 'SMB password configured for the Linux account.')
        else:
            fail('Unsupported Samba action.')
    except (OSError, ValueError, configparser.Error, subprocess.TimeoutExpired, KeyError) as exc:
        fail(str(exc))


if __name__ == '__main__':
    main()
