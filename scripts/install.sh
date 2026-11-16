#!/usr/bin/env bash
# YRM Panel: unattended installation of missing Docker + Compose Plugin and Samba.
# Existing Docker/Samba data is NEVER deleted or replaced by this installer.
set -Eeuo pipefail
umask 027
REPO=""; CHANNEL="dev"; BRANCH="master"; PORT="6080"; BIND="127.0.0.1"; FILE_USER=""; NONINTERACTIVE=0
while (($#)); do
  case "$1" in
    --repo) REPO="${2:?}"; shift 2;;
    --channel) CHANNEL="${2:?}"; shift 2;;
    --branch) BRANCH="${2:?}"; shift 2;;
    --port) PORT="${2:?}"; shift 2;;
    --bind) BIND="${2:?}"; shift 2;;
    --file-user) FILE_USER="${2:?}"; shift 2;;
    --noninteractive) NONINTERACTIVE=1; shift;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Use --repo OWNER/yrm-panel' >&2; exit 2; }
[[ "$CHANNEL" == dev || "$CHANNEL" == stable ]] || exit 2
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || exit 2
[[ "$PORT" =~ ^[0-9]+$ ]] && ((10#$PORT >= 1024 && 10#$PORT <= 65535)) || { echo 'Invalid port.' >&2; exit 2; }
[[ "$BIND" == 127.0.0.1 || "$BIND" == 0.0.0.0 ]] || { echo 'Bind must be 127.0.0.1 or 0.0.0.0' >&2; exit 2; }
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] || { echo 'Supported OS: Ubuntu/Debian with systemd.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'systemd is required.' >&2; exit 1; }
for cmd in apt-get dpkg systemctl id sha256sum; do command -v "$cmd" >/dev/null || exit 1; done
arch=$(dpkg --print-architecture)
case "$arch" in amd64) platform=linux-x64;; arm64) platform=linux-arm64;; *) echo "Unsupported architecture: $arch" >&2; exit 1;; esac

if [[ -z "$FILE_USER" ]]; then
  FILE_USER="${SUDO_USER:-}"
  if [[ -z "$FILE_USER" || "$FILE_USER" == root ]]; then
    FILE_USER=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $1 != "nobody" {print $1; exit}')
  fi
fi
[[ "$FILE_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] && id "$FILE_USER" >/dev/null 2>&1 || { echo 'Supply --file-user EXISTING_LINUX_USERNAME' >&2; exit 2; }
(( $(id -u "$FILE_USER") >= 1000 )) || { echo 'File user must be a regular Ubuntu user.' >&2; exit 2; }
echo "File / Samba user: $FILE_USER"

# Install missing prerequisites once; keep existing Docker package choices untouched.
apt_update_done=0
apt_once() { if ((apt_update_done == 0)); then apt-get update; apt_update_done=1; fi; }
apt_install() { apt_once; DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"; }
for item in curl ca-certificates python3 sudo tar; do
  if ! command -v "$item" >/dev/null 2>&1; then apt_install "$item"; fi
done
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker Engine missing: adding official Docker APT repository.'
  apt_install ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  codename="${VERSION_CODENAME:?}"
  printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$ID" "$codename" "$arch" >/etc/apt/sources.list.d/docker.sources
  apt_update_done=0
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker detected: $(docker --version). Keeping the installed Engine."
  if ! docker compose version >/dev/null 2>&1; then
    echo 'Compose Plugin not found. Attempting installation without replacing Docker Engine.'
    apt_once
    if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
      apt_install docker-compose-plugin
    elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
      apt_install docker-compose-v2
    else
      echo 'WARNING: Docker Compose plugin missing, and no compatible package found. Install it manually.' >&2
    fi
  fi
fi
systemctl enable --now docker
if ! command -v smbd >/dev/null 2>&1; then
  echo 'Samba missing: installing from the OS repository.'
  apt_install samba
else
  echo 'Samba detected; existing shares and configuration will be kept.'
fi
systemctl enable --now smbd

# Non-destructive data directory initialization. Never recursively change an existing tree.
new_data=0
if [[ ! -d /data ]]; then install -d /data; new_data=1; fi
for dir in /data/docker /data/downloads /data/transfer; do
  if [[ ! -e "$dir" ]]; then
    install -d -o "$FILE_USER" -g "$(id -gn "$FILE_USER")" -m 2770 "$dir"
  fi
done
if ((new_data)); then
  chown "$FILE_USER:$(id -gn "$FILE_USER")" /data
  chmod 2770 /data
fi
[[ -d /backup ]] || install -d /backup
if ! id yrm-panel >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/yrm-panel --shell /usr/sbin/nologin --user-group yrm-panel
fi
# Allow access to newly created /data folders using the file user's private group.
# Existing folder permissions are never recursively changed.
private_group=$(id -gn "$FILE_USER")
if [[ "$private_group" == "$FILE_USER" ]]; then
  usermod -aG "$private_group" yrm-panel
else
  echo 'WARNING: File user has a shared primary group; no automatic file ACL was granted.'
  echo 'Give the yrm-panel account scoped access to your chosen folders before using Files.'
fi
install -d -o yrm-panel -g yrm-panel -m 0700 /var/lib/yrm-panel
install -d -o yrm-panel -g yrm-panel -m 0700 /var/lib/yrm-panel/keys
install -d -o root -g yrm-panel -m 0750 /etc/yrm-panel
if [[ ! -f /etc/yrm-panel/panel.env ]]; then
  cat >/etc/yrm-panel/panel.env <<ENV
YRM_PANEL_DATA_DIR=/var/lib/yrm-panel
Panel__Url=http://${BIND}:${PORT}
Docker__Enabled=true
Docker__EnableControls=true
ENV
  chown root:yrm-panel /etc/yrm-panel/panel.env
  chmod 0640 /etc/yrm-panel/panel.env
fi
if [[ ! -f /etc/yrm-panel/source.env ]]; then
  printf 'REPO=%s\nCHANNEL=%s\nBRANCH=%s\n' "$REPO" "$CHANNEL" "$BRANCH" >/etc/yrm-panel/source.env
  chmod 0600 /etc/yrm-panel/source.env
fi
if [[ ! -f /etc/yrm-panel/samba-user ]]; then
  printf '%s\n' "$FILE_USER" >/etc/yrm-panel/samba-user
  chmod 0600 /etc/yrm-panel/samba-user
fi
if getent group docker >/dev/null; then
  echo 'NOTICE: Docker socket access grants the Panel user root-equivalent host control.'
  echo 'The Panel binds only to localhost by default. Do not expose unsecured HTTP publicly.'
  usermod -aG docker yrm-panel
fi

new_admin=0
[[ -e /var/lib/yrm-panel/admin.json ]] || new_admin=1
if ((new_admin)) && [[ ! -r /dev/tty ]]; then echo 'First installation needs a terminal to set credentials.' >&2; exit 1; fi
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
release="$CHANNEL"
asset="yrm-panel-${platform}.tar.gz"
base="https://github.com/${REPO}/releases/download/${release}"
echo "Downloading YRM Panel (${CHANNEL}, ${platform})..."
curl -fLSs --retry 3 "$base/$asset" -o "$workdir/$asset"
curl -fLSs --retry 3 "$base/$asset.sha256" -o "$workdir/$asset.sha256"
(cd "$workdir" && sha256sum -c "$asset.sha256")
install -d "$workdir/publish"
tar -xzf "$workdir/$asset" -C "$workdir/publish"
[[ -f "$workdir/publish/YrmPanel" ]] && [[ -f "$workdir/publish/deployment/yrm-panel-samba.py" ]] || { echo 'Invalid release package.' >&2; exit 1; }
[[ ! -L /opt/yrm-panel ]] || { echo '/opt/yrm-panel must not be a symlink.' >&2; exit 1; }

# Configure the root-owned narrowly scoped Samba integration; preserve its share file upon uninstall.
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-samba.py" /usr/local/libexec/yrm-panel-samba
cat >/etc/sudoers.d/yrm-panel-samba <<'SUDO'
yrm-panel ALL=(root) NOPASSWD: /usr/local/libexec/yrm-panel-samba *
SUDO
chmod 0440 /etc/sudoers.d/yrm-panel-samba
visudo -cf /etc/sudoers.d/yrm-panel-samba >/dev/null
/usr/local/libexec/yrm-panel-samba bootstrap

systemctl stop yrm-panel.service 2>/dev/null || true
if [[ -d /opt/yrm-panel ]]; then
  rm -rf /opt/yrm-panel.previous
  mv /opt/yrm-panel /opt/yrm-panel.previous
fi
install -d -m 0755 /opt/yrm-panel
cp -a "$workdir/publish/." /opt/yrm-panel/
chown -R root:root /opt/yrm-panel
chmod -R go-w /opt/yrm-panel
chmod +x /opt/yrm-panel/YrmPanel

if ((new_admin)); then
  runuser -u yrm-panel -- env YRM_PANEL_DATA_DIR=/var/lib/yrm-panel \
    /opt/yrm-panel/YrmPanel --set-admin </dev/tty || { echo 'Admin setup failed.' >&2; exit 1; }
fi
install -o root -g root -m 0644 "$workdir/publish/deployment/yrm-panel.service" /etc/systemd/system/yrm-panel.service
install -o root -g root -m 0750 "$workdir/publish/deployment/update.sh" /usr/local/sbin/yrm-panel-update
install -o root -g root -m 0750 "$workdir/publish/deployment/uninstall.sh" /usr/local/sbin/yrm-panel-uninstall
systemctl daemon-reload
systemctl enable yrm-panel >/dev/null
if ! systemctl restart yrm-panel.service || ! (sleep 2; systemctl is-active --quiet yrm-panel); then
  echo 'Panel failed to start. Run journalctl -u yrm-panel -n 80.' >&2
  if [[ -d /opt/yrm-panel.previous ]]; then
    systemctl stop yrm-panel.service 2>/dev/null || true
    rm -rf /opt/yrm-panel
    mv /opt/yrm-panel.previous /opt/yrm-panel
    systemctl restart yrm-panel.service || true
  fi
  exit 1
fi
printf '\nYRM Panel installed successfully.\n'
if [[ "$BIND" == 127.0.0.1 ]]; then
  echo "Access via SSH tunnel: ssh -L ${PORT}:127.0.0.1:${PORT} ${FILE_USER}@YOUR_SERVER_IP"
else
  echo "Listening on 0.0.0.0:${PORT}; use HTTPS + a trusted private network."
fi
echo 'Docker, Samba, shared files and Compose projects are independent of YRM Panel.'
