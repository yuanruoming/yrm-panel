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
  printf '{"state":"%s","message":"%s","at":"%s"}\n' "$1" "$2" "$(date -u +%FT%TZ)" > "$status"
  chmod 0644 "$status"
}
on_failure() { write_status failed 'Update failed. Existing binaries were preserved or rolled back.'; }
trap on_failure ERR
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
write_status running 'Downloading the latest release.'
curl -fLSs --retry 3 --connect-timeout 10 \
  "https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/install.sh" -o "$workdir/install.sh"
# install.sh preserves the selected Linux user, certificate and Panel data.
bash "$workdir/install.sh" \
  --repo "$REPO" --channel "$CHANNEL" --branch "$BRANCH" \
  --user "$PANEL_USER" --port "$PORT" --https-port "$HTTPS_PORT" \
  --bind "${BIND:-0.0.0.0}" --noninteractive
write_status completed 'YRM Panel updated successfully.'
