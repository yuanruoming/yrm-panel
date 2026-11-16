# YRM Panel

![Desktop preview](docs/screenshots/desktop-preview.png)

**A lightweight, dark-first Linux server management panel.** Built with **C# / ASP.NET Core 10 Razor Pages** and a small amount of native CSS/JavaScript. Runs as a native Ubuntu/Debian `systemd` service, not inside Docker.

> **Status: v1.0.0 release candidate (RC1).** The code and packaging are provided for testing, not represented as an audited stable release. Build in VS2026 and complete the Ubuntu VM acceptance checklist before tagging `v1.0.0`.

## Features

| Feature | v1.0 RC1 |
|---|---|
| Desktop | Wallpaper-focused UI, top taskbar, launcher, optional pinned monitor and pinned app shortcuts |
| Monitoring | Real Linux CPU, memory, disks, traffic rates and uptime; explicitly labeled simulated data on Windows |
| Docker | List containers and Compose project groups; start, stop, restart, view recent logs; shortcut links |
| Linux services | View status of Docker, Samba, SSH and UFW |
| Files | Browse `/data` and mounted `/backup`; create folders, upload/download, rename, move inside a volume, delete files or empty folders |
| File Sharing | Create/update/delete **YRM-managed** Samba shares, set an existing Ubuntu user's Samba password |
| Setup | Install missing official Docker Engine and Compose plugin, plus Ubuntu/Debian Samba; set up autostart |
| Maintenance | `yrm-panel-update` and `yrm-panel-uninstall`; Panel uninstall leaves services and file shares intact |
| Firewall and DDNS | **Not implemented**; planned for v2.0 |
| Compose editing/deployment | **Not implemented**; planned for v3.0; use Dockhand or the Docker CLI in the meantime |

The Panel is a management UI. Actual Docker data, Samba configuration and your files are independent of this app.

## Design and repository structure

```text
YrmPanel/                     # ASP.NET Core Razor Pages source
  Pages/                      # Razor UI pages and handlers
  Services/                   # Linux monitoring, Docker, file access, Samba API
  Models/                     # shared data structures
  wwwroot/                    # desktop UI, CSS, JS, default wallpaper
scripts/
  install.sh                  # initial install and safe upgrades
  update.sh                   # downloads latest installer from chosen repository
  uninstall.sh                # removes Panel, not Docker or Samba
  yrm-panel-samba.py          # root-owned Samba configuration helper
packaging/yrm-panel.service   # systemd unit
.github/workflows/            # build Linux x64/arm64 GitHub release assets
```

**Third-party components:** no extra NuGet dependencies, no JS frameworks and no external CDN. The application uses Microsoft's ASP.NET Core SDK/runtime and the host's native Docker, Samba, Python 3, `sudo` and `systemd`. CI uses GitHub's `checkout`, `setup-dotnet` and `gh` tools. All non-built-in system components are installed explicitly by the install script when absent.

## 1. Local development (Windows / Visual Studio 2026)

1. Merge this repository's files into the root of your existing Git repository, preserving `.git` and the Visual Studio `.sln` file. Do not nest an extra repository directory.
2. Build with `dotnet build YrmPanel/YrmPanel.csproj` (or the VS Build command).
3. On first local launch, create the Panel account:

   ```powershell
   dotnet run --project .\YrmPanel\YrmPanel.csproj -- --set-admin
   ```

4. Start YRM Panel:

   ```powershell
   dotnet run --project .\YrmPanel\YrmPanel.csproj
   ```

5. Open `http://127.0.0.1:6080`. Windows displays **demo monitoring**, and Linux-only Files/Samba/Docker integration reports that it is unavailable. This is expected. Changes to CSS and Razor can be developed locally without Linux.

## 2. GitHub development build

The workflow `.github/workflows/dev-release.yml` runs on pushes to the repository's default branch (`main` or `master`). It publishes pre-release assets to the rolling tag `dev` for both `linux-x64` and `linux-arm64`. Check that the workflow succeeds before installing a new version on Ubuntu.

If the release upload is rejected, in GitHub **Settings → Actions → General** allow Actions to write to the repository, or adjust the repository's workflow permissions.

## 3. Ubuntu installation

**Use a test VM first.** Take a VM snapshot and download the script from your own repository. Replace `YOUR_ACCOUNT` and `main` with your real GitHub owner and default branch.

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ACCOUNT/yrm-panel/main/scripts/install.sh -o install.sh
less install.sh
sudo bash install.sh --repo YOUR_ACCOUNT/yrm-panel --branch main --channel dev --file-user yuanruoming
```

The installer will:

- Check Ubuntu/Debian, architecture and systemd.
- Install **Docker Engine from Docker's official APT repository** if absent, plus the Compose plugin. If Docker already exists, keep its current installation. Try to add the Compose plugin without replacing an existing Engine.
- Install Samba if absent, leave existing Samba shares untouched.
- Ensure `/data`, `/data/docker`, `/data/downloads`, `/data/transfer`, and `/backup` directories exist. **This does not format or mount drives.** `/backup` must independently be mounted at `/backup` through `/etc/fstab` if you wish to use it.
- Create a dedicated service user and install the unprivileged Panel service.
- Install the narrow, root-owned Samba helper. Add a `smb.conf` include for `/etc/samba/yrm-panel-shares.conf`, retaining existing shares.
- Ask you to choose your own Panel username and 12+ character password.
- Enable `yrm-panel.service` to start with the system.

Default listen endpoint: `http://127.0.0.1:6080` (private to the server). From Windows, create an SSH tunnel:

```powershell
ssh -L 6080:127.0.0.1:6080 yuanruoming@YOUR_UBUNTU_IP
```

Then open `http://127.0.0.1:6080` locally. Use `--port 6090` to change ports during initial installation. `--bind 0.0.0.0` is **explicitly not recommended on untrusted networks**, since the Panel is a privileged administration interface. Provide authenticated HTTPS through a properly configured reverse proxy if needed; public Internet exposure has not been audited.

The chosen `--file-user` must be a preexisting, non-system Ubuntu account. This same Unix account is used for Samba authentication. If that account has its own private primary group, the installer adds the Panel service account to that group for access to the newly-created `/data` subfolders. **Existing folder trees are not recursively chowned or chmodded.** For preexisting folders, you may need to grant the Panel user group access explicitly. The Panel never runs the main ASP.NET Core application as root.

### Docker privileges

To control existing Docker containers, `yrm-panel` joins the system `docker` group. **Docker socket access is root-equivalent** and is a deliberate security tradeoff, even if the web application is otherwise unprivileged. Only use this on a trusted, private machine, with the default loopback binding and a strong Panel password. If you do not want Docker control, remove `yrm-panel` from the Docker group and set `Docker__EnableControls=false` in `/etc/yrm-panel/panel.env`.

### Samba configuration

The native Samba helper stores managed shares in `/etc/samba/yrm-panel-shares.conf`, which is directly included by Ubuntu Samba. You can create shares from the **File Sharing** page. It only supports directories under `/data` and **an actually mounted** `/backup`. The helper never changes other existing shares.

The installer places a root-owned `sudoers` entry permitting only `/usr/local/libexec/yrm-panel-samba` as root, with the helper itself validating every action, share name and folder. The `systemd` unit explicitly permits this very narrow `sudo` operation, so `NoNewPrivileges=false` is needed; the main service still runs as the low-privilege `yrm-panel` account. The elevated helper is part of the trusted computing base and must be reviewed before deployment.

Use the File Sharing page to set a **Samba password for your existing Ubuntu user**. Windows uses that password; it is independent of the Panel login password. The password is sent to `smbpasswd` over a local process pipe, not as a command-line argument.

### File manager safety

- Files are accessed directly on the host, never copied into a YRM Panel database.
- `/data` and `/backup` are the only configured storage roots. The Panel checks `../` traversal and rejects symbolic links in user-controlled paths.
- `/backup` must be a real mount point. If the disk is missing, the Files page refuses reads and writes to that path.
- Uploads are currently capped at **256 MiB per file**. Use Nextcloud or SMB for multi-GB transfers.
- Deletes are explicit and **non-recursive**; a folder must be empty before it can be deleted. Existing files cannot be silently overwritten by an upload or rename.
- This is a private single-administrator server UI, not a hostile multi-tenant file server. A local attacker able to swap symlinks during operations would need stronger kernel-level path resolution protections (e.g. `openat2`). Do not make this interface publicly accessible.

## 4. Update and uninstall

Update after the GitHub Actions release has completed:

```bash
sudo yrm-panel-update
```

The update retains the admin password, wallpaper, app preferences, `/data`, `/backup`, Docker and Samba configuration.

Remove **only** the YRM Panel software:

```bash
sudo yrm-panel-uninstall
```

To also remove YRM Panel's own account data, settings and wallpapers:

```bash
sudo yrm-panel-uninstall --purge
```

**Both uninstall modes preserve:** Docker Engine, Docker containers and volumes, Docker Compose projects, Samba daemon, `/etc/samba/smb.conf`, `/etc/samba/yrm-panel-shares.conf`, SMB user database, `/data`, `/backup` and all host files. The Samba include remains valid, so shares continue to work without the Panel. The dedicated `yrm-panel` system user is left in place to avoid unexpected UID reassignment; it can be reviewed manually later.

## 5. Acceptance testing before stable 1.0.0

- [ ] `dotnet build YrmPanel/YrmPanel.csproj` succeeds on Windows and on GitHub Actions.
- [ ] Dashboard, login, wallpaper, Pin-to-Desktop and internal app navigation work.
- [ ] Install on a clean Ubuntu VM: Docker, Compose, Samba and Panel start automatically on reboot.
- [ ] Existing Docker containers appear; start/stop/restart and recent logs work.
- [ ] Files: create, upload, download, rename, move and delete under `/data` with real permissions.
- [ ] Files: `/backup` is inaccessible if the disk is not mounted, but accessible after proper mount.
- [ ] Samba: set SMB password, create a share, read/write from Windows, rename/remove the share without deleting files.
- [ ] Installer rerun does not destroy or replace existing Docker/Samba configurations.
- [ ] `yrm-panel-update` preserves credentials, wallpaper, data and shares.
- [ ] `yrm-panel-uninstall` removes the Panel but Docker and Samba keep functioning.

## Security disclaimer

There are no known deliberate backdoors or telemetry endpoints, and the code uses standard web authentication, CSRF protection, cookie security settings, input validation, and explicit privilege boundaries. **This is not a security audit and not a promise of zero vulnerabilities.** Review any root-executed installer or helper before using it on a real server. Keep YRM Panel private behind SSH/VPN or an appropriately configured HTTPS reverse proxy.

## Roadmap

- **v2.0:** UFW firewall GUI and first-party Cloudflare DDNS updater.
- **v3.0:** Docker Compose editor, installation and Stack management (Dockhand replacement). The v1 Docker integration intentionally does not deploy or delete Compose projects.
- Dynamic third-party plugin loading is **not** part of the current roadmap. Built-in modules are structured for normal source-code contributions.

## Contributing / License

Pull Requests and Issues are welcome. Public source code does not grant write access to this repository. Licensed under [MIT](LICENSE). Please include a test plan when proposing changes to privileged system interactions.
