#!/usr/bin/env python3
"""Narrowly scoped privileged folder creation and explicit per-directory ACL grants.

Ordinary Files operations are performed by the Linux user's ASP.NET process;
this helper must never become a general purpose root file manager.
"""
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys

ACCOUNT = Path('/etc/yrm-panel/samba-user')
FOLDER = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$')
RESERVED = frozenset(('bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib64',
                      'lost+found', 'media', 'mnt', 'opt', 'proc', 'root', 'run',
                      'sbin', 'snap', 'srv', 'sys', 'tmp', 'usr', 'var'))


def emit(ok, message):
    print(json.dumps({'ok': ok, 'message': message}))


def fail(message):
    emit(False, message)
    raise SystemExit(1)


def account():
    user = ACCOUNT.read_text(encoding='utf8').strip()
    info = pwd.getpwnam(user)
    if info.pw_uid < 1000 or info.pw_name in ('root', 'yrm-panel'):
        raise ValueError('A regular Linux account is required.')
    return info


def reject_links(target):
    item = Path('/')
    for part in Path(target).parts[1:]:
        item = item / part
        if item.is_symlink():
            raise ValueError('Symbolic links are not supported.')


def mount_ok(path):
    if path != '/backup' and not path.startswith('/backup/'):
        return True
    try:
        dev = {}
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            parts = line.split()
            if len(parts) > 4:
                dev[parts[4]] = parts[2]
        return dev.get('/backup') is not None and dev.get('/backup') != dev.get('/')
    except OSError:
        return False


def create_root(name):
    if not FOLDER.fullmatch(name) or name in RESERVED or name.startswith('.'):
        raise ValueError('Invalid root-level folder name.')
    target = Path('/') / name
    if target.exists() or target.is_symlink():
        raise ValueError('The requested directory already exists.')
    info = account()
    target.mkdir(mode=0o770)
    try:
        os.chown(target, info.pw_uid, info.pw_gid)
        os.chmod(target, 0o2770)
        # A backup mountpoint can be created before its separate disk is mounted,
        # but it must remain unwritable until the disk is actually present.
        if name == 'backup' and not mount_ok('/backup'):
            os.chmod(target, 0o500)
    except OSError:
        try:
            target.rmdir()
        except OSError:
            pass
        raise
    return target


def grant(target):
    source = Path(target)
    if not source.is_absolute() or '\x00' in target or '..' in source.parts:
        raise ValueError('Expected an absolute path.')
    reject_links(target)
    resolved = source.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError('Directory not found.')
    if len(resolved.parts) < 2 or resolved.parts[1] in RESERVED:
        raise ValueError('System directories cannot be managed.')
    if not mount_ok(str(resolved)):
        raise ValueError('Backup disk is not mounted.')
    info = account()
    # Never recursively change the ownership or permissions of existing data.
    subprocess.run(['setfacl', '-m', f'u:{info.pw_name}:rwx', str(resolved)],
                   check=True, timeout=10, capture_output=True)
    subprocess.run(['setfacl', '-m', f'd:u:{info.pw_name}:rwx', str(resolved)],
                   check=True, timeout=10, capture_output=True)
    return resolved


def main():
    if os.geteuid() != 0:
        fail('Restricted root helper is required.')
    try:
        if len(sys.argv) == 3 and sys.argv[1] == 'create-root':
            create_root(sys.argv[2]); emit(True, 'Folder created for your Linux account.')
        elif len(sys.argv) == 3 and sys.argv[1] == 'grant':
            grant(sys.argv[2]); emit(True, 'Linux account granted directory access.')
        else:
            fail('Unsupported storage action.')
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        fail(str(exc) if not isinstance(exc, subprocess.CalledProcessError) else 'Could not grant directory access.')


if __name__ == '__main__':
    main()
