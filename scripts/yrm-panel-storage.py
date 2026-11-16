#!/usr/bin/env python3
"""Restricted storage helper: explicitly opt-in a data folder for Panel access.

Does not mount, format, delete files, traverse symlinks, or recursively chown.
Only a pre-existing regular Ubuntu account is granted SMB/file access.
"""
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys
import tempfile

REGISTRY = Path('/etc/yrm-panel/managed-roots.json')
ACCOUNT = Path('/etc/yrm-panel/samba-user')
FOLDER_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$')
RESERVED = frozenset(('bin','boot','dev','etc','home','lib','lib64','lost+found','media','mnt',
                      'opt','proc','root','run','sbin','snap','srv','sys','tmp','usr','var'))

def emit(ok, message, **values):
    print(json.dumps({'ok':ok, 'message':message, **values}))

def fail(message):
    emit(False, message)
    raise SystemExit(1)

def user_info():
    name = ACCOUNT.read_text(encoding='utf-8').strip()
    info = pwd.getpwnam(name)
    if info.pw_uid < 1000 or name in ('root', 'yrm-panel'):
        raise ValueError('A regular Linux file user is required.')
    return info

def registry():
    try:
        data = json.loads(REGISTRY.read_text(encoding='utf-8'))
        if not isinstance(data, list) or any(not isinstance(x,str) for x in data):
            raise ValueError('Invalid storage registry.')
        return sorted(set(data))
    except FileNotFoundError:
        return []

def write_registry(paths):
    fd, name = tempfile.mkstemp(dir='/etc/yrm-panel',prefix='storage-',text=True)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(sorted(set(paths)), output, indent=2)
            output.write('\n')
        os.chmod(name, 0o644)
        os.replace(name, REGISTRY)
    finally:
        if os.path.exists(name): os.unlink(name)

def reject_links(target):
    """Reject links in every path component before any privileged action."""
    current = Path('/')
    for part in Path(target).parts[1:]:
        current = current / part
        if current.is_symlink():
            raise ValueError('Symbolic links are not accepted.')

def allowed_path(target):
    raw = Path(target)
    if not raw.is_absolute() or '\x00' in target or '..' in raw.parts:
        raise ValueError('Expected a normal absolute directory path.')
    reject_links(target)
    path = raw.resolve(strict=True)
    if not path.is_dir(): raise ValueError('Folder not found.')
    parts = path.parts
    # A chosen top-level data folder, or a nested directory inside such a folder.
    if len(parts) < 2 or parts[1] in RESERVED or parts[1].startswith('.'):
        raise ValueError('System folders cannot be managed by the Panel.')
    if len(parts) > 2 and str(Path('/',parts[1])) not in registry():
        # Need opt-in on the top-level directory before managing its descendants.
        raise ValueError('Enable management on the top-level data folder first.')
    return str(path)

def is_real_backup(path):
    if path != '/backup': return True
    # Protect /backup, if the user means it to be an independent backup device.
    devices = {}
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split(' ')
        if len(fields) > 4: devices[fields[4].replace('\\040',' ')] = fields[2]
    return '/backup' in devices and devices['/backup'] != devices.get('/')

def grant(target):
    path = allowed_path(target)
    if (path == '/backup' or path.startswith('/backup/')) and not is_real_backup('/backup'):
        raise ValueError('/backup is not mounted on a separate filesystem.')
    info = user_info()
    # Do not chown data that belongs to another program. ACL is scoped to ONE directory.
    for subject in (info.pw_name, 'yrm-panel'):
        subprocess.run(['setfacl','-m',f'u:{subject}:rwx',path],check=True,capture_output=True,timeout=10)
        subprocess.run(['setfacl','-m',f'd:u:{subject}:rwx',path],check=True,capture_output=True,timeout=10)
    paths = registry()
    if path not in paths: write_registry(paths + [path])
    return path

def create_root(name):
    if not FOLDER_RE.fullmatch(name) or name in RESERVED:
        raise ValueError('Invalid top-level folder name.')
    target = Path('/') / name
    if target.exists() or target.is_symlink():
        raise ValueError('A folder with that name already exists.')
    info = user_info()
    target.mkdir(mode=0o770)
    try:
        os.chown(target, info.pw_uid, info.pw_gid)
        os.chmod(target, 0o2770)
        # A /backup directory may first be created as a future disk mountpoint.
        # It stays read-only in Files until the real backup disk is mounted.
        if name != 'backup' or is_real_backup('/backup'):
            grant(str(target))
    except Exception:
        # Don't leave an unexpected top-level directory after an interrupted operation.
        try: target.rmdir()
        except OSError: pass
        raise
    return str(target)

def main():
    if os.geteuid() != 0: fail('Requires the restricted sudo helper.')
    try:
        if len(sys.argv) == 3 and sys.argv[1] == 'create-root':
            path = create_root(sys.argv[2]); emit(True, 'Folder created.', path=path)
        elif len(sys.argv) == 3 and sys.argv[1] == 'grant':
            path = grant(sys.argv[2]); emit(True, 'Folder enabled for file management.', path=path)
        elif len(sys.argv) == 2 and sys.argv[1] == 'list':
            emit(True, 'OK', roots=registry())
        else: fail('Unsupported storage action.')
    except (OSError,ValueError,subprocess.CalledProcessError,subprocess.TimeoutExpired) as ex:
        fail(str(ex) if not isinstance(ex,subprocess.CalledProcessError) else 'Unable to update folder permissions.')

if __name__ == '__main__': main()
