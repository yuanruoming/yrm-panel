#!/usr/bin/env bash
# Safe to invoke from any directory; root systemd unit outlives the Panel process.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Use sudo yrm-panel-update' >&2; exit 1; }
source /etc/yrm-panel/source.env
[[ "${REPO:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 2
[[ "${BRANCH:-}" =~ ^[A-Za-z0-9._/-]+$ ]] || exit 2
[[ "${PANEL_USER:-}" =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ "${PORT:-}" =~ ^[0-9]{4,5}$ ]] || exit 2
[[ "${HTTPS_PORT:-}" =~ ^[0-9]{4,5}$ ]] || exit 2
status=/var/lib/yrm-panel/update-status.json
write_status() {
  # All messages written here are fixed strings, not unsanitized process output.
  local percentage="${4:-null}"
  local temp_status
  temp_status=$(mktemp /var/lib/yrm-panel/.update-progress.XXXXXX)
  printf '{"state":"%s","message":"%s","at":"%s","phase":"%s","percent":%s}\n' \
    "$1" "$2" "$(date -u +%FT%TZ)" "${3:-Checking}" "$percentage" > "$temp_status"
  chmod 0644 "$temp_status"
  mv -f -- "$temp_status" "$status"
}
on_failure() { write_status failed 'Update failed. Existing binaries were preserved or rolled back.' Failed; }
trap on_failure ERR
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
write_status running 'Checking the selected release.' Checking
script_ref="$BRANCH"
if [[ "$CHANNEL" == stable ]]; then
  latest=$(curl -fLSs --retry 3 --connect-timeout 10 \
    "https://api.github.com/repos/${REPO}/releases/latest")
  script_ref=$(printf '%s' "$latest" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
  [[ "$script_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
fi
curl -fLSs --retry 3 --connect-timeout 10 \
  "https://raw.githubusercontent.com/${REPO}/${script_ref}/scripts/install.sh" -o "$workdir/install.sh"
# install.sh preserves the selected Linux user, certificate and Panel data.
export YRM_PANEL_UPDATE_STATUS_FILE="$status"
bash "$workdir/install.sh" \
  --repo "$REPO" --channel "$CHANNEL" --branch "$BRANCH" \
  --user "$PANEL_USER" --port "$PORT" --https-port "$HTTPS_PORT" \
  --bind "${BIND:-0.0.0.0}" --noninteractive
write_status completed 'YRM Panel updated successfully.' Completed 100
