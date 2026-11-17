#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $EUID -ne 0 || $# -ne 1 || ( "$1" != reboot && "$1" != shutdown ) ]]; then
  printf '{"ok":false,"message":"Unsupported power operation."}\n'; exit 1
fi
case "$1" in
  reboot) operation=reboot;;
  shutdown) operation=poweroff;;
esac
if systemctl --no-block "$operation"; then
  printf '{"ok":true,"message":"System power operation requested."}\n'
else
  printf '{"ok":false,"message":"Unable to request system power operation."}\n'
  exit 1
fi
