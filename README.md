# YRM Panel

Lightweight self-hosted Linux server management in ASP.NET Core 10 (Razor Pages).
Dark, wallpaper-first desktop; built-in monitoring; Docker container control; file browser;
folder sharing through native Samba; settings and system power controls.

**Release candidate `1.0.0-rc.3` — requires .NET build and Ubuntu VM acceptance testing.**
Do not assume the software has been independently security audited.

## Features

| Component | Current status |
|---|---|
| Desktop, user wallpaper, launcher, pinned applications | Implemented |
| CPU/RAM/network/uptime/disk metrics | Linux backend implemented |
| Docker discovery, start/stop/restart, logs | Implemented; root-equivalent Docker Socket permissions apply |
| Applications: manual HTTP(S) shortcuts, edit/remove, pin | Implemented |
| Files: browse `/`, choose parent directory, create folder, upload, download, rename, move, remove empty folder | Implemented; actual operations limited to explicitly enabled data directories |
| File sharing: select directory in Files, share with Samba, SMB account password | Implemented; requires system integration testing |
| Settings: Overview, Storage, Network, Accounts, Appearance, About | Implemented; Network and Storage currently informational only |
| Docker Compose creation/deployment, UFW, DDNS, disk format/mount | **Not implemented** |

## Installation (Ubuntu / Debian)

The installer automatically installs missing Docker Engine, Compose plugin, Samba and the
`acl` package. **It does NOT create `/data`, `/backup`, `/data/docker`, or any other user-data folders.**

Once a current `dev` GitHub Release has been built by Actions:

```bash
curl -fsSL https://raw.githubusercontent.com/yuanruoming/yrm-panel/master/scripts/install.sh -o install.sh
less install.sh
sudo bash install.sh --repo yuanruoming/yrm-panel --branch master --channel dev --file-user yuanruoming
```

`--file-user` specifies an **existing Ubuntu account** for Samba/file ownership, not the
YRM Panel website login. On first install you choose a **separate Panel username/password**.
The default listening address is `0.0.0.0:6080` (all IPv4 interfaces), suitable for a trusted
LAN/VPN, **not safe to expose unencrypted to the public Internet**. Use `--bind 127.0.0.1`
for localhost-only installation or `--port N` to change the port.

The installer creates a systemd service and installs a root-owned, allowlisted Samba helper,
a storage/ACL helper, and a power helper. Review each helper and its sudoers rules before
using this on a real server. Docker Socket access is root-equivalent.

### File manager workflow

1. Open **Files** and browse the actual Linux `/` tree. Outside user-authorized data directories, only folder names are shown (read-only).
2. Select **New folder** and browse to the desired parent directory. To create a new top-level `/data`, select `/` and enter `data`.
3. For an existing data folder (for example `/data`), click **Enable management here**, or choose **Enable folder management** from its row. This explicitly grants the Panel account non-recursive access with Linux ACLs. Do not use `chmod 777`.
4. Browse into that directory, create folders or files; click `⋯ → Share via SMB` on a folder. The Samba share name defaults to the folder name. Use advanced settings only when you want a different name.
5. Expand **Shared folders** to set the Samba password for the selected Ubuntu account, view and remove shares. Remove share does **not** remove its files.

A regular file manager is not the same as root access. `/etc`, `/root`, `/usr`, and other
system folders are **not editable**. `/backup` can be created as a future disk mount point,
but file writes are blocked until it is mounted on a separate filesystem. Existing nested
directories may need individual access grants; permission changes are **not recursive**.

The Samba share configuration is stored in the native Samba configuration hierarchy:
`/etc/samba/yrm-panel-shares.conf` (included from `smb.conf`). It persists if the Panel is
uninstalled. Nothing is stored in a private "virtual NAS" filesystem.

### Updates and uninstall

```bash
sudo yrm-panel-update
sudo yrm-panel-uninstall
# Optional: also remove Panel-only account settings and wallpapers
sudo yrm-panel-uninstall --purge
```

Uninstall preserves host files, mounted disks, Docker/Compose containers, Samba and its
native share definitions. It removes the Panel service and its privileged helpers.

## Windows development (Visual Studio 2026)

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj
dotnet run --project .\YrmPanel\YrmPanel.csproj -- --set-admin
dotnet run --project .\YrmPanel\YrmPanel.csproj
```

Windows runs demo metrics. Linux file management and Samba operations require an actual
Ubuntu/Debian host. UI code is Razor Pages + CSS + native JavaScript; no additional NuGet
or JavaScript UI framework is required. Installer uses OS-native Docker, Samba, ACL, Python,
`sudo`, and systemd.

## Repository layout

- `YrmPanel/Pages`: Razor UI and handlers.
- `YrmPanel/Services`: Linux system data, Docker, authorization boundaries, file/Samba operations.
- `YrmPanel/wwwroot`: browser JavaScript, CSS and wallpaper assets.
- `scripts/install.sh`, `scripts/update.sh`, `scripts/uninstall.sh`.
- `scripts/yrm-panel-samba.py`: native Samba share configuration helper.
- `scripts/yrm-panel-storage.py`: explicitly approved data folders and scoped ACL grants.
- `scripts/yrm-panel-power.sh`: allowlisted reboot/shutdown.
- `.github/workflows/dev-release.yml`: automated Linux self-contained binaries.

## Acceptance checklist

- [ ] Visual Studio/.NET 10 builds with 0 errors.
- [ ] GitHub Actions produces x64 and ARM64 release assets containing all three helpers.
- [ ] Clean Ubuntu VM does **not** get default NAS folders created by installer.
- [ ] Browser can list `/`, create `/data` and opt into an existing data directory.
- [ ] GUI file operations work in an enabled root; system folders remain read-only.
- [ ] GUI-created Samba share is readable/writable over SMB from Windows, and persists after Panel uninstall.
- [ ] Manual apps and `docker run` containers appear in Applications; desktop Pin works.
- [ ] Docker operations and inline logs, wallpaper and Settings navigation work.
- [ ] Reboot, update, uninstall preserve Docker, Samba and existing files.
- [ ] Negative tests for path traversal, symlink, unexpected mount and missing permissions.

## Planned

- v2: UFW GUI, native Cloudflare DDNS, more network/system configuration.
- v3: complete Compose Stack import, creation, deployment, upgrades and editing.

MIT licensed. Contributions via Pull Request are welcome; the open-source status does
not imply an untrusted-plugin execution system.
