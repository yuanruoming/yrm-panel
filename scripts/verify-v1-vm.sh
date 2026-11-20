#!/usr/bin/env bash
# Single-admin Ubuntu VM lifecycle acceptance. Explicit opt-in is mandatory.
# No mkfs, parted, wipefs, UFW change, root data deletion or forced unmount.
set -Eeuo pipefail
umask 077
MODE=inspect
PANEL_USER=''
VOLUME_UUID=''
CONFIRM=0
REPO='yuanruoming/yrm-panel'
BRANCH='master'
PORT=6080
HTTPS_PORT=6081
while (($#)); do
  case "$1" in
    --inspect) MODE=inspect;shift;;
    --lifecycle) MODE=lifecycle;shift;;
    --user) PANEL_USER="${2:?}";shift 2;;
    --test-volume-uuid) VOLUME_UUID="${2:?}";shift 2;;
    --confirm-test-vm) CONFIRM=1;shift;;
    --repo) REPO="${2:?}";shift 2;;
    --branch) BRANCH="${2:?}";shift 2;;
    --https-port) HTTPS_PORT="${2:?}";shift 2;;
    *) echo "Unknown argument: $1" >&2;exit 2;;
  esac
done
pass(){ printf '[PASS] %s\n' "$*"; }
skip(){ printf '[SKIP] %s\n' "$*"; }
fail(){ printf '[FAIL] %s\n' "$*" >&2;exit 1; }

# Default mode is inspect-only and safe on an ordinary server.
if [[ "$MODE" == inspect ]]; then
  echo '=== Read-only Ubuntu inspection ==='
  systemctl is-enabled yrm-panel.service 2>/dev/null || true
  systemctl is-active yrm-panel.service 2>/dev/null || true
  command -v docker >/dev/null && docker compose version || true
  command -v testparm >/dev/null && testparm -s >/dev/null && pass 'Samba configuration parses' || true
  findmnt -n -o TARGET,SOURCE,FSTYPE / || true
  echo 'No installation, update, mount, firewall change or uninstall was executed.'
  exit 0
fi

# Both independent guards are required, not just a --yes switch.
(( EUID == 0 )) || fail 'Lifecycle mode requires sudo.'
(( CONFIRM == 1 )) || fail 'Supply --confirm-test-vm explicitly.'
command -v systemd-detect-virt >/dev/null || fail 'Cannot verify virtualization.'
systemd-detect-virt --vm --quiet || fail 'Refusing lifecycle on a physical/non-VM host.'
MARKER='/etc/yrm-panel-test-vm'
[[ -f "$MARKER" && ! -L "$MARKER" && "$(stat -c %u "$MARKER")" == 0 ]] || \
  fail 'Missing root-owned /etc/yrm-panel-test-vm marker.'
grep -qx 'YRM_PANEL_TEST_VM=1' "$MARKER" || fail 'Invalid test VM marker.'
[[ "$PANEL_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] && id "$PANEL_USER" >/dev/null 2>&1 || \
  fail 'Specify an existing non-root Linux user with --user.'
(( $(id -u "$PANEL_USER") >= 1000 )) || fail 'Test user must be a normal account.'
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Invalid repository.'
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail 'Invalid branch.'
[[ "$HTTPS_PORT" =~ ^[0-9]{4,5}$ ]] || fail 'Invalid HTTPS port.'
[[ ! -e /opt/yrm-panel && ! -e /etc/systemd/system/yrm-panel.service ]] || \
  fail 'This VM already has YRM Panel installed; restore the clean VM snapshot.'

# Optional preformatted test volume is opt-in AND bound to the VM marker.
if [[ -n "$VOLUME_UUID" ]]; then
  [[ "$VOLUME_UUID" =~ ^[A-Za-z0-9-]{4,80}$ ]] || fail 'Invalid UUID.'
  grep -qx "TEST_VOLUME_UUID=$VOLUME_UUID" "$MARKER" || \
    fail 'The test UUID must be explicitly registered in the root-owned VM marker.'
  [[ -e "/dev/disk/by-uuid/$VOLUME_UUID" ]] || fail 'Test volume does not exist.'
  fs=$(blkid -s TYPE -o value "/dev/disk/by-uuid/$VOLUME_UUID" || true)
  [[ "$fs" == ext4 ]] || fail 'Only a preformatted ext4 test volume is eligible.'
  root_uuid=$(findmnt -n -o UUID / || true)
  [[ "$VOLUME_UUID" != "$root_uuid" ]] || fail 'Refusing to touch the system root filesystem.'
  [[ -z "$(findmnt -n -S "UUID=$VOLUME_UUID" -o TARGET 2>/dev/null || true)" ]] || \
    fail 'The designated test volume is already mounted.'
fi

report=$(mktemp -d /var/tmp/yrm-panel-lifecycle.XXXXXXXX)
chmod 0700 "$report"
exec > >(tee -a "$report/verify.log") 2>&1
printf 'YRM Panel lifecycle report: %s\n' "$report/verify.log"
trap 'code=$?; if ((code != 0));then echo "[FAIL] Lifecycle stopped at line $LINENO (exit $code). Restore VM snapshot before retrying.";fi' EXIT

# Read-only baseline. The installer may install standard packages and enable
# services, but MUST NOT delete or reformat user files.
if command -v docker >/dev/null;then docker info >/dev/null 2>&1 || true;fi
if command -v testparm >/dev/null;then testparm -s >/dev/null;fi
findmnt -n -o SOURCE,FSTYPE / >"$report/baseline-root.txt"
if command -v ufw >/dev/null;then ufw status >"$report/baseline-ufw.txt" || true;fi
pass 'Clean VM baseline recorded'

src=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ -f "$src/scripts/install.sh" ]] || fail 'Run this from the checked-out YRM Panel repository.'
# Installer uses repository dev artifacts, NOT untrusted local build paths.
bash "$src/scripts/install.sh" --repo "$REPO" --branch "$BRANCH" --channel dev \
  --user "$PANEL_USER" --port "$PORT" --https-port "$HTTPS_PORT" --bind 127.0.0.1 --noninteractive
systemctl is-enabled --quiet yrm-panel.service || fail 'Panel is not enabled on boot.'
systemctl is-active --quiet yrm-panel.service || fail 'Panel service is not active.'
code=$(curl -ksS --max-time 15 -o /dev/null -w '%{http_code}' \
  "https://127.0.0.1:$HTTPS_PORT/Account/Login" || true)
[[ "$code" == 200 ]] || fail "HTTPS Login responded $code."
pass 'Install + systemd enablement + live HTTPS Login'

# Isolated read/write checks; no existing Linux user directories are changed.
fixture=$(runuser -u "$PANEL_USER" -- mktemp -d "/home/$PANEL_USER/.yrm-vm-test.XXXXXXXX")
case "$fixture" in "/home/$PANEL_USER/.yrm-vm-test."*) ;; *) fail 'Unexpected fixture path.';; esac
runuser -u "$PANEL_USER" -- sh -c 'printf testing > "$1/original.txt"; cp "$1/original.txt" "$1/copy.txt"; mv "$1/copy.txt" "$1/moved.txt"; test -f "$1/original.txt" && test -f "$1/moved.txt"' sh "$fixture"
pass 'Linux filesystem create/copy/move (temporary fixture only)'

[[ $(systemctl is-active docker.service) == active ]] || fail 'Docker service unavailable.'
docker info >/dev/null && docker compose version >/dev/null && docker ps >/dev/null || fail 'Docker Engine/Compose API unavailable.'
pass 'Docker Engine and Compose Plugin available'

[[ $(systemctl is-active smbd.service) == active ]] || fail 'Samba service unavailable.'
testparm -s >/dev/null || fail 'Samba configuration invalid.'
share="yrmtest_$RANDOM"
helper=/usr/local/libexec/yrm-panel-samba
[[ -x "$helper" ]] || fail 'Missing Samba helper.'
python3 "$helper" save "$share" "$fixture" false
# If save fails, stop rather than leaving a partially managed rule.
testparm -s >/dev/null || fail 'SMB share configuration failed validation.'
python3 "$helper" delete "$share"
testparm -s >/dev/null || fail 'SMB share removal left invalid configuration.'
[[ -f "$fixture/original.txt" ]] || fail 'Unshare deleted files.'
pass 'Temporary Samba share create/remove; files preserved'
skip 'SMB authenticated Windows file traffic requires a separate credentials-enabled test.'

if [[ -n "$VOLUME_UUID" ]]; then
  target="/mnt/yrm-acceptance-${VOLUME_UUID:0:12}"
  [[ ! -e "$target" ]] || fail 'Refusing existing test mount directory.'
  mkdir "$target"
  /usr/local/libexec/yrm-panel-mount mount "$VOLUME_UUID" "$target" auto
  [[ "$(findmnt -n -o UUID --mountpoint "$target")" == "$VOLUME_UUID" ]] || fail 'Mount UUID mismatch.'
  grep -qF "UUID=$VOLUME_UUID $target " /etc/fstab || fail 'Persistent fstab entry not found.'
  pass 'Mounted explicitly registered preformatted test volume; fstab persisted'
else
  skip 'Volume mount (no explicitly registered test UUID; no disk operation performed)'
fi

if command -v ufw >/dev/null;then ufw status >/dev/null;pass 'UFW read-only state';fi
skip 'Remote disconnect/rollback test (requires isolated network harness)'
skip 'Real DDNS update (requires provider test credentials)'
skip 'Cross-version update (needs two pinned published release artifacts)'

# Reinstall/upgrade-in-place without changing versions. Proves cert and service
# identity persistence, but is NOT reported as a successful version upgrade.
cert_before=$(sha256sum /var/lib/yrm-panel/tls/* 2>/dev/null | sort || true)
bash "$src/scripts/install.sh" --repo "$REPO" --branch "$BRANCH" --channel dev \
  --user "$PANEL_USER" --port "$PORT" --https-port "$HTTPS_PORT" --bind 127.0.0.1 --noninteractive
systemctl is-active --quiet yrm-panel.service || fail 'Reinstall failed.'
cert_after=$(sha256sum /var/lib/yrm-panel/tls/* 2>/dev/null | sort || true)
[[ "$cert_before" == "$cert_after" ]] || fail 'TLS identity directory entries changed after reinstall.'
pass 'In-place reinstallation and TLS file persistence'

# Keep the test mount active while uninstalling: proves fstab and mount are Linux
# state, not UI state. The designated test VM will be restored from snapshot.
/usr/local/sbin/yrm-panel-uninstall
! systemctl is-active --quiet yrm-panel.service || fail 'Panel service still running after uninstall.'
[[ ! -e /opt/yrm-panel ]] || fail 'Panel program still installed.'
docker info >/dev/null && docker compose version >/dev/null || fail 'Docker not preserved.'
testparm -s >/dev/null || fail 'Samba config not preserved.'
[[ -f "$fixture/original.txt" ]] || fail 'Test data not preserved.'
if [[ -n "$VOLUME_UUID" ]];then
  [[ "$(findmnt -n -o UUID --mountpoint "$target")" == "$VOLUME_UUID" ]] || fail 'Test mount disappeared after uninstall.'
  grep -qF "UUID=$VOLUME_UUID $target " /etc/fstab || fail 'fstab record disappeared after uninstall.'
fi
pass 'Uninstall preserves Linux files, Docker, Samba and registered mount'
runuser -u "$PANEL_USER" -- rm -rf -- "$fixture"
pass 'Removed only temporary user fixture; VM-mounted test volume intentionally retained'
cat <<RESULT
=== VERIFIED (see $report/verify.log) ===
Install + HTTPS + systemd, Linux file operations, Docker, Samba config,
optional preformatted mount, in-place reinstallation, uninstall persistence.
Important SKIPs are documented in log, not counted as PASS.
Do not run on production. Restore the clean VM snapshot after this run.
RESULT
