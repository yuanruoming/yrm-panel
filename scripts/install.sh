#!/usr/bin/env bash
# YRM Panel RC4: choose an EXISTING Linux user; preserve host services and data.
set -Eeuo pipefail
umask 027
REPO=''; CHANNEL='dev'; BRANCH='master'; PORT='6080'; HTTPS_PORT='6081'; BIND='0.0.0.0'; PANEL_USER=''; NONINTERACTIVE=0
while (($#)); do
  case "$1" in
    --repo) REPO="${2:?}"; shift 2;;
    --channel) CHANNEL="${2:?}"; shift 2;;
    --branch) BRANCH="${2:?}"; shift 2;;
    --port) PORT="${2:?}"; shift 2;;
    --https-port) HTTPS_PORT="${2:?}"; shift 2;;
    --bind) BIND="${2:?}"; shift 2;;
    --user|--file-user) PANEL_USER="${2:?}"; shift 2;;
    --noninteractive) NONINTERACTIVE=1; shift;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
[[ $EUID -eq 0 ]] || { echo 'Please use sudo to install YRM Panel.' >&2; exit 1; }
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Use --repo OWNER/REPO.' >&2; exit 2; }
[[ "$CHANNEL" == 'dev' || "$CHANNEL" == 'stable' ]] || exit 2
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || exit 2
valid_port() { [[ "$1" =~ ^[0-9]{4,5}$ ]] && ((10#$1>=1024 && 10#$1<=65535)); }
valid_port "$PORT" && valid_port "$HTTPS_PORT" && [[ "$PORT" != "$HTTPS_PORT" ]] || {
  echo 'Invalid HTTP/HTTPS ports.' >&2; exit 2;
}
[[ "$BIND" == '0.0.0.0' || "$BIND" == '127.0.0.1' ]] || { echo 'Invalid bind address.' >&2; exit 2; }
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] && [[ -d /run/systemd/system ]] || {
  echo 'Ubuntu/Debian with systemd is required.' >&2; exit 1;
}
arch=$(dpkg --print-architecture)
case "$arch" in amd64) platform=linux-x64;; arm64) platform=linux-arm64;; *) echo "Unsupported architecture: $arch" >&2; exit 1;; esac

# The updater passes --user. For an interactive install, choose the invoking
# Linux user if the option is omitted. Never silently select root.
if [[ -z "$PANEL_USER" ]]; then
  PANEL_USER="${SUDO_USER:-}"
  [[ "$PANEL_USER" != root ]] || PANEL_USER=''
fi
if [[ -z "$PANEL_USER" && "$NONINTERACTIVE" == 1 ]]; then
  echo 'A noninteractive installation requires --user EXISTING_LINUX_USER.' >&2; exit 2
fi
if [[ -z "$PANEL_USER" ]]; then
  PANEL_USER=$(getent passwd | awk -F: '$3>=1000 && $3<60000 && $1!="nobody" {print $1;exit}')
fi
[[ "$PANEL_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] && id "$PANEL_USER" >/dev/null 2>&1 || {
  echo 'Specify an existing Linux account with --user.' >&2; exit 2;
}
(( $(id -u "$PANEL_USER") >= 1000 )) || { echo 'The selected user must be a regular Linux user.' >&2; exit 2; }
PANEL_GROUP=$(id -gn "$PANEL_USER")
[[ "$PANEL_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Unsupported Linux group name.' >&2; exit 2; }
echo "Selected Linux user: $PANEL_USER (group: $PANEL_GROUP)"

apt_updated=0
apt_once() { if ((apt_updated==0)); then apt-get update; apt_updated=1; fi; }
apt_install() { apt_once; DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"; }
for program in curl ca-certificates python3 sudo tar openssl pamtester setfacl; do
  if ! command -v "$program" >/dev/null 2>&1; then
    case "$program" in setfacl) apt_install acl;; *) apt_install "$program";; esac
  fi
done
# Storage initialization requires standard, packaged Linux tools.
# They are never invoked without a separate typed confirmation and sudo authorization.
if ! command -v parted >/dev/null 2>&1; then apt_install parted; fi
if ! command -v mkfs.ext4 >/dev/null 2>&1; then apt_install e2fsprogs; fi
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker missing. Installing official Docker Engine and Compose Plugin.'
  apt_install ca-certificates curl
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
     "$ID" "${VERSION_CODENAME:?}" "$arch" >/etc/apt/sources.list.d/docker.sources
  apt_updated=0
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif ! docker compose version >/dev/null 2>&1; then
  apt_once
  if apt-cache show docker-compose-plugin >/dev/null 2>&1; then apt_install docker-compose-plugin
  elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then apt_install docker-compose-v2
  else echo 'WARNING: Docker Compose plugin not available; Docker Engine was preserved.' >&2; fi
fi
systemctl enable --now docker
if ! command -v smbd >/dev/null 2>&1; then apt_install samba; fi
if ! command -v ufw >/dev/null 2>&1; then apt_install ufw; fi
if ! command -v lsblk >/dev/null 2>&1; then apt_install util-linux; fi
systemctl enable --now smbd

# No /data, /backup, mount points or user-data folders are ever created here.
[[ ! -L /var/lib/yrm-panel && ! -L /opt/yrm-panel && ! -L /etc/yrm-panel ]] || {
  echo 'YRM installation directories must not be symlinks.' >&2; exit 1;
}
install -d -m 0700 /var/lib/yrm-panel
install -d -m 0700 /var/lib/yrm-panel/keys
install -d -m 0700 /var/lib/yrm-panel/tls
chown -R "$PANEL_USER:$PANEL_GROUP" /var/lib/yrm-panel
install -d -o root -g root -m 0755 /etc/yrm-panel
install -d -o root -g root -m 0755 /usr/local/libexec

# Generated once. Reinstall and updater preserve the same TLS identity.
cert=/var/lib/yrm-panel/tls/server.crt
key=/var/lib/yrm-panel/tls/server.key
host=$(hostname -s | tr -cd 'a-zA-Z0-9.-')
[[ -n "$host" ]] || host='yrm-panel'
if [[ ! -s "$cert" || ! -s "$key" ]]; then
  san="DNS:$host,DNS:localhost,IP:127.0.0.1"
  for address in $(hostname -I 2>/dev/null || true); do
    if [[ "$address" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then san+=",IP:$address"; fi
  done
  openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 825 \
    -keyout "$key" -out "$cert" -subj "/CN=$host" -addext "subjectAltName=$san" >/dev/null 2>&1
  chown "$PANEL_USER:$PANEL_GROUP" "$key" "$cert"
  chmod 0600 "$key"
  chmod 0644 "$cert"
fi

cat >/etc/pam.d/yrm-panel <<'PAM'
#%PAM-1.0
auth       include      common-auth
account    include      common-account
PAM
chmod 0644 /etc/pam.d/yrm-panel

cat >/etc/yrm-panel/panel.env <<ENV
YRM_PANEL_DATA_DIR=/var/lib/yrm-panel
YRM_PANEL_USER=$PANEL_USER
YRM_PANEL_CHANNEL=$CHANNEL
Panel__Bind=$BIND
Panel__HttpPort=$PORT
Panel__HttpsPort=$HTTPS_PORT
Panel__Url=https://$host:$HTTPS_PORT
Docker__Enabled=true
Docker__EnableControls=true
ENV
chown root:"$PANEL_GROUP" /etc/yrm-panel/panel.env
chmod 0640 /etc/yrm-panel/panel.env
printf '%s\n' "$PANEL_USER" >/etc/yrm-panel/samba-user
chmod 0600 /etc/yrm-panel/samba-user
cat >/etc/yrm-panel/source.env <<ENV
REPO=$REPO
CHANNEL=$CHANNEL
BRANCH=$BRANCH
PANEL_USER=$PANEL_USER
PORT=$PORT
HTTPS_PORT=$HTTPS_PORT
BIND=$BIND
ENV
chmod 0600 /etc/yrm-panel/source.env

# Docker socket has root-equivalent access; keep it explicit and track membership
# so uninstall never removes a membership that existed before RC4 installation.
if getent group docker >/dev/null 2>&1; then
  if ! id -nG "$PANEL_USER" | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$PANEL_USER"
    printf '%s\n' "$PANEL_USER" >/etc/yrm-panel/docker-group-added
    echo 'NOTICE: Docker group membership is root-equivalent on this host.'
  fi
fi

# The updater may pass a fixed status-file path. Ordinary installs do not write UI progress.
progress_file="${YRM_PANEL_UPDATE_STATUS_FILE:-}"
if [[ "$progress_file" != '/var/lib/yrm-panel/update-status.json' ]]; then progress_file=''; fi
progress() {
  [[ -n "$progress_file" ]] || return 0
  local phase="$1" message="$2" percentage="${3:-null}"
  local temp_status
  temp_status=$(mktemp /var/lib/yrm-panel/.update-progress.XXXXXX)
  printf '{"state":"running","phase":"%s","message":"%s","percent":%s,"at":"%s"}\n' \
      "$phase" "$message" "$percentage" "$(date -u +%FT%TZ)" > "$temp_status"
  chmod 0644 "$temp_status"
  mv -f -- "$temp_status" "$progress_file"
}
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
asset="yrm-panel-$platform.tar.gz"
release_tag="$CHANNEL"
if [[ "$CHANNEL" == stable ]]; then
  release_json=$(curl -fLSs --retry 2 "https://api.github.com/repos/$REPO/releases/latest") || {
    echo 'No published stable release available.' >&2; exit 1;
  }
  release_tag=$(printf '%s' "$release_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
  [[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid stable release tag.' >&2; exit 1; }
fi
base="https://github.com/$REPO/releases/download/$release_tag"
echo "Downloading and verifying YRM Panel $CHANNEL ($platform)..."
progress Checking 'Release identified; preparing download.'
# The only displayed transfer percentage is actual received bytes / HTTP Content-Length.
# If the server provides no reliable length, the download stays indeterminate.
expected=0
if [[ -n "$progress_file" ]]; then
  expected=$(curl -fLIs --connect-timeout 10 --max-time 20 "$base/$asset" 2>/dev/null \
    | tr -d '\r' | awk 'tolower($1)=="content-length:" && $2 ~ /^[0-9]+$/ {size=$2} END {print size+0}') || expected=0
  [[ "$expected" =~ ^[0-9]+$ ]] || expected=0
  if ((expected == 0)); then
    # GitHub's release API includes the exact asset byte size when CDN HEAD
    # responses are chunked or omit Content-Length.
    release_metadata=$(curl -fLSs --connect-timeout 10 --max-time 15 \
      "https://api.github.com/repos/$REPO/releases/tags/$release_tag" 2>/dev/null || true)
    if [[ -n "$release_metadata" ]]; then
      expected=$(printf '%s' "$release_metadata" | python3 -c \
        'import json,sys; d=json.load(sys.stdin); n=sys.argv[1]; print(next((a.get("size",0) for a in d.get("assets",[]) if a.get("name")==n),0))' \
        "$asset" 2>/dev/null || printf 0)
    fi
    [[ "$expected" =~ ^[0-9]+$ ]] || expected=0
  fi
fi
progress Downloading 'Downloading the selected release.'
if [[ -n "$progress_file" ]]; then
  curl -fLSs --retry 3 --connect-timeout 15 "$base/$asset" -o "$workdir/$asset" &
  download_pid=$!
  while kill -0 "$download_pid" 2>/dev/null; do
    if ((expected>0)); then
      received=$(stat -c %s "$workdir/$asset" 2>/dev/null || printf 0)
      pct=$((received*100/expected))
      if ((pct>99)); then pct=99; fi
      progress Downloading 'Downloading the selected release.' "$pct"
    fi
    sleep 1
  done
  wait "$download_pid"
else
  curl -fLSs --retry 3 "$base/$asset" -o "$workdir/$asset"
fi
progress Verifying 'Verifying release SHA256 and extracting files.'
curl -fLSs --retry 3 "$base/$asset.sha256" -o "$workdir/$asset.sha256"
(cd "$workdir" && sha256sum -c "$asset.sha256")
mkdir -p "$workdir/publish"
tar -xzf "$workdir/$asset" -C "$workdir/publish"
progress Installing 'Deploying and configuring the verified release.' 
for path in YrmPanel deployment/yrm-panel.service deployment/yrm-panel-samba.py \
 deployment/yrm-panel-storage.py deployment/yrm-panel-power.sh deployment/yrm-panel-update-trigger.sh \
 deployment/update.sh deployment/uninstall.sh \
 deployment/yrm-panel-mount.py deployment/yrm-panel-firewall.py \
 deployment/yrm-panel-firewall-restore.service; do
  [[ -f "$workdir/publish/$path" ]] || { echo "Missing release asset: $path" >&2; exit 1; }
done

install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-samba.py" /usr/local/libexec/yrm-panel-samba
install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-storage.py" /usr/local/libexec/yrm-panel-storage
install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-power.sh" /usr/local/libexec/yrm-panel-power
install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-update-trigger.sh" /usr/local/libexec/yrm-panel-update-trigger
install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-mount.py" /usr/local/libexec/yrm-panel-mount
install -o root -g root -m 0755 "$workdir/publish/deployment/yrm-panel-firewall.py" /usr/local/libexec/yrm-panel-firewall

# Mutations require the selected account's Linux password. Only an exact Samba
# status action is available without a password; all inputs are validated by helper.
cat >/etc/sudoers.d/yrm-panel <<SUDO
$PANEL_USER ALL=(root) PASSWD: /usr/local/libexec/yrm-panel-storage *, /usr/local/libexec/yrm-panel-samba *, /usr/local/libexec/yrm-panel-power *, /usr/local/libexec/yrm-panel-update-trigger start, /usr/local/libexec/yrm-panel-mount *, /usr/local/libexec/yrm-panel-firewall apply
$PANEL_USER ALL=(root) NOPASSWD: /usr/local/libexec/yrm-panel-samba list, /usr/local/libexec/yrm-panel-firewall list, /usr/local/libexec/yrm-panel-firewall confirm *
SUDO
chmod 0440 /etc/sudoers.d/yrm-panel
visudo -cf /etc/sudoers.d/yrm-panel >/dev/null
rm -f /etc/sudoers.d/yrm-panel-samba /etc/sudoers.d/yrm-panel-storage /etc/sudoers.d/yrm-panel-power
/usr/local/libexec/yrm-panel-samba bootstrap

# Replace binaries transactionally; keep a backup for failure rollback.
if [[ -d /opt/yrm-panel ]]; then
  systemctl stop yrm-panel.service 2>/dev/null || true
  rm -rf /opt/yrm-panel.previous
  mv /opt/yrm-panel /opt/yrm-panel.previous
fi
install -d -o root -g root -m 0755 /opt/yrm-panel
cp -a "$workdir/publish/." /opt/yrm-panel/
chown -R root:root /opt/yrm-panel
chmod -R go-w /opt/yrm-panel
chmod +x /opt/yrm-panel/YrmPanel
if [[ -f /etc/systemd/system/yrm-panel.service ]]; then
  cp /etc/systemd/system/yrm-panel.service "$workdir/previous.service"
fi
sed -e "s/@PANEL_USER@/$PANEL_USER/g" -e "s/@PANEL_GROUP@/$PANEL_GROUP/g" \
  "$workdir/publish/deployment/yrm-panel.service" >/etc/systemd/system/yrm-panel.service
chmod 0644 /etc/systemd/system/yrm-panel.service
install -o root -g root -m 0644 "$workdir/publish/deployment/yrm-panel-firewall-restore.service" \
  /etc/systemd/system/yrm-panel-firewall-restore.service
install -o root -g root -m 0750 "$workdir/publish/deployment/update.sh" /usr/local/sbin/yrm-panel-update
install -o root -g root -m 0750 "$workdir/publish/deployment/uninstall.sh" /usr/local/sbin/yrm-panel-uninstall
progress Restarting 'Restarting YRM PANEL service and checking health.'
systemctl daemon-reload
systemctl enable yrm-panel.service >/dev/null
systemctl enable yrm-panel-firewall-restore.service >/dev/null
if ! systemctl restart yrm-panel.service || ! (sleep 2; systemctl is-active --quiet yrm-panel.service); then
  echo 'YRM Panel failed to start: journalctl -u yrm-panel -n 80' >&2
  systemctl stop yrm-panel.service 2>/dev/null || true
  if [[ -d /opt/yrm-panel.previous ]]; then
    rm -rf /opt/yrm-panel
    mv /opt/yrm-panel.previous /opt/yrm-panel
    if [[ -f "$workdir/previous.service" ]]; then
      cp "$workdir/previous.service" /etc/systemd/system/yrm-panel.service
    fi
    systemctl daemon-reload
    systemctl restart yrm-panel.service || true
  fi
  exit 1
fi
awk '{print $1}' "$workdir/$asset.sha256" > /var/lib/yrm-panel/installed.sha256
chown "$PANEL_USER:$PANEL_GROUP" /var/lib/yrm-panel/installed.sha256
chmod 0644 /var/lib/yrm-panel/installed.sha256
printf '\nYRM Panel installed for Linux user: %s\n' "$PANEL_USER"
if [[ "$BIND" == 127.0.0.1 ]]; then
  echo "HTTPS: https://127.0.0.1:$HTTPS_PORT (localhost only)"
else
  echo "HTTPS: https://SERVER_LAN_IP:$HTTPS_PORT"
  echo "HTTP:  http://SERVER_LAN_IP:$PORT (login opens HTTPS)"
fi
echo 'First HTTPS access: a self-signed certificate warning is expected.'
# Match RC3 LAN behavior without opening the management interface publicly.
if [[ "$BIND" == '0.0.0.0' ]] && command -v ufw >/dev/null 2>&1 \
    && ufw status | grep -q 'Status: active'; then
  if command -v ip >/dev/null 2>&1; then
    while IFS= read -r subnet; do
      [[ -n "$subnet" ]] || continue
      ufw allow from "$subnet" to any port "$PORT" proto tcp comment 'YRM Panel HTTP LAN' >/dev/null
      ufw allow from "$subnet" to any port "$HTTPS_PORT" proto tcp comment 'YRM Panel HTTPS LAN' >/dev/null
    done < <(python3 - <<'PYNET'
import ipaddress, json, subprocess
try:
    interfaces = json.loads(subprocess.check_output(['ip', '-j', '-4', 'address', 'show', 'scope', 'global'], timeout=5))
    networks = set()
    for interface in interfaces:
        name = interface.get('ifname', '')
        if name.startswith(('docker', 'veth', 'br-', 'virbr')):
            continue
        for address in interface.get('addr_info', []):
            value = ipaddress.ip_interface(f"{address['local']}/{address['prefixlen']}")
            if value.ip.is_private and not value.ip.is_loopback and not value.ip.is_link_local:
                networks.add(str(value.network))
    print('\n'.join(sorted(networks)))
except (OSError, KeyError, ValueError, subprocess.SubprocessError):
    pass
PYNET
    )
  fi
fi
echo 'No user-data directories, Docker volumes or Samba shares were deleted.'
