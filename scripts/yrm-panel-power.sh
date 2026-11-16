#!/usr/bin/env bash
# Root-owned, fixed-command privileged adapter. No user-supplied command or path.
set -Eeuo pipefail
[[ $EUID -eq 0 && $# -eq 1 ]] || exit 2
case "$1" in
  reboot) action=reboot;;
  shutdown) action=poweroff;;
  *) exit 2;;
esac
# Allow HTTP response to finish before systemd starts the requested operation.
exec /usr/bin/systemd-run --quiet --collect --unit="yrm-panel-power-${action}" \
  --on-active=3s /usr/bin/systemctl "$action"
