# YRM Panel · BETA8 Storage / Files follow-up

**Baseline:** `yuanruoming/yrm-panel`, branch `master`, commit `8d44b50f799b999eadd96fbda51d6fee2a493c9e` (BETA8).

**Delivery:** Complete-source-file overlay ZIP. Extract directly into the existing Git repository root and replace matching files. Not a patch, generator, or new project. Assembly version stays `1.0.0-beta.8` until full VM acceptance.

## Changes

- **Storage versus Files:** Remove the UI and Razor handlers for whole-volume SMB sharing. Storage manages mounts and volumes; folder sharing remains under Files. Existing Samba shares/configurations are not deleted. A volume with active SMB shares cannot be unmounted, and if Samba status cannot be verified the unmount is deferred rather than risk redirecting share paths onto unmounted directories.
- **New volumes:** Disk 2+ now receive a suggested mount location `/volume2`, `/volume3`, etc. The mount location input is still editable. This is **only a suggestion for newly mounted filesystems**. **Existing `/data`, `/backup`, or other mounted paths are never migrated or renamed by this update.** The underlying mount helper continues using filesystem UUIDs.
- **Volume permissions:** When a previously blank ext4 filesystem (containing no user data) is mounted through YRM Panel, its root can be assigned to the Panel Linux user, without recursively changing descendants. A populated volume is never auto-chowned. For an existing mounted data-volume root that lacks write permissions, creating a folder in Files now prompts for the Linux administrator password once, applies a **nonrecursive** ACL grant to that root via the existing storage helper, then creates the folder. Existing permissions inside other directories remain untouched.
- **File browser:** `lost+found` is hidden by default in Files without deleting it. Newly saved Samba shares use the standard Samba `hide files` parameter for this entry (no veto or removal). Pre-existing Samba shares are not silently rewritten. File sizes display B/KB/MB/GB/TB using 1024-based units with exact byte counts on hover.
- **Dialogs:** Remove duplicate `window.confirm()` fallback. The branded confirmation appears once, then Linux password once, and the request is posted once. New Folder keeps stable desktop geometry, renders Parent location as read-only text plus a hidden form field, and uses one folder-tree controller. The fixed-location case also runs the permission check.
- **Stale Files views:** Successful Mount/Unmount/InitializeDisk/CompleteDisk actions invalidate cached Files tabs so they reload current mount state on next entry.

## Existing data and known limitations

- Neither disk formatting nor unmounting is performed during installation. No existing share or file is deleted or moved by this ZIP.
- Existing root-level SMB shares remain configured. Because Storage no longer manages those shares, remove a legacy share through **Settings → File Sharing**, or the existing My Folders menu when applicable, **before attempting Unmount**. A regular Files share should target a folder inside the mounted volume, not the volume root.
- Old **My Folders** bookmarks are absolute paths. A bookmark previously saved as `/data` does **not** automatically become `/backup` if the disk was remounted elsewhere before this update. Remove the stale bookmark and add the desired current folder; automatic safe migration of legacy bookmarks by UUID has not been implemented.
- The proposed default `/volumeN` naming is not a full persistent logical volume registry. Future work may assign stable human-friendly names independently of `/dev/sdX` enumeration.
- Full .NET 10 compilation and physical Windows ↔ Ubuntu SMB tests cannot run in this packaging container; do not treat the static/mock test results as hardware acceptance.

## Regression checks performed

```bash
python3 -m py_compile scripts/yrm-panel-samba.py scripts/yrm-panel-mount.py
python3 -m unittest discover -s tests -p 'test_beta8.py'
python3 -m unittest discover -s tests -p 'test_beta8_followup.py'
python3 -m unittest discover -s tests -p 'test_samba_helper.py'
python3 -m unittest discover -s tests -p 'test_storage_helper.py'
node --check YrmPanel/wwwroot/js/panel.js
node --check YrmPanel/wwwroot/js/rc4-admin.js
node --check YrmPanel/wwwroot/js/v1-stability.js
```

## Windows / Ubuntu verification

1. Back up the current BETA8 source state or commit before overlaying this ZIP.
2. Extract this ZIP over the existing repo root, keeping `.git` and untouched source files. Do not start another project.
3. Build in Visual Studio 2026, or run `dotnet build .\YrmPanel\YrmPanel.csproj -c Release` from PowerShell.
4. Push to `master` only after successful local build. Existing GitHub Actions should run BETA Python tests and build the rolling `dev` release.
5. Restore the Ubuntu test VM snapshot and install the dev build there, **not on the production server**.
6. Regression flow: mount an empty ext4 volume; create `/volume2/backup` in Files; verify one authorization prompt if access needs a grant; share that folder; access/create/read a file from Windows; check `lost+found` is absent in the ordinary view; confirm a shared volume cannot be unmounted; stop sharing and unmount with one confirmation and one password prompt.

**No stable `v1.0.0` tag or production-readiness claim.**
