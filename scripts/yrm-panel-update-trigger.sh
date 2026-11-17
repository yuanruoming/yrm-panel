#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID}" -eq 0 && "$#" -eq 1 && "$1" == start ]] || {
  printf '{"ok":false,"message":"Invalid update request."}\n'; exit 1;
}
if systemctl list-units --no-legend 'yrm-panel-update-*' | grep -q 'running'; then
  printf '{"ok":false,"message":"An update is already running."}\n'; exit 1
fi
status=/var/lib/yrm-panel/update-status.json
printf '{"state":"running","message":"Updating from GitHub Release."}\n' > "$status"
chmod 0644 "$status"
unit="yrm-panel-update-$(date +%s)"
if systemd-run --quiet --collect --unit="$unit" --property=Type=exec /usr/local/sbin/yrm-panel-update; then
  printf '{"ok":true,"message":"Update started. The panel may briefly disconnect."}\n'
else
  printf '{"state":"failed","message":"Could not start updater."}\n' > "$status"
  printf '{"ok":false,"message":"Could not start updater."}\n'
  exit 1
fi
