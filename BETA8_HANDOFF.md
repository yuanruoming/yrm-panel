# YRM PANEL v1.0.0 BETA8 — Full-source overlay (SMB + Storage)

**Baseline:** GitHub `yuanruoming/yrm-panel` `master` commit `12012b8e167f19ebbfe413a3969cd8595552cbac` (BETA7).

This ZIP contains **complete replacement source files**, not a patch, generator, or standalone project. Extract it into the existing BETA7 repository root and overwrite matching files. Keep all other source files, `.git`, settings, and existing Linux data. Do not extract it as a replacement for the entire repository.

## Fixed in this overlay

1. SMB `save`, `delete`, and `set-password` operations now dispatch to a fixed, root-owned helper running in the host systemd manager. They do not mutate the host from the isolated web process mount namespace. SMB passwords travel over stdin, not on the command line.
2. The YRM-managed Samba include moves to the **last parameter within `[global]`**, before the next share section. Samba treats `include` as a global directive and parses included text in place; moving it to the end of the whole file would be wrong if the last section is not `[global]`.
3. Samba config edits are atomic and locked, checked with `testparm`, checked for the requested loaded share names, and reloaded through native `smbd`. Validation/reload failures restore the previous managed config and try to reload the last known good config. Unshare never deletes the underlying files.
4. Files can share an eligible directory directly without registration in My Folders. When browsing the root of a mounted data volume, Files also exposes a volume-level Share action.
5. Storage exposes direct Share/Unshare for eligible mounted, non-system volumes. Server side rechecks the selected volume through `lsblk` discovery before invoking Samba.
6. Bump package version to `1.0.0-beta.8` and keep older regression version assertions compatible. The rolling dev workflow now runs Python privileged-helper regressions before .NET compilation.

Existing mount/format/partition logic, DDNS, Docker, monitor, and workspace navigation have **not** been rewritten in this pass.

## Normal release workflow

On Windows, extract the ZIP over the **existing** local project and run:

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj -c Release
```

If the build succeeds, commit the overlaid files and push `master`. GitHub Actions updates the rolling **dev** binaries. Only after a disposable Ubuntu VM snapshot is restored, install the dev build through your usual `scripts/install.sh` workflow. Do not publish a Stable tag and do not replace the live NAS with this candidate.

## Disposable Ubuntu VM acceptance (not yet executed by this assistant)

- Mount Disk 2 via the existing Storage workflow; confirm the OS genuinely mounts the expected filesystem. **Do not initialize or format an existing ext4 disk.**
- In **Settings → Storage**, choose the mounted `/data` data partition and share it. On first use set an SMB password for the existing Linux account; Linux administrator password is separately required by the sudo action.
- From Windows, open `\\<VM-LAN-IP>\<share-name>` and log in as the Linux account with that SMB password. Check read/write behavior, filename preservation and authentication; then unshare and confirm files remain untouched.
- In Files, share a writable folder **without adding it to My Folders**; verify Windows access. My Folders must remain a shortcut library, not a sharing prerequisite.
- Restart the test VM and recheck automatic mount persistence and Samba share visibility.
- If a GUI operation fails, treat it as a failed BETA acceptance. Do not manually reformat disks, edit `smb.conf`, or delete directories to force a pass.

## What has and has not been verified

**Verified here:** source transfer against exact GitHub blob SHAs, Python syntax, the BETA8 mocked regression tests (including host-dispatch, false-success prevention, atomic writes and rollback), and archive extraction/hash checks.

**Unavailable here:** .NET 10 SDK build, live Ubuntu host systemd/smbd integration, and SMB authentication/read-write using a real Windows client. Mock tests do not prove those behaviors, so this remains a **BETA8 candidate**, not a fully accepted release.

## Notes

- `scripts/install.sh` already copies `scripts/yrm-panel-samba.py` to `/usr/local/libexec/yrm-panel-samba` and bootstraps Samba. The updated source is included by the existing GitHub Actions packaging pipeline; no new installer/daemon is added.
- No user data, Docker volumes, or other Samba shares are intentionally removed.
