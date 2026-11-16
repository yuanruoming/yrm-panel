#!/usr/bin/env bash
# Safe from any working directory; reads previous install source.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run sudo yrm-panel-update' >&2; exit 1; }
[[ -r /etc/yrm-panel/source.env ]] || { echo 'No source config found: install first.' >&2; exit 1; }
# Restricted config file written by installer; do not edit with untrusted values.
. /etc/yrm-panel/source.env
[[ "${REPO:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 2
[[ "${BRANCH:-}" =~ ^[A-Za-z0-9._/-]+$ ]] || exit 2
temp=$(mktemp)
trap 'rm -f "$temp"' EXIT
curl -fLSs --retry 3 --connect-timeout 10 \
  "https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/install.sh" -o "$temp"
# Updates preserve the existing password, settings, and endpoint configuration.
bash "$temp" --repo "$REPO" --channel "$CHANNEL" --branch "$BRANCH" --noninteractive
