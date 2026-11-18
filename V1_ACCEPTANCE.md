# YRM PANEL 1.0.0 — Verification before Stable

This is a **candidate source overlay**, not a validated 1.0.0 Stable release. The project still needs a Windows .NET 10 / Razor Build and an Ubuntu VM integration run. Do not push a `v1.0.0` tag until the checks below pass. The regular `master` push only creates the rolling `dev` release.

## Expected workflow (unchanged)

1. Copy the ZIP contents directly over the existing RC4.1 source tree. No generator, downloader or patch script.
2. `dotnet clean .\YrmPanel\YrmPanel.csproj` and `dotnet build .\YrmPanel\YrmPanel.csproj -c Release` on Windows.
3. Push to `master`; ensure the dev GitHub workflow publishes **both** architectures and all helpers.
4. Restore a clean Ubuntu VM snapshot. Install with the existing `--user` option and `--channel dev`.
5. Test real UI and services in VM. No changes should be made on the production NAS during this acceptance run.
6. Only after all release-blocking tests: create signed-off `v1.0.0` tag on verified commit; stable workflow publishes immutable assets; reinstall with `--channel stable`.

## Must-pass checks

- [ ] HTTPS PAM login/logout, cookie/session expiry, certificate persistence after update
- [ ] Files: My Folders, Root, user permissions, hidden files, add existing folder, ordinary rename/move/delete
- [ ] Files: double-click image/video/PDF/text; unknown format download; embedded MP4 must respond with HTTP range (206)
- [ ] Files: choose several files -> upload automatically; duplicate -> Replace/Skip; 500 MiB+ transfer; interrupted transfer never overwrites original
- [ ] SMB: from Windows create, read, write, delete a test file; read-only denies write; Stop Sharing keeps original files
- [ ] Storage: `lsblk` shows real disk/partition UUID and filesystem; mount a disposable test disk under `/home/<user>/Photos`; reboot tests startup auto-mount; unmount leaves files; reject non-empty targets and root/system partitions
- [ ] Security: UFW read-only status; add/remove *managed* host rule with a single password prompt; Docker iptables-only rule test plus IPv6 exposure audit; existing non-managed rules unchanged
- [ ] DDNS: add valid HTTPS provider profile, IPv4/IPv6 on the relevant network, status, update-on-IP-change, invalid/private API endpoint blocked, token not exposed in HTML
- [ ] Certificates: validate matching/expired PEM, import, verify browser actually negotiates imported TLS certificate, restore default, keep same certificate after update
- [ ] Monitor: SSE sample each second, pinned default, logout, update/refresh, no persistent duplicate toast
- [ ] Update: GUI Check displays inline result only, Update only offered when newer build exists, service restart auto-reloads browser, checksum preserved, rollback on failure
- [ ] Uninstall preserves Docker volumes/data, Samba shares, existing Linux users; confirms any YRM-managed firewall rules remaining after uninstall

## Known limitations that must not be misrepresented

- Docker firewall editing supports **iptables / DOCKER-USER and IPv4** only. It does not secure Docker's IPv6 published ports or nftables backend. If a system has IPv6-published Docker ports, enforce the appropriate IPv6 policy separately; this candidate is not a complete Docker firewall.
- BETA5 permits changing UFW Active/Inactive in the same Save & Apply draft. First activation requires a root-owned 120-second automatic rollback and a passwordless confirmation after reconnecting; this is not yet validated across VPNs or remote WAN access. No existing global policy is intentionally reset.
- Storage mounts existing local filesystems and separately supports strictly confirmed empty-disk GPT/ext4 initialization and completion of an incomplete GPT-only setup. **These erase partitions** and must be tested only on disposable disks; RAID/LVM/ownership migration is not included.
- DDNS uses single HTTPS requests with Dynu presets or a custom API template, optional Basic/Bearer/custom-header auth, public IP detection, explicit response rules, and DNS verification. It cannot infer multi-step OAuth or arbitrary scripting, and Cloudflare-proxied DNS may not resolve to the detected origin IP. Test with the intended provider.
- Media support uses the browser's native codecs; no transcoding. Larger files are accepted up to 4 GiB per upload, but model binding may use local temporary disk space.
- Let's Encrypt / ACME automation is not included. Default self-signed and manual PEM certificate import are available.

## Install (DEV validation)

```bash
curl -fsSL https://raw.githubusercontent.com/yuanruoming/yrm-panel/master/scripts/install.sh -o install.sh
sudo bash install.sh --repo yuanruoming/yrm-panel --branch master --channel dev --user yuanruoming
```

## Install (only after Stable release is tagged and published)

```bash
sudo bash install.sh --repo yuanruoming/yrm-panel --branch master --channel stable --user yuanruoming
```
