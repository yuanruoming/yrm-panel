#!/usr/bin/env bash
# Systemd transient updater: survives web-service restart and records a
# terminal state even if install.sh/download exits nonzero or is interrupted.
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
  # These fixed messages never contain unchecked command or API output.
  local percentage="${4:-null}"
  local temp_status
  temp_status=$(mktemp /var/lib/yrm-panel/.update-progress.XXXXXX)
  printf '{"state":"%s","message":"%s","at":"%s","phase":"%s","percent":%s}\n' \
    "$1" "$2" "$(date -u +%FT%TZ)" "${3:-Checking}" "$percentage" > "$temp_status"
  chmod 0644 "$temp_status"
  mv -f -- "$temp_status" "$status"
}
workdir=$(mktemp -d)
finished=0
finish_update() {
  local code=$?
  trap - EXIT
  if ((finished == 0)); then
    write_status failed 'Update failed or was interrupted. Check service logs and installed version.' Failed || true
  fi
  rm -rf -- "$workdir"
  exit "$code"
}
trap finish_update EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
write_status running 'Checking the selected release.' Checking
script_ref="$BRANCH"
if [[ "$CHANNEL" == stable ]]; then
  latest=$(curl -fLSs --retry 3 --connect-timeout 10 --max-time 40 \
    "https://api.github.com/repos/${REPO}/releases/latest")
  script_ref=$(printf '%s' "$latest" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
  [[ "$script_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
fi
curl -fLSs --retry 3 --connect-timeout 10 --max-time 45 \
  "https://raw.githubusercontent.com/${REPO}/${script_ref}/scripts/install.sh" -o "$workdir/install.sh"
# install.sh preserves Linux identity, certificates, and all existing data.
export YRM_PANEL_UPDATE_STATUS_FILE="$status"
bash "$workdir/install.sh" \
  --repo "$REPO" --channel "$CHANNEL" --branch "$BRANCH" \
  --user "$PANEL_USER" --port "$PORT" --https-port "$HTTPS_PORT" \
  --bind "${BIND:-0.0.0.0}" --noninteractive
write_status completed 'YRM Panel updated successfully.' Completed 100
finished=1
