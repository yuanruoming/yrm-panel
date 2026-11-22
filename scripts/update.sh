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

# Same trust root as install.sh. Keep both lists in sync when rotating keys.
MINISIGN_PUBKEYS=(
  # 'RWQ...primary...'
  # 'RWQ...rotation...'
)
ALLOW_UNSIGNED=0
if (($#)); then
  [[ "$1" == '--allow-unsigned' ]] || { echo 'Usage: yrm-panel-update [--allow-unsigned]' >&2; exit 2; }
  ALLOW_UNSIGNED=1
fi
release_keys_configured() {
  local key
  for key in "${MINISIGN_PUBKEYS[@]}"; do
    [[ -n "$key" && "$key" != \#* ]] && return 0
  done
  return 1
}
verify_release_signature() {
  local manifest=$1 signature=$2
  release_keys_configured || return 0
  if ((ALLOW_UNSIGNED == 1)); then
    echo 'WARNING: --allow-unsigned was given; the release signature was not checked.' >&2
    return 0
  fi
  [[ -s "$manifest" && -s "$signature" ]] || {
    echo 'The release manifest or its signature is missing; refusing to update.' >&2; return 1; }
  if ! command -v minisign >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y minisign >/dev/null
  fi
  local key
  for key in "${MINISIGN_PUBKEYS[@]}"; do
    [[ -n "$key" && "$key" != \#* ]] || continue
    if minisign -V -q -P "$key" -m "$manifest" -x "$signature" >/dev/null 2>&1; then
      return 0
    fi
  done
  echo 'The release signature does not match any trusted YRM Panel key.' >&2
  return 1
}

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

release_tag="$CHANNEL"
if [[ "$CHANNEL" == stable ]]; then
  latest=$(curl -fLSs --retry 3 --connect-timeout 10 --max-time 40 \
    "https://api.github.com/repos/${REPO}/releases/latest")
  release_tag=$(printf '%s' "$latest" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
  [[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
fi
case "$(dpkg --print-architecture)" in
  amd64) platform=linux-x64;;
  arm64) platform=linux-arm64;;
  *) echo 'Unsupported architecture.' >&2; exit 2;;
esac
asset="yrm-panel-$platform.tar.gz"
base="https://github.com/${REPO}/releases/download/${release_tag}"

# Download and verify the manifest before the tarball. The bundled install.sh
# inside the verified tarball is then used, so an update never executes a script
# fetched from a mutable branch.
write_status running 'Downloading the signed release manifest.' Verifying
curl -fLSs --retry 3 --connect-timeout 10 --max-time 45 "$base/release.json" -o "$workdir/release.json"
if release_keys_configured; then
  curl -fLSs --retry 3 --connect-timeout 10 --max-time 45 \
    "$base/release.json.minisig" -o "$workdir/release.json.minisig"
fi
verify_release_signature "$workdir/release.json" "$workdir/release.json.minisig"
manifest_sha=$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
print(d.get("assets",{}).get(sys.argv[2],""))' "$workdir/release.json" "$asset")
[[ "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "The release manifest does not list $asset." >&2; exit 2; }

write_status running 'Downloading the verified release.' Downloading
curl -fLSs --retry 3 --connect-timeout 10 --max-time 300 "$base/$asset" -o "$workdir/$asset"
actual_sha=$(sha256sum "$workdir/$asset" | awk '{print $1}')
[[ "$actual_sha" == "$manifest_sha" ]] || { echo 'The downloaded release does not match the signed manifest.' >&2; exit 1; }

mkdir -p "$workdir/publish" "$workdir/assets"
tar -xzf "$workdir/$asset" -C "$workdir/publish"
[[ -f "$workdir/publish/deployment/install.sh" ]] || {
  echo 'The release does not contain deployment/install.sh; refusing to update.' >&2; exit 1; }
cp -- "$workdir/$asset" "$workdir/assets/$asset"
printf '%s  %s\n' "$manifest_sha" "$asset" >"$workdir/assets/$asset.sha256"

write_status running 'Installing the verified release.' Installing
# install.sh preserves Linux identity, certificates, and all existing data.
export YRM_PANEL_UPDATE_STATUS_FILE="$status"
bash "$workdir/publish/deployment/install.sh" \
  --repo "$REPO" --channel "$CHANNEL" --branch "$BRANCH" \
  --user "$PANEL_USER" --port "$PORT" --https-port "$HTTPS_PORT" \
  --bind "${BIND:-0.0.0.0}" --noninteractive --local-dir "$workdir/assets"
write_status completed 'YRM Panel updated successfully.' Completed 100
finished=1
