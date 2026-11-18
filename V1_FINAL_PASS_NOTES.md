# YRM PANEL 1.0.0 — final usability pass (source overlay)

Base: GitHub `yuanruoming/yrm-panel` `master` tree `a52e1ba19c4081bf2a9e9625f8c2b9f584d93803`.
Each changed base file was compared with its Git blob SHA before editing.

This ZIP contains **complete replacement files**, not diffs and not a CMD generator.
Copy its directory contents over the existing local YRM PANEL project.
The previous v1.0.0 Stability overlay must already be present; unchanged files are not included.

## Changes

- **Updates**: display truthful Downloading byte-percentage only when the asset size is known; show indeterminate progress for Checking / Verifying / Installing / Restarting, and 100% after Completed. Persist the updater's state atomically. Show a `Reload Panel` button after the update started in this browser and completed. Do not auto-reload away the result.
- **Maximize**: the app window fills the viewport below the system top bar; regular window dimensions are unchanged.
- **Monitor**: uptime displays seconds for minutes, hours and days. The 1-second transport's display is protected from the old 5-second poll overwriting it.
- **Video previews**: responsive to intrinsic aspect ratio; new playback bar with play/pause, seek, volume, speed, and fullscreen. The browser still performs actual video decoding. Closing the dialog pauses and releases the video stream. Image/PDF/text support is preserved.
- **Branding / Login**: redundant top-left mark removed (favicon, login and About stay). Dark autofill styles; Keep me signed in label. Existing rolling 30-day expiration logic is unchanged.
- **Storage**: when a disk is confirmed blank, an independent **Initialize Empty Disk** action can create GPT + ext4. It NEVER runs from New Folder or Mount. It requires typing `ERASE /dev/<device>` and sudo, and the privileged helper independently rejects filesystem signatures, partitions, mounts, removable and read-only disks. After initialization, choose Mount separately. The helper never touches a disk that fails its checks.

## Important safety and platform limitations

- **Disk initialization irreversibly erases data.** It is intended only for a disposable blank VM disk, not existing disks. Check the actual device name, serial and capacity outside the browser before proceeding. Never initialize `/dev/sda` just to test the feature. The installed disk tools are `parted` and `e2fsprogs`; the helper also needs normal `lsblk`, `wipefs`, and `blkid`.
- The backend has only been verified by static checks and mocks. A simulated blank disk cannot prove real partitioning/mounting works; a disposable VM disk and a backup are mandatory for an end-to-end storage test.
- Download percentage depends on the GitHub asset size being obtainable from HTTP metadata. Verifying, installing and restarting intentionally have no invented percentage. A completed installation reports 100%.
- No .NET 10 SDK is available in this execution environment; **a Windows `dotnet build` / GitHub Action build is still required**. Do not promote the repository to `v1.0.0` Stable until it passes.
- Samba, DDNS, UFW and the existing Docker controls were deliberately not modified.

## Build (Windows)

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj -c Release
```

When successful, push to `master`, allow the Dev release to build, then test GUI Update on the Ubuntu VM. Verify updated status, actual download progress when available, and the Reload Panel button. For disks, test only a new *disposable* blank VM disk, and confirm the helper rejects a disk with data or partitions.

## Automated checks performed

- 62 Python unit/contract tests pass, including the new negative blank-disk tests.
- Bash syntax and JavaScript syntax checks pass.
- Headless Chromium smoke tests at 1200, 820, 390px pass for window maximize and video dialog layout/cleanup; portrait video is explicitly checked.
- These checks do **not** substitute for .NET compilation or end-to-end Ubuntu VM testing.
