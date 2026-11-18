# YRM PANEL v1.0.0 BETA6 — Direct replacement handoff

**Source baseline:** GitHub `yuanruoming/yrm-panel`, `master` tree `64f33b3f4bc418ca454dfd914233147b5f1ca1fe` (BETA5). All packaged code files replace the entire file at its relative path; no generator or patch command is needed.

## Changes

- Version `1.0.0-beta.6`; existing Linux user, install/update scripts, SMB, File Manager and Docker remain unchanged.
- **Hybrid DDNS:** starts a check after service startup, listens for Linux address/availability changes and read-only `ip monitor address route link` notifications, coalesces bursts (~10 s with 45 s cooldown), and retains per-profile polling every 5–1440 minutes. Periodic checks remain necessary when WAN IPv4 changes behind NAT without any Linux interface event. Network events do not skip provider-imposed retry cooldown.
- **Cloudflare A/AAAA preset:** Bearer API Token; automatically looks up a zone and **one already existing matching record**; PATCHes only the requested record's type/name/content and verifies source record data using Cloudflare API. Doesn't change Proxied, TTL or other record properties. The token needs **Zone → Zone → Read** and **Zone → DNS → Edit**, scoped to the relevant zone. Create the initial A or AAAA record in Cloudflare dashboard; YRM PANEL does **not** create/delete DNS records.
- **Dynu preset:** Username for Basic Auth is now visible and required; passwords are not placed in URL; field validation returns specific errors.
- **Custom HTTPS API:** URL/method/authentication/response handling remain user-editable, existing saved profiles remain readable. No arbitrary shell scripts or local/private HTTP endpoints.
- **Update:** `Update Available` supersedes prior `Completed` when a newer asset exists. A running update shows a single `Updating` state; a just-completed update displays `Reload Panel` until acknowledged.
- **Storage:** corrects `wipefs` output flag (`--output TYPE`) and interprets `blkid` probe result using only actual filesystem `TYPE`, not GPT `PART_ENTRY_*` metadata. All previous identity, signatures, mount, partition count, size and confirmation checks remain. Recovery still **formats** the selected disposable test partition.

## How to apply

1. Extract the ZIP over your existing BETA5 project root, replacing included files only.
2. On Windows: `dotnet build .\YrmPanel\YrmPanel.csproj -c Release`.
3. Push to `master`, ensure GitHub Actions publishes the `dev` release.
4. Restore your disposable Ubuntu VM snapshot if needed, then update from existing GUI; if GUI update has a problem, use the existing `install.sh --channel dev --user yuanruoming` path.
5. Don't label the build Stable or use a production disk until Ubuntu integration is passed.

## Suggested focused acceptance

- Verify Dynu `New Provider` saves with hostname/username/IP Update Password and returns correct `good`/`nochg`; do not paste credentials into chat.
- In Cloudflare dashboard, create a disposable A record, create zone-scoped API Token with Zone Read and DNS Edit. Save a Cloudflare A profile, click Detect IP, Update Now, Verify DNS; confirm `content` matches and Proxied/TTL did not change. Repeat with AAAA only when server has a reachable public IPv6.
- Exercise a local route/IPv6 change in the disposable VM and inspect the DDNS status and logs. Test periodic fallback separately; **do not change the real network solely to force an event**.
- With the user's existing disposable QEMU `/dev/sdb1`, run read-only `lsblk`, `wipefs --no-act`, `blkid -p` first; then optionally use Complete Incomplete Setup with exact FORMAT confirmation. Verify actual ext4 UUID and Mount to `/data`; never use the real NAS disk.
- Check About: Update Available, Updating, Reload Panel, Up to Date states match current release status.

## Validation limits

- 103 local Python regression/mock tests and Node JavaScript DOM smoke test passed.
- `node --check` and Python/Bash syntax checks passed; ZIP is integrity-checked.
- .NET 10 SDK is unavailable in the build container. **No real .NET/Razor compilation, Ubuntu firewall/mount operation, Cloudflare/Dynu live API call or full Chromium E2E was completed.** These remain mandatory before Stable.
