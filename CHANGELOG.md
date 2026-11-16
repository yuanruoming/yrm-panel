# Changelog

## 1.0.0-rc.3 — Files and product structure

- Replace fixed `/data` and `/backup` assumptions with read-only `/` browsing and explicit opt-in data roots.
- Remove installer-created `/data/docker`, `/data/downloads`, `/data/transfer`, `/backup`.
- Add root-owned storage helper for safe top-level data-folder creation and non-recursive per-folder ACL grants.
- Native Samba shares now recognize opted-in data roots, instead of hard-coding `/data` and `/backup`.
- Move SMB sharing into the Files row action menu; default share name equals the chosen folder name.
- Consolidate manual web shortcuts and detected Docker containers into Applications, with edit/remove and direct desktop Pin.
- Replace former shortcut settings with structured Overview, Storage, Network, Accounts, Appearance and About screens.
- Default wallpaper upload now applies immediately on selection when JavaScript is available.
- Read actual mounted filesystems, and do not show fictional directories as storage volumes.
- Preserve existing installer arguments, service, Docker API, login and deployment automation.

## 1.0.0-rc.2

- GUI directory picker, Docker toasts and logs dialog, reboot and shutdown helper.
- Installation default changed to all IPv4 interfaces (configure firewall / HTTPS as appropriate).
- Disk deduplication and monitor improvements.

## 1.0.0-rc.1

- Native Files and Samba integration, Docker controls, deployment and uninstall scripts.
