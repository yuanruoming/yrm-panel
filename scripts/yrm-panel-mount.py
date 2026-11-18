#!/usr/bin/env python3
"""Restricted, non-destructive mount operations for existing filesystems only.

No formatting, partition modification, arbitrary mount options, recursive chmod,
or mounting over a non-empty directory. Managed fstab entries carry an explicit marker.
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

FSTAB = pathlib.Path('/etc/fstab')
MANUAL = pathlib.Path('/etc/yrm-panel/manual-mounts.json')
MARKER = '# yrm-panel-managed:'
UUID_RE = re.compile(r'^[A-Za-z0-9-]{4,80}$')
ALLOWED = {'ext4', 'xfs', 'btrfs', 'vfat', 'exfat', 'ntfs'}
PROTECTED = {'/', '/boot', '/boot/efi', '/etc', '/usr', '/var', '/opt', '/root', '/proc', '/sys', '/dev', '/run'}


def emit(ok, message):
    print(json.dumps({'ok': ok, 'message': message}))


def run(args, timeout=20):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise ValueError(f'{pathlib.Path(args[0]).name} returned an error: {result.stderr.strip()[:180]}')
    return result.stdout.strip()


def path_check(raw):
    if not raw.startswith('/') or any(x in ('.', '..') for x in raw.split('/')) or '\\' in raw or '\x00' in raw:
        raise ValueError('A normal absolute mount path is required.')
    path = pathlib.Path(os.path.normpath(raw))
    if str(path) in PROTECTED or any(str(path).startswith(p + '/') for p in ('/etc','/usr','/var','/opt','/root','/proc','/sys','/dev','/run','/boot')):
        raise ValueError('Cannot mount over protected system locations.')
    if any(char.isspace() for char in raw):
        raise ValueError('Mount paths containing whitespace are not supported yet.')
    if len(str(path)) > 230 or str(path).count('/') > 15:
        raise ValueError('Mount path is too long.')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Symlink paths are not supported.')
    return path


def lookup(uuid):
    if not UUID_RE.fullmatch(uuid):
        raise ValueError('Invalid filesystem UUID.')
    output = run(['/usr/bin/lsblk', '-J', '-p', '-o', 'PATH,TYPE,UUID,FSTYPE,MOUNTPOINTS,RO'])
    def walk(items):
        for item in items:
            if item.get('uuid') == uuid:
                if item.get('type') not in ('part', 'disk') or item.get('fstype') not in ALLOWED or item.get('ro'):
                    raise ValueError('Only writable, supported existing filesystems can be mounted.')
                if any(item.get('mountpoints') or []):
                    raise ValueError('The filesystem is already mounted.')
                return item
            found = walk(item.get('children', []))
            if found:
                return found
        return None
    match = walk(json.loads(output)['blockdevices'])
    if not match:
        raise ValueError('No eligible filesystem found for this UUID.')
    return match


def fstab_lines():
    return FSTAB.read_text(encoding='utf-8').splitlines(keepends=True)


def replace_fstab(lines):
    previous = FSTAB.read_bytes()
    fd, temp = tempfile.mkstemp(dir=str(FSTAB.parent), prefix='.yrm-fstab-')
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(''.join(lines).encode('utf-8'))
        os.replace(temp, FSTAB)
        return previous
    finally:
        if os.path.exists(temp): os.unlink(temp)


def manual_mounts():
    if MANUAL.exists():
        values = json.loads(MANUAL.read_text(encoding='utf-8'))
        if isinstance(values, list): return values
    return []


def write_manual(mounts):
    fd, temp = tempfile.mkstemp(dir=str(MANUAL.parent), prefix='.yrm-manual-')
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream: json.dump(mounts, stream)
        os.replace(temp, MANUAL)
    finally:
        if os.path.exists(temp): os.unlink(temp)


def create_mount(uuid, dest, automatic):
    info = lookup(uuid)
    path = path_check(dest)
    if path.exists():
        if not path.is_dir() or any(path.iterdir()):
            raise ValueError('Mount folder must be empty; existing files must not be hidden.')
    else:
        if not path.parent.is_dir():
            raise ValueError('Create the parent folder first in Files.')
        path.mkdir(mode=0o755)
    mount_point = str(path)
    if run(['/usr/bin/findmnt', '-n', '-o', 'TARGET', '--target', mount_point]) == mount_point:
        raise ValueError('This location is already a mount point.')
    if any(mount_point == line.split()[1] for line in fstab_lines() if len(line.split()) >= 2 and not line.lstrip().startswith('#')):
        raise ValueError('The target already exists in fstab.')
    created_fstab = False
    old_fstab = None
    try:
        run(['/usr/bin/mount', '-t', info['fstype'], '-U', uuid, mount_point])
        if automatic:
            old = fstab_lines()
            options = 'defaults,nofail,x-systemd.device-timeout=10s'
            new_entry = f'UUID={uuid} {mount_point} {info["fstype"]} {options} 0 2 {MARKER}{uuid}\n'
            old_fstab = replace_fstab(old + [new_entry])
            created_fstab = True
            run(['/usr/bin/systemctl', 'daemon-reload'])
        else:
            manual = manual_mounts()
            if mount_point not in manual: manual.append(mount_point)
            write_manual(manual)
    except Exception:
        if created_fstab and old_fstab is not None:
            FSTAB.write_bytes(old_fstab)
        subprocess.run(['/usr/bin/umount', mount_point], capture_output=True)
        raise
    # No chmod/chown on a mounted filesystem: preserve real filesystem ownership.
    emit(True, f'Mounted existing filesystem at {mount_point}.')


def unmount(dest):
    path = path_check(dest)
    target = str(path)
    lines = fstab_lines()
    managed = [line for line in lines if MARKER in line and len(line.split()) >= 2 and line.split()[1] == target]
    # Refuse to unmount manually configured or OS-critical mounts.
    manual = manual_mounts()
    if not managed and target not in manual:
        raise ValueError('Only YRM Panel managed volumes can be unmounted from this page.')
    run(['/usr/bin/umount', target])
    old = replace_fstab([line for line in lines if line not in managed]) if managed else None
    if target in manual: write_manual([x for x in manual if x != target])
    try:
        run(['/usr/bin/systemctl', 'daemon-reload'])
    except Exception:
        if old is not None: FSTAB.write_bytes(old)
        raise
    emit(True, 'Disk unmounted. Existing files and the mount directory were preserved.')


if __name__ == '__main__':
    try:
        if os.geteuid() != 0: raise ValueError('Root helper is required.')
        if len(sys.argv) == 5 and sys.argv[1] == 'mount' and sys.argv[4] in ('auto', 'manual'):
            create_mount(sys.argv[2], sys.argv[3], sys.argv[4] == 'auto')
        elif len(sys.argv) == 3 and sys.argv[1] == 'unmount':
            unmount(sys.argv[2])
        else: raise ValueError('Unsupported mount operation.')
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        emit(False, str(error))
        raise SystemExit(1)
