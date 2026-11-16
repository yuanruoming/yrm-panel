# Changelog

## v1.0.0-rc.2 — integration and usability fixes

- Installer now defaults to network-accessible IPv4 HTTP (LAN/VPN); opt into localhost binding with `--bind 127.0.0.1`. For active UFW, add rules limited to detected private interface subnets.
- Deduplicate system/data disk metrics using actual Linux mount IDs; only show an independent backup volume when it is mounted and differs from the system filesystem.
- Display uptime in seconds/minutes/hours as appropriate; remove redundant monitor status caption.
- Make pinned desktop icons clickable, use consistent vector icons, and synchronize pin updates without a full desktop refresh.
- Dock a compact neutral toolbar to the top edge; eliminate the redundant corner caption and remove excess placeholder copy.
- Docker logs now open inside a modal; operation notices appear in transient toasts instead of persistent page cards.
- Replace the Samba path text field with a restricted folder picker, folder creation and root volume selection.
- Add restart/shutdown entries and a dedicated allowlisted system power helper. Uninstall removes the helper but retains Docker, Samba and user data.
- Retain the existing 1.0 design and no additional third-party NuGet/JS runtime dependencies.

# Changelog

## 1.0.0-rc.1 (release candidate)

- Keep v0.3's top taskbar, wall-paper-first desktop and persistent application window.
- Add File Manager rooted in `/data` and `/backup`: browse, create folders, upload (256 MiB), download, rename, move (within volume), and non-recursive delete.
- Block unmounted backup volumes and symbolic-link paths to reduce unintended file access.
- Add File Sharing manager: create, update and remove Samba shares without replacing existing shares, plus configure the existing Ubuntu user's Samba password.
- Keep Samba-managed share definitions after YRM Panel uninstall.
- Add optional pinned desktop app/shortcut icons in Settings.
- Keep Docker Engine integration, Compose grouping, start/stop/restart (Docker socket rights required), and systemd status.
- Redesign install.sh to detect and automatically install missing Docker Engine, Compose plugin and Samba; preserve existing installations.
- Add an uninstall command that never removes the host Docker Engine, Samba or shared data.
- Add a narrowly scoped root-owned Samba helper instead of running the whole web app as root.
- Preserve user preferences and admin credentials on normal updates.

**Validation:** Source code and scripts require .NET 10 build and Ubuntu integration verification before this can be published as a stable 1.0.0 release.
