# Changelog

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
