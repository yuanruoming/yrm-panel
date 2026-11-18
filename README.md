# YRM PANEL v1.0.0 BETA4 — Stable candidate source

ASP.NET Core 10 / Razor Pages Web UI for a personally administered Ubuntu/Debian server. It runs as an **existing Linux user** and uses password-authorized fixed helpers for system administration. The browser UI is desktop-style; the Linux user and kernel supply the actual filesystem permissions.

**Status: Candidate, not released as Stable.** The assembly version is `1.0.0-beta.4` on the rolling Dev channel. The commit should only be tagged `v1.0.0` after passing Windows Build, Ubuntu VM checks, and stable release validation. Detailed steps and limitations: `V1_ACCEPTANCE.md`.

## Core capabilities

- Linux PAM login, built-in HTTPS with an installer-generated self-signed certificate, manual PEM certificate import/restore
- Files: My Folders library plus voluntary access to full Root, native Linux permissions, selective sudo grants, browsing, multi-upload, duplicate prompts, previews
- Samba SMB sharing: first-use SMB password, verified native shares, read-only options, unshare without deleting files
- Storage: existing disk/partition discovery and UUID-backed mounts to any safe empty directory, including the Linux Home directory
- Network / DDNS: read-only interfaces; custom HTTPS DDNS update profiles, background checks, separate IPv4/IPv6 public IP
- Security / Firewall: batch editing of YRM-owned UFW rules and supported Docker iptables IPv4 rules; single password prompt on Save & Apply
- Docker: basic containers, status, controls and logs; comprehensive Compose/Stack tooling intentionally not included
- Settings: Certificates, Sharing, Storage, DDNS, Firewall, Appearance, and About/Update
- Monitoring: SSE live metrics, topbar and pinned widget
- Release: separate rolling development and tagged stable workflows; checksum validation and updater rollback

## Apply source and test

Copy the contents of the BETA4 overlay ZIP directly over the current BETA3 local project directory. Do **not** run a generator. Build on Windows:

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj -c Release
```

After a clean Build, Push to master and verify the rolling dev workflow. Restore the Ubuntu VM snapshot before deployment:

```bash
curl -fsSL https://raw.githubusercontent.com/yuanruoming/yrm-panel/master/scripts/install.sh -o install.sh
sudo bash install.sh --repo yuanruoming/yrm-panel --branch master --channel dev --user yuanruoming
```

The *stable* install command uses `--channel stable` and works only after creating and publishing a `v1.0.0` tag. The installer automatically preserves the selected user and TLS identity on updates. It never creates `/data` or `/backup` by default.

See `V1_ACCEPTANCE.md` for what has **not** been confirmed by CI/static tests.
