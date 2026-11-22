#!/usr/bin/env bash
# Real install -> upgrade -> failed-upgrade rollback -> uninstall on a disposable
# Ubuntu host (CI runner). Runs the repository's install.sh/uninstall.sh as root
# against locally built release tarballs (install.sh --local-dir), no downloads.
# Usage (as root, from the repository root): tests/lifecycle/lifecycle.sh PUBLISH_DIR
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
PUBLISH=$(realpath "${1:?Usage: lifecycle.sh PUBLISH_DIR}")
REPO_ROOT=$(pwd)
PANEL_USER=yrmlife
HTTPS_PORT=6081
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }
expect() { local message=$1; shift; if "$@"; then pass "$message"; else fail "$message"; fi; }
sha() { sha256sum "$1" | awk '{print $1}'; }
login_status() { curl -ks -o /dev/null -w '%{http_code}' --max-time 4 "https://127.0.0.1:$HTTPS_PORT/Account/Login" || true; }
wait_for_login() {
  local attempt
  for attempt in $(seq 1 40); do [[ "$(login_status)" == 200 ]] && return 0; sleep 1; done
  return 1
}
no_sudoers_leftovers() { ! compgen -G '/etc/sudoers.d/.yrm-panel.*' >/dev/null; }
sudoers_valid() { visudo -c >/dev/null 2>&1; }

# Build a release tarball exactly like the release workflow lays it out.
# mode: normal | broken-binary | broken-samba-bootstrap
make_release() {
  local name=$1 mode=$2 dir="$WORK/release-$name" out="$WORK/assets-$name"
  rm -rf "$dir" "$out"; mkdir -p "$dir/deployment" "$out"
  cp -a "$PUBLISH/." "$dir/"
  cp "$REPO_ROOT"/packaging/yrm-panel.service "$REPO_ROOT"/packaging/yrm-panel-firewall-restore.service "$dir/deployment/"
  cp "$REPO_ROOT"/scripts/yrm-panel-samba.py "$REPO_ROOT"/scripts/yrm-panel-storage.py \
     "$REPO_ROOT"/scripts/yrm-panel-power.sh "$REPO_ROOT"/scripts/yrm-panel-update-trigger.sh \
     "$REPO_ROOT"/scripts/yrm-panel-mount.py "$REPO_ROOT"/scripts/yrm-panel-firewall.py "$dir/deployment/"
  cp "$REPO_ROOT"/scripts/update.sh "$REPO_ROOT"/scripts/uninstall.sh "$dir/deployment/"
  printf '%s\n' "$name" >"$dir/lifecycle-version.txt"   # identifies the program release
  # A harmless marker that identifies which release a helper came from.
  printf '\n# lifecycle-marker %s\n' "$name" >>"$dir/deployment/yrm-panel-power.sh"
  case "$mode" in
    broken-binary) printf '#!/bin/sh\nexit 1\n' >"$dir/YrmPanel"; chmod +x "$dir/YrmPanel";;
    broken-samba-bootstrap) printf '#!/bin/sh\nexit 1\n' >"$dir/deployment/yrm-panel-samba.py";;
  esac
  (cd "$dir" && tar -czf "$out/yrm-panel-linux-x64.tar.gz" .)
  (cd "$out" && sha256sum yrm-panel-linux-x64.tar.gz >yrm-panel-linux-x64.tar.gz.sha256)
}
run_install() {  # run_install RELEASE_NAME -> returns install.sh exit code
  bash "$REPO_ROOT/scripts/install.sh" --repo local/test --user "$PANEL_USER" --noninteractive \
    --port 6080 --https-port "$HTTPS_PORT" --local-dir "$WORK/assets-$1"
}
app_version() { cat /opt/yrm-panel/lifecycle-version.txt; }
marker() { grep -o 'lifecycle-marker [a-z0-9-]*' /usr/local/libexec/yrm-panel-power | tail -n 1; }
installed_hash() { cat /var/lib/yrm-panel/installed.sha256; }
release_hash() { awk '{print $1}' "$WORK/assets-$1/yrm-panel-linux-x64.tar.gz.sha256"; }

useradd -m -s /bin/bash "$PANEL_USER"
echo "$PANEL_USER:Lifecycle-Pass-12345" | chpasswd
make_release v1 normal; make_release v2 normal; make_release v5 normal
make_release v3-broken broken-binary
make_release v4-samba broken-samba-bootstrap

echo '== 1. first install'
run_install v1 && rc=0 || rc=$?
expect 'first install exits 0' test "$rc" -eq 0
expect 'panel answers the login page' wait_for_login
expect 'installed hash is the v1 release' test "$(installed_hash)" = "$(release_hash v1)"
expect 'helper comes from v1' test "$(marker)" = 'lifecycle-marker v1'
expect 'sudoers policy is valid' sudoers_valid
expect 'sudoers policy is installed' test -f /etc/sudoers.d/yrm-panel
expect 'no temporary sudoers file is left' no_sudoers_leftovers

echo '== 2. successful upgrade'
run_install v2 && rc=0 || rc=$?
expect 'upgrade exits 0' test "$rc" -eq 0
expect 'panel answers after upgrade' wait_for_login
expect 'installed hash is the v2 release' test "$(installed_hash)" = "$(release_hash v2)"
expect 'helper comes from v2' test "$(marker)" = 'lifecycle-marker v2'
expect 'previous program is kept for rollback' test -d /opt/yrm-panel.previous
v2_sudoers=$(sha /etc/sudoers.d/yrm-panel)

echo '== 3. upgrade whose program cannot start must roll back everything'
run_install v3-broken && rc=0 || rc=$?
expect 'broken upgrade reports failure' test "$rc" -ne 0
expect 'the v2 program is back' test "$(app_version)" = v2
expect 'the v2 helper is back' test "$(marker)" = 'lifecycle-marker v2'
expect 'the v2 sudoers policy is back' test "$(sha /etc/sudoers.d/yrm-panel)" = "$v2_sudoers"
expect 'installed hash still names v2' test "$(installed_hash)" = "$(release_hash v2)"
expect 'panel serves again after rollback' wait_for_login
expect 'sudoers policy still valid' sudoers_valid
expect 'no temporary sudoers file is left' no_sudoers_leftovers

echo '== 3b. a later successful upgrade leaves v2 as the .previous program'
run_install v5 && rc=0 || rc=$?
expect 'upgrade to v5 exits 0' test "$rc" -eq 0
expect 'panel answers on v5' wait_for_login
expect 'v5 is running' test "$(app_version)" = v5
expect 'v2 is the kept previous program' test "$(cat /opt/yrm-panel.previous/lifecycle-version.txt)" = v2
v5_sudoers=$(sha /etc/sudoers.d/yrm-panel)
v5_samba=$(sha /usr/local/libexec/yrm-panel-samba)

echo '== 4. failure BEFORE the program swap must not install the older .previous'
# /opt/yrm-panel.previous (v2) is older than the running v5. The Samba bootstrap
# fails after the helpers were replaced but before /opt/yrm-panel is moved.
run_install v4-samba && rc=0 || rc=$?
expect 'upgrade with failing helper reports failure' test "$rc" -ne 0
expect 'running v5 program was NOT replaced by the older previous' test "$(app_version)" = v5
expect 'the Samba helper was restored' test "$(sha /usr/local/libexec/yrm-panel-samba)" = "$v5_samba"
expect 'the sudoers policy was restored' test "$(sha /etc/sudoers.d/yrm-panel)" = "$v5_sudoers"
expect 'the v5 helper marker is intact' test "$(marker)" = 'lifecycle-marker v5'
expect 'panel still serves' wait_for_login

echo '== 5. uninstall keeps data; purge removes it'
/usr/local/sbin/yrm-panel-uninstall
expect 'program removed' test ! -e /opt/yrm-panel
expect 'previous program removed' test ! -e /opt/yrm-panel.previous
expect 'service unit removed' test ! -e /etc/systemd/system/yrm-panel.service
expect 'no helper is left' bash -c '! compgen -G "/usr/local/libexec/yrm-panel-*" >/dev/null'
expect 'no sudoers policy is left' bash -c '! compgen -G "/etc/sudoers.d/*yrm-panel*" >/dev/null'
expect 'PAM service removed' test ! -e /etc/pam.d/yrm-panel
expect 'panel data preserved without --purge' test -s /var/lib/yrm-panel/installed.sha256
expect 'the Linux account survives' id "$PANEL_USER"
run_install v1 && rc=0 || rc=$?
expect 'reinstall after uninstall works' test "$rc" -eq 0
/usr/local/sbin/yrm-panel-uninstall --purge
expect 'purge removes panel data' test ! -e /var/lib/yrm-panel
expect 'purge removes panel configuration' test ! -e /etc/yrm-panel

if ((failures > 0)); then echo "$failures lifecycle check(s) failed."; exit 1; fi
echo 'All lifecycle checks passed.'
