# Changelog

## 1.0.0-rc.4 — Source candidate

- Switch to selected existing Linux user identity and Linux PAM authentication on Ubuntu/Debian; Windows local development auth preserved.
- Ordinary Files operations use real Linux permissions; restricted sudo helpers for explicit administration only.
- Native Samba one-time password prompt at first share, with system-authenticated share management.
- Auto-generated, update-persistent Kestrel self-signed HTTPS listener on port 6081; legacy HTTP 6080 retained.
- 1-second shared monitoring samples via SSE; pinned monitor stays visible over open apps.
- Services relocated into Settings and graphical Update integrated into About.
- Installer/update/uninstaller aligned to `--user` and persistent Linux configuration; Windows Visual Studio and Ubuntu VM acceptance still pending.

## 1.0.0-rc.3

- Previous source candidate: file manager changes, Samba integration, desktop customization and Settings navigation.
