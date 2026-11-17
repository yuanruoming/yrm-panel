# YRM PANEL — RC4 (1.0.0-rc.4)

A lightweight web GUI for managing a personally administered Ubuntu/Debian Linux server. ASP.NET Core 10 / Razor Pages. **Release candidate; Windows Build and real Ubuntu VM acceptance testing still required.**

## What's different from RC3

- **Existing Linux user:** install with `--user LOGIN`, default process is that user's UID/GID; no newly created `yrm-panel` service account. Linux logins verify the selected account through PAM; Windows VS2026 preview keeps the existing local development admin store. Multi-user Linux execution is not implemented.
- **Files:** the current Linux user's actual directory permissions determine whether an operation is allowed; filesystem navigation starts with Home (Root / remains available). Root-level folder creation and controlled grants use narrow root-owned helpers. No automatic `/data` or `/backup` creation.
- **SMB:** shares are native Samba shares, and share creation/deletion requires sudo authorization. The first attempted share offers a *one-time* SMB password field if the account does not already have a Samba password. Removing a share never deletes files.
- **Sudo:** GUI requests the Linux password only for permitted administrative changes, never ordinary file operations. No arbitrary shell-execution API. Docker socket management remains a separate, root-equivalent permission and is clearly flagged during installation.
- **HTTPS:** Kestrel serves HTTP on 6080 and self-signed TLS HTTPS on 6081 by default; protected routes and login redirect to HTTPS. Browsers display a warning for an untrusted self-signed certificate. The certificate is retained during updates.
- **Monitor:** one server-side 1-second sampler broadcasts via authenticated Server-Sent Events (SSE); Monitor and Pinned Monitor share samples. Pinned Monitor remains visible while other application windows are open. No extra SignalR dependency.
- **Settings:** Services is now a Settings tab; About includes release check and one-click elevated update, executed by a separate systemd transient unit independent of the Web process.
- **UI:** fixed desktop window dimensions, clearer Files location sidebar, updated neutral login background distinct from the private desktop wallpaper.

## Installation after Windows Build + GitHub push

The release pipeline in `.github/workflows/dev-release.yml` publishes the rolling `dev` Linux binaries. Once the **RC4 source has been built on Windows and committed/pushed to the repository's active default branch**, restore the Ubuntu VM snapshot and use:

```bash
curl -fsSL https://raw.githubusercontent.com/yuanruoming/yrm-panel/master/scripts/install.sh -o install.sh
less install.sh
sudo bash install.sh --repo yuanruoming/yrm-panel --branch master --channel dev --user yuanruoming
```

`--file-user` is a backwards-compatible alias for `--user`. Ports are customizable with `--port`, `--https-port`, and `--bind`. Set a Linux account password using your normal Ubuntu tools *before* trying the PAM login; the installer does not create or change user passwords.

Open `https://SERVER_LAN_IP:6081` after installation. `http://SERVER_LAN_IP:6080` remains available and redirects protected pages to HTTPS. A browser certificate warning is expected until the generated certificate is trusted.

## Updates, troubleshooting and uninstall

```bash
sudo yrm-panel-update
sudo journalctl -u yrm-panel -n 80 --no-pager
sudo yrm-panel-uninstall
# Optional: remove settings, TLS material and wallpaper as well
sudo yrm-panel-uninstall --purge
```

`Settings → About & Updates → Check for updates / Update` is the graphical alternative. Once submitted, the transient systemd job continues independently while the Web process restarts. `update.sh` retains original `--user`, port, bind address and certificate.

**Do not** forward the management ports to the open Internet, and remember Docker group access grants root-equivalent capabilities. Password fields are transmitted over TLS and are not saved in the application's storage.

## Windows development

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj
dotnet run --project .\YrmPanel\YrmPanel.csproj -- --set-admin
dotnet run --project .\YrmPanel\YrmPanel.csproj
```

Windows uses demo metrics; Linux PAM, Samba, sudo and update functions require an actual Ubuntu/Debian VM for verification. Before publishing a release, test Files write, `/data` creation, SMB Windows read/write, update and rollback, login, and HTTPS explicitly.

## Current limitations

- Only the Linux account selected on installation can log in. A later multi-user version will need per-session UID/GID file-operation dispatch.
- Manual system/root paths are not treated as editable, and `/backup` needs a distinct mounted filesystem for writes.
- This is an RC and has **not** yet received an independent security audit or a verified Ubuntu VM test run.
