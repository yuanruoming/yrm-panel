# YRM PANEL 1.0.0 — Stabilization update

**Base:** GitHub `yuanruoming/yrm-panel`, `master` tree `bafa9c8e534d21518d253e5e3a509668ad25de1f` (18 Nov 2026). The unchanged files in your existing local project are not included in this overwrite package.

**No version bump:** the project remains `1.0.0` and uses the existing deployment/install flow.

## Changes

- Login: Remember me enabled by default, can be turned off. Persistent encrypted authentication cookie is valid up to 30 days; the nonpersistent session keeps its existing eight-hour configuration. Logout invalidates the current browser cookie.
- Wallpaper: versioned `/wallpaper?v=...` uses private immutable browser caching for that version; HTML preloads the image and sets the wallpaper before the first desktop paint. Existing wallpaper upload and preview behavior is retained.
- Workspace: last in-tab application route and manually expanded System Files state are restored on refresh/login. Only known built-in application routes are restored; no password/form contents are stored in browser state.
- Files: New Folder has a selector for actual **mounted** filesystems, including any mounted directory under Linux Home. The existing tree browser still works. It does not initialize/format disks.
- Storage: physical disks contain actual child partitions. The UI explains why unformatted disks cannot be mounted; the existing controlled mount/unmount backend is unchanged.
- Security: Firewall and Certificates are distinct subpages. Certificates are compact, with imports hidden until selected; restore is offered for imported certificates.
- DDNS: provider form is collapsed behind New Provider.
- About & Updates: distinct installed/release status and release-notes link; existing updater status poll and automatic refresh retained.
- Brand: temporary Concept A as favicon, login icon and UI mark. All graphics can be replaced later.

## Verification performed

- GitHub base filenames and SHA-1 objects cross-checked for the modified files.
- 50 Python unit/static regression checks passed (includes existing Samba, mount and firewall helper tests).
- JavaScript syntax validated with `node --check`; new CSS braces and image assets validated.
- ZIP entries validated after creation.

**Important:** This environment does not have the .NET 10 SDK, and these checks do not replace a real C#/Razor build or Linux GUI smoke test. Install/upgrade, mount and firewall helpers are not modified by this patch.

## Fast acceptance (3 checks)

1. Windows: `dotnet build .\YrmPanel\YrmPanel.csproj -c Release` — ensure no warnings/errors; if successful, push to your repo.
2. Ubuntu VM: log in with Remember me; reload the desktop and confirm wallpaper is immediately available. In Files, check System Files stays collapsed until opened and choose a mounted storage location for New Folder.
3. Settings: check DDNS New, Security > Firewall/Certificates, Storage disk cards and About & Updates. Confirm that existing SMB shares and updater still work.

**Unformatted /dev/sdb:** An unformatted block device cannot be mounted. The panel deliberately does not provide a formatting button in this safe stabilization pass; use separate, explicit disk initialization workflow if needed.
