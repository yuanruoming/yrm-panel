#!/usr/bin/env bash
# Removes only YRM Panel. NEVER uninstall Docker, Samba, shares or user data.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
PURGE=0
if (($#)); then
  [[ "$#" == 1 && "$1" == "--purge" ]] || { echo 'Usage: yrm-panel-uninstall [--purge]' >&2; exit 2; }
  PURGE=1
fi
systemctl disable --now yrm-panel.service 2>/dev/null || true
rm -f /etc/systemd/system/yrm-panel.service
systemctl daemon-reload
rm -rf /opt/yrm-panel /opt/yrm-panel.previous
rm -f /usr/local/sbin/yrm-panel-update /usr/local/sbin/yrm-panel-uninstall
rm -f /etc/sudoers.d/yrm-panel-samba /etc/sudoers.d/yrm-panel-power
rm -f /usr/local/libexec/yrm-panel-power /usr/local/libexec/yrm-panel-samba
# Revoke the Panel's root-equivalent Docker socket access; do not touch Docker itself.
if command -v gpasswd >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
  gpasswd -d yrm-panel docker >/dev/null 2>&1 || true
fi
# Revoke any file-user group membership that the installer added for /data access.
if [[ -r /etc/yrm-panel/samba-user ]] && command -v gpasswd >/dev/null 2>&1; then
  file_user=$(cat /etc/yrm-panel/samba-user)
  if id "$file_user" >/dev/null 2>&1; then
    group_name=$(id -gn "$file_user")
    if [[ "$group_name" == "$file_user" ]]; then
      gpasswd -d yrm-panel "$group_name" >/dev/null 2>&1 || true
    fi
  fi
fi
# Intentionally leave /etc/samba/yrm-panel-shares.conf and its include in smb.conf.
# Otherwise the user's live Samba shares would disappear on uninstall.
if ((PURGE)); then
  rm -rf /var/lib/yrm-panel /etc/yrm-panel
  echo 'Panel-only configuration and wallpapers removed.'
else
  echo 'Panel settings and wallpapers preserved in /var/lib/yrm-panel and /etc/yrm-panel.'
fi
echo 'YRM Panel uninstalled. Docker, Samba, /data, /backup, and Samba shares are untouched.'
