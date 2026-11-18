# Changelog

## 1.0.0 BETA5 — DDNS, guarded Firewall, disk recovery

- DDNS: editable **Dynu IPv4 / IPv6 preset** and **Custom HTTPS API** forms using the same request engine; automatic public IP detection with fallback endpoints and optional user-provided HTTPS detector. Support HTTP Basic/Bearer/custom-header auth, explicit plain-text `good` / `nochg` / failure codes, JSON property checks or explicitly selected HTTP status checks. Reject provider replies that do not match the configured success condition, bound response bodies, pin public endpoint IPs and keep secrets outside the UI. Track last detected/updated IP, DNS verification status and retry backoff. Separate Detect IP, Update Now, Verify DNS and Pause/Resume.
- Firewall: choose UFW **Active / Inactive** in the browser draft; one Save & Apply sudo prompt. No UFW -> disabled editing. When activating UFW, preserve Panel/SSH and detected WireGuard listening ports, schedule a root-owned 120-second rollback **before** enabling; require a browser confirmation to keep it enabled, with **no second password**. Rules remain limited to UFW and supported Docker IPv4 iptables backends. Extra explanation moves to Advanced details.
- Storage: explicit `lsblk --tree` at all mount/recovery probes fixes lost disk-partition parentage. The existing `FORMAT /dev/sdb1` safety gate and double signature verification remain mandatory. Tiny unformatted system partitions default to a collapsed Advanced/Reserved list.
- Settings: remove repetitive Firewall and Update descriptions. Version changes to `1.0.0-beta.5` without tagging a stable release.

**Not yet hardware-validated.** Use a disposable VM disk for recovery/initialization, test UFW confirmation/rollback over a recoverable VM session, and validate a Dynu domain with user-owned credentials. .NET 10 compilation and actual Web UI interaction still require the user's Windows + Ubuntu workflow.

## 1.0.0 BETA4 — Usability and safety fixes

- New Folder follows the current directory; only the My Folders overview and filesystem Root offer a mounted-disk selector. Disk labels include actual mount locations. Extra-disk default mount paths are `/data`, `/backup`, or `/mnt/<partition>`.
- Handles interrupted GPT initialization with a separately confirmed and re-validated Complete Setup action; verifies ext4 UUID after formatting. The normal mount operation remains non-destructive.
- Firewall inputs accept explicit single ports, comma-separated ports, and ranges; existing legacy numeric rules remain readable. Protected management ports are checked across entire ranges.
- File previews show images only after decoding and use private HTTP cache revalidation (ETag); no original media files are modified. Upload status is transient and no idle "No file selected" label remains.
- Update history no longer shows a stale 100% progress bar after a completed update has been acknowledged.
- Certificate details are folded away by default; improved Files maximize fill and video volume SVG.

**BETA4 is not a Stable tag.** Real Windows .NET Build and Ubuntu VM acceptance remain required.

## 1.0.0 — Stable candidate (validation pending)

- Added real-disk discovery (lsblk) and controlled existing-filesystem mount/unmount to custom paths, including Home; persistent mounts use UUID/fstab.
- Added draft-first host UFW rules and guarded Docker iptables rules (no automatic UFW enable). Rule application invokes sudo once for the full batch.
- Added configurable HTTPS DDNS profiles with background interval updates, separate IPv4/IPv6 public-IP detection, and private-token handling.
- Added Security certificate details, validated PEM import and return to the generated self-signed certificate.
- Added native Files viewer (image/video/audio/PDF/text), automatic multi-upload with explicit Replace or Skip, and a 4 GiB/file limit.
- Fixed wallpaper preview by using an image element and allowing blob: images under CSP; a full-image / desktop-crop toggle is provided.
- Update checks display inline rather than as stacked global toasts, with Dev and Stable channels and service reconnect refresh.
- Merged RC-specific UI styles into a single v1.css bundle. Original UI and Samba code remain in the source tree.
- Stable packaging is based on versioned v* GitHub tags with SHA256 assets. The rolling dev release stays separate.

**No claim of production readiness is made before Windows .NET build and real Ubuntu VM acceptance.** See `V1_ACCEPTANCE.md` for limits and testing.
