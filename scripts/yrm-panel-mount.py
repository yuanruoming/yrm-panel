#!/usr/bin/env python3
"""Restricted mount operations and separately confirmed empty-disk provisioning.

Normal mounts never format or hide files. Provisioning requires explicit confirmation
and revalidates device identity, filesystem signatures and actual post-write state.
"""
import json
import stat
import time
import shutil
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
    output = run(['/usr/bin/lsblk', '-J', '--tree', '-p', '-o', 'PATH,TYPE,UUID,FSTYPE,MOUNTPOINTS,RO'])
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


# Never run any partitioning command against an already used device. This code
# intentionally supports only a blank whole disk; existing partitions or
# signatures cannot be modified through the Panel.
DISK_NAME = re.compile(r'^/dev/(?:sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme[0-9]+n[0-9]+)$')


def identify_blank_disk(device):
    if not DISK_NAME.fullmatch(device) or os.path.realpath(device) != device:
        raise ValueError('Only an unambiguous whole-disk /dev path is supported.')
    if not pathlib.Path(device).exists() or not stat.S_ISBLK(os.stat(device).st_mode):
        raise ValueError('Selected disk is not a block device.')
    output = run(['/usr/bin/lsblk', '-J', '--tree', '-p', '-o',
                  'PATH,TYPE,FSTYPE,UUID,MOUNTPOINTS,RO,RM,PTTYPE'])
    devices = json.loads(output).get('blockdevices', [])
    def walk(items):
        for entry in items:
            if entry.get('path') == device:
                return entry
            found = walk(entry.get('children') or [])
            if found is not None:
                return found
        return None
    item = walk(devices)
    if item is None or item.get('type') != 'disk':
        raise ValueError('The requested device is not a whole disk.')
    if item.get('ro') or item.get('rm') or item.get('fstype') or item.get('uuid') or item.get('pttype'):
        raise ValueError('Disk is removable, read-only, partitioned or already contains a filesystem.')
    if item.get('children') or any(item.get('mountpoints') or []):
        raise ValueError('Disk contains partitions or is mounted. Refusing initialization.')
    wipefs = shutil.which('wipefs')
    blkid = shutil.which('blkid')
    if not wipefs or not blkid or not shutil.which('parted') or not shutil.which('mkfs.ext4'):
        raise ValueError('Required disk tools (wipefs, blkid, parted, mkfs.ext4) are missing.')
    probe = subprocess.run([wipefs, '--no-act', '--noheadings', '--output', 'TYPE', device],
                           capture_output=True, text=True, timeout=12)
    if probe.returncode != 0 or probe.stdout.strip():
        raise ValueError('Existing disk signature detected or signature inspection failed.')
    secondary = subprocess.run([blkid, '-p', device], capture_output=True, timeout=12)
    if secondary.returncode != 2:
        raise ValueError('Disk identification is not conclusively blank.')
    return item


def find_new_partition(device, attempts=30):
    """Wait for kernel/udev to expose the partition; never guess a block-device path."""
    probe = shutil.which('partprobe')
    if probe:
        subprocess.run([probe, device], capture_output=True, timeout=15, check=False)
    udevadm = shutil.which('udevadm')
    if udevadm:
        subprocess.run([udevadm, 'settle', '--timeout=15'], capture_output=True, timeout=20, check=False)
    for attempt in range(attempts):
        output = run(['/usr/bin/lsblk', '-J', '--tree', '-p', '-o',
                      'PATH,TYPE,FSTYPE,UUID,MOUNTPOINTS,RO,RM,PTTYPE'])
        def search(entries):
            for row in entries:
                if row.get('path') == device: return row
                child = search(row.get('children') or [])
                if child is not None: return child
            return None
        disk = search(json.loads(output).get('blockdevices', []))
        children = (disk or {}).get('children') or []
        if len(children) == 1 and children[0].get('type') == 'part':
            candidate = children[0]
            path = candidate.get('path')
            if (isinstance(path, str) and path.startswith(device) and
                    not candidate.get('fstype') and not candidate.get('uuid') and
                    not any(candidate.get('mountpoints') or []) and
                    pathlib.Path(path).exists() and stat.S_ISBLK(os.stat(path).st_mode)):
                return path
            raise ValueError('New partition did not match the expected empty state. Refusing to format.')
        if len(children) > 1:
            raise ValueError('Unexpected multiple partitions. Refusing to format.')
        time.sleep(1)
    raise ValueError('Partition created but not yet recognized. Refresh Storage; use Complete Setup after verifying the disk.')


def verify_ext4(partition):
    # Formatting command exit status alone is not evidence of a usable filesystem.
    uuid = run(['/usr/sbin/blkid', '-s', 'UUID', '-o', 'value', partition]).strip()
    fstype = run(['/usr/sbin/blkid', '-s', 'TYPE', '-o', 'value', partition]).strip()
    if not uuid or fstype != 'ext4' or not UUID_RE.fullmatch(uuid):
        raise ValueError('Filesystem verification failed; no mount was attempted.')
    return uuid


def identify_recoverable_partition(partition):
    """Strictly a single blank GPT partition on a currently unused whole disk.

    This also supports the previous BETA3 case where parted succeeded but udev
    detected /dev/sdb1 after the helper had already exited. Confirmation and
    a sudo password are still required; no automatic formatting takes place.
    """
    path = pathlib.Path(partition)
    if not path.exists() or not stat.S_ISBLK(os.stat(partition).st_mode):
        raise ValueError('Selected partition is not a block device.')
    rows = json.loads(run(['/usr/bin/lsblk', '-J', '--tree', '-p', '-b', '-o',
        'PATH,TYPE,FSTYPE,UUID,MOUNTPOINTS,RO,RM,PTTYPE,PARTLABEL,SIZE'])).get('blockdevices', [])
    selected = None
    def scan(entries):
        nonlocal selected
        for disk in entries:
            children = disk.get('children') or []
            if disk.get('type') == 'disk' and any(c.get('path') == partition for c in children):
                selected = (disk, children)
                return
            scan(children)
    scan(rows)
    if selected is None: raise ValueError('Partition is not directly attached to a recognized disk.')
    disk, children = selected
    diskpath = disk.get('path') or ''
    if not DISK_NAME.fullmatch(diskpath) or os.path.realpath(diskpath) != diskpath:
        raise ValueError('Unsupported or ambiguous parent disk.')
    if len(children) != 1 or disk.get('pttype') != 'gpt':
        raise ValueError('Recovery requires exactly one GPT partition.')
    candidate = children[0]
    if (disk.get('ro') or disk.get('rm') or disk.get('fstype') or disk.get('uuid') or
            candidate.get('ro') or candidate.get('fstype') or candidate.get('uuid') or
            candidate.get('partlabel') not in ('primary', 'YRM-PANEL-DATA')):
        raise ValueError('The selected partition is not an eligible incomplete setup.')
    if any(disk.get('mountpoints') or []) or any(candidate.get('mountpoints') or []):
        raise ValueError('Mounted disks cannot be recovered.')
    size = int(disk.get('size') or 0)
    part_size = int(candidate.get('size') or 0)
    if size < 64*1024*1024 or part_size < size * 0.90:
        raise ValueError('Partition does not occupy the expected data disk.')
    for device in (diskpath, partition):
        probe = subprocess.run([shutil.which('wipefs') or '/usr/sbin/wipefs', '--no-act', '--noheadings', '--output', 'TYPE', device],
                               capture_output=True, text=True, timeout=12)
        # The parent disk has a GPT signature: the partition must be empty.
        if probe.returncode != 0 or (device == partition and probe.stdout.strip()):
            raise ValueError('Partition contains a signature or cannot be safely inspected.')
    # `blkid -p` can return 0 for GPT PART_ENTRY_* metadata on a blank
    # partition. Only filesystem TYPE identifies formatted contents here.
    raw = subprocess.run([shutil.which('blkid') or '/usr/sbin/blkid',
                          '-p', '-s', 'TYPE', '-o', 'value', partition],
                         capture_output=True, text=True, timeout=12)
    if raw.returncode not in (0, 2) or raw.stdout.strip():
        raise ValueError('Partition contains a filesystem or could not be safely inspected.')
    return diskpath


def complete_setup(partition, confirmation):
    if confirmation != 'FORMAT ' + partition:
        raise ValueError('Type FORMAT followed by the exact partition path to confirm.')
    identify_recoverable_partition(partition)
    identify_recoverable_partition(partition)
    mkfs = shutil.which('mkfs.ext4')
    if not mkfs: raise ValueError('mkfs.ext4 is not installed.')
    run([mkfs, '-F', partition], timeout=120)
    uuid = verify_ext4(partition)
    emit(True, f'Filesystem created and verified (UUID {uuid}). Now mount it in Storage.')


def initialize_blank_disk(device, confirmation):
    # Never infer permission from the text: the entire helper runs via explicit sudo.
    if confirmation != 'ERASE ' + device:
        raise ValueError('Type ERASE followed by the exact disk path to confirm.')
    identify_blank_disk(device)
    identify_blank_disk(device)
    parted = shutil.which('parted')
    mkfs = shutil.which('mkfs.ext4')
    if not parted or not mkfs: raise ValueError('Disk initialization utilities are missing.')
    run([parted, '-s', '--align', 'optimal', device, 'mklabel', 'gpt',
         'mkpart', 'YRM-PANEL-DATA', 'ext4', '1MiB', '100%'], timeout=60)
    partition = find_new_partition(device)
    # After the partition appears, ensure it is still the sole blank partition.
    identify_recoverable_partition(partition)
    run([mkfs, '-F', partition], timeout=120)
    uuid = verify_ext4(partition)
    emit(True, f'Initialized {device} as ext4 (UUID {uuid}). Mount the new filesystem in Storage.')


if __name__ == '__main__':
    try:
        if os.geteuid() != 0: raise ValueError('Root helper is required.')
        if len(sys.argv) == 5 and sys.argv[1] == 'mount' and sys.argv[4] in ('auto', 'manual'):
            create_mount(sys.argv[2], sys.argv[3], sys.argv[4] == 'auto')
        elif len(sys.argv) == 3 and sys.argv[1] == 'unmount':
            unmount(sys.argv[2])
        elif len(sys.argv) == 4 and sys.argv[1] == 'initialize':
            initialize_blank_disk(sys.argv[2], sys.argv[3])
        elif len(sys.argv) == 4 and sys.argv[1] == 'complete':
            complete_setup(sys.argv[2], sys.argv[3])
        else: raise ValueError('Unsupported mount operation.')
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        emit(False, str(error))
        raise SystemExit(1)
