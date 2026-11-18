# Changelog

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
