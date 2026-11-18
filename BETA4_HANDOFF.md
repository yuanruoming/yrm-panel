# YRM PANEL v1.0.0 BETA4 — direct-replace handoff

Base: `yuanruoming/yrm-panel` GitHub master BETA3 commit `8371bd47ead1a88ff12787b96d3cbb94985c68d7`.

This is a ZIP of **full replacement files** relative to that commit, not a generator and not a repository clone. Copy the entire ZIP contents to your current local project root before building. Keep all unchanged source files already in your local project.

## Implemented

- **Version:** 1.0.0-beta.4 (dev). No stable tag yet.
- **New Folder:** a directory already opened in Files always creates inside that directory. Only My Folders overview and actual filesystem root allow selecting a mounted disk. Linux Home defaults to system storage; other disks are actual mounted filesystems, not virtual data copies. No automatic mounting/formatting on Create Folder.
- **Storage:** extra-volume mount suggestions `/data` and `/backup` are editable. New incomplete-setup recovery recognizes a single unformatted GPT partition, rechecks signatures and mount state twice, requests `FORMAT /dev/...` and sudo separately, then verifies the new ext4 filesystem UUID. Empty-disk Initialize still uses `ERASE /dev/...`, tries partprobe/udev, and checks the filesystem afterward. Mount remains a separate explicit action.
- **Files:** remove misleading tooltips, stale file selector label, make upload progress transient; resize File Manager with maximized window; preview JPEG/PNG/WebP/GIF only after complete browser decoding; private ETag revalidation avoids retransmitting an unchanged file on repeat opens. Original media is never changed. No server-side thumbnail transcoding has been added.
- **Video:** replace the Unicode pseudo-volume icon with an SVG symbol; player remains based on native browser video decoding.
- **Firewall:** Port accepts `80`, `80,81,82`, `20-442` (at most 20 comma items). Host UFW and supported Docker IPv4 iptables rules translate each component correctly. Source accepts `any`, one IP or one CIDR, *not a list of CIDRs*. UI columns and captions adjusted. UFW activation is not changed.
- **Certificates:** compact initial card with expiration and expandable technical details; Import PEM remains available.
- **Update:** progress bar is shown only for running updates or a newly completed update still awaiting Reload. After Reload the user sees Up to Date and Last Update, not a permanent 100% bar. Stale `running` state (>45 minutes) is rendered failed.

## Validation

`python3 -m unittest discover -s tests -q`: 79 tests passed including BETA4 disk-recovery refusal cases, firewall ranges and source contracts.

Python helper syntax: passed. JavaScript (Node `--check`): passed. ZIP CRC checked.

**Not validated here:** actual .NET 10 Razor Build, Ubuntu `partprobe`/`mkfs.ext4`/udev behavior, real UFW/Docker rules, and interactive real-browser E2E (local browser navigation blocked by execution environment). The uploaded VM screenshots are evidence only of the BETA3 partial GPT operation. Never test recovery on an irreplaceable disk.

## Suggested acceptance order

1. **Windows:** `dotnet build .\YrmPanel\YrmPanel.csproj -c Release` (expected 0 errors; do not publish if there are errors).
2. Push to master, check Dev Release; update the *disposable Ubuntu VM* through the existing GUI.
3. Files: inside `/home/yuanruoming/downloads` New Folder must create there without asking for disk. From My Folders overview, choose a mounted data disk if available.
4. Storage: On a *disposable* `/dev/sdb1` left in BETA3's unformatted GPT state, use **Complete Incomplete Setup** and type `FORMAT /dev/sdb1`, verify ext4 UUID, then mount to `/data`. This formats the selected partition and erases any unrecognized data inside it. Do not run on production disks.
5. Preview an image twice over WireGuard; first render should be complete rather than partial, later requests should use cache revalidation. Check Files maximize.
6. Firewall: Draft an **Allow** rule with `80,81` and verify actual UFW result before testing changes to existing connections; verify the protected management-port Deny rejection. Test Docker separately; IPv6/nftables are not implemented.
7. About & Updates: acknowledge a completed update via Reload; future About visits should show Up to Date with Last Updated rather than an old 100% progress bar.

**Known limits:** Images are decoded before display and privately cached but *not* server-side resized; large first-time images can still take longer over WireGuard. Disk recovery does not silently format or mount anything. Host firewall requires UFW to already be active. Docker rule support remains IPv4 iptables only. Multiple Linux users are future 4.0 work.
