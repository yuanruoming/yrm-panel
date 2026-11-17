#!/usr/bin/env bash
# Remove only YRM Panel. User accounts, Docker and all Samba shares survive.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Use sudo yrm-panel-uninstall' >&2; exit 1; }
PURGE=0
if (($#)); then
  [[ "$#" == 1 && "$1" == '--purge' ]] || { echo 'Usage: yrm-panel-uninstall [--purge]' >&2; exit 2; }
  PURGE=1
fi
systemctl disable --now yrm-panel.service 2>/dev/null || true
rm -f /etc/systemd/system/yrm-panel.service
systemctl daemon-reload
rm -rf /opt/yrm-panel /opt/yrm-panel.previous
rm -f /usr/local/sbin/yrm-panel-update /usr/local/sbin/yrm-panel-uninstall
rm -f /usr/local/libexec/yrm-panel-samba /usr/local/libexec/yrm-panel-storage \
  /usr/local/libexec/yrm-panel-power /usr/local/libexec/yrm-panel-update-trigger
rm -f /etc/sudoers.d/yrm-panel /etc/sudoers.d/yrm-panel-samba \
  /etc/sudoers.d/yrm-panel-storage /etc/sudoers.d/yrm-panel-power
rm -f /etc/pam.d/yrm-panel
if [[ -s /etc/yrm-panel/docker-group-added ]] && command -v gpasswd >/dev/null 2>&1; then
  user=$(cat /etc/yrm-panel/docker-group-added)
  if id "$user" >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
    gpasswd -d "$user" docker >/dev/null 2>&1 || true
  fi
  rm -f /etc/yrm-panel/docker-group-added
fi
# RC3 had a dedicated yrm-panel account with ACL grants. Clear only those
# legacy ACL entries, never current Linux-user ACLs or existing data.
if [[ -r /etc/yrm-panel/managed-roots.json ]] && command -v setfacl >/dev/null 2>&1; then
  python3 - <<'PYREMOVE'
import json, os, subprocess
try:
    for path in json.load(open('/etc/yrm-panel/managed-roots.json')):
        if isinstance(path, str) and path.startswith('/') and os.path.isdir(path):
            subprocess.run(['setfacl', '-x', 'u:yrm-panel', '-x', 'd:u:yrm-panel', path],
                check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except (OSError, ValueError, TypeError):
    pass
PYREMOVE
fi
# Do not remove /etc/samba/yrm-panel-shares.conf or its include in smb.conf:
# user-created native Samba shares must remain functional after uninstall.
if ((PURGE)); then
  rm -rf /var/lib/yrm-panel /etc/yrm-panel
  echo 'YRM Panel settings and custom wallpaper removed.'
else
  echo 'Panel settings, generated TLS certificate and wallpaper preserved.'
fi
echo 'Uninstalled YRM Panel. Linux accounts, files, Docker, and Samba shares remain.'
