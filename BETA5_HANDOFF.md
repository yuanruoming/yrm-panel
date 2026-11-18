# YRM PANEL 1.0.0 BETA5 — Direct replacement handoff

**Source baseline:** GitHub `yuanruoming/yrm-panel`, `master` at BETA4 (the relevant BETA4 files were checked against the uploaded direct-replacement package). This archive consists of **complete replacement and new source files**, not a generator or a new project. Overlay the ZIP onto the existing repository root. All unchanged files remain in place.

**Version:** `1.0.0-beta.5`. Do not tag `v1.0.0` Stable yet.

## Changes

### DDNS

- Use **Settings → Dynamic DNS → New Provider**; choose **Dynu IPv4**, **Dynu IPv6**, or **Custom HTTPS API**. These presets use the same `DdnsService` HTTP engine.
- **Dynu IPv4**: `https://api-ipv4.dynu.com/nic/update?hostname={hostname}&myip={ip}&myipv6=no`.
- **Dynu IPv6**: `https://api-ipv6.dynu.com/nic/update?hostname={hostname}&myip=no&myipv6={ip}`.
- Auth for Dynu: choose **HTTP Basic**, enter your Dynu **username** and dedicated **IP Update Password**. No need to paste Base64 or embed credentials in the URL.
- Response codes: `good` = Updated, `nochg` = Unchanged; `badauth`, `nohost`, `notfqdn`, `unknown`, `servererror`, `911` = Failure. A 911 response receives a 30-minute automatic cooldown.
- Detection: automatic detection tries two remote public-HTTPS IP endpoints per family. The optional **Custom detection URL** must serve *only* a public IPv4 or IPv6 address, and connections to private/reserved IPs are refused. This is useful if the Ubuntu server uses a VPN/WireGuard exit that differs from the IP you want published.
- Verification: **Detect IP** never sends a provider update; **Update Now** updates when needed; **Verify DNS** checks A/AAAA against the last accepted IP. A DNS proxy (for example, a proxied Cloudflare record) or an unexpired resolver cache may yield a different IP; report that status rather than falsely declaring the provider update failed.
- Custom API supports **GET/POST/PUT/PATCH**, Basic/Bearer/custom-header/none, URL and JSON-body `{ip}`/`{hostname}` variables, exact plain-text codes, simple JSON property assertions and (only when explicitly selected) HTTP status success. This is *not* a general script engine and cannot automatically infer OAuth or multi-step proprietary APIs.
- Existing BETA4 DDNS profiles remain readable. New secret fields are never returned in profile UI responses.
- A Dynu account controls **Dynu-hosted records**. A domain whose authoritative records remain hosted by Cloudflare cannot be changed by the Dynu IP Update Protocol alone.

### Firewall

- **Security → Firewall** shows real **Active / Inactive / Unavailable** status; if UFW is missing, editing and applying are disabled.
- Active/Inactive and the rules are edited as one draft, requiring one sudo password on **Save & Apply**. Old BETA4 HTML submissions (without a status field) retain the existing UFW status.
- When enabling an inactive UFW, the helper saves access allowances for detected SSH, Panel HTTP/HTTPS and detected WireGuard listen ports, schedules a **systemd-run** rollback *before* enabling, and requires **Keep Firewall Enabled** confirmation within 120 seconds. The confirmation calls a strictly scoped passwordless helper with a random nonce. Without confirmation, the helper disables UFW. A missing `systemd-run` refuses activation.
- This is only protection for recoverable VM testing, not a proof that all remote routes, VPN or Docker IPv6 ports remain reachable. Use VM console / snapshot for the first activation test. Docker nftables/IPv6 support has not been added.
- The Linux root helper and `scripts/install.sh` **must be updated together**; the installer grants a narrow passwordless confirm action while keeping Apply password-protected.

### Storage and display

- Disk/partition `lsblk -J --tree` output is now explicitly hierarchical. The previously generated `/dev/sdb1` from BETA3 should be recognized by the existing recovery path after installation, subject to all disk/signature safety checks.
- **Never** rerun Initialize on `/dev/sdb` while it contains `/dev/sdb1`. Confirm the target is the disposable, unformatted partition and enter exactly `FORMAT /dev/sdb1` when instructed. Formatting overwrites the target partition and requires the existing sudo password. Mount is a separate explicit step.
- Tiny unformatted system/boot-like partitions are tucked into an expandable **System / reserved partitions** area; no formatting is offered for them.

## QA completed here

- `python3 -m unittest discover -s tests -q` — 92 tests passed (mostly mocked helpers, static UI/contract checks).
- `python3 -m py_compile scripts/yrm-panel-mount.py scripts/yrm-panel-firewall.py` — passed.
- `bash -n scripts/install.sh` — passed.
- `node --check YrmPanel/wwwroot/js/v1-settings.js` — passed.
- ZIP test/CRC and SHA256 member checks — included in release package.

## QA not performed here

- No .NET 10 SDK was installed here: **Windows Release Build and Linux publish not yet run.**
- Dynu service calls, remote DNS propagation, UFW with WG/SSH, systemd rollback scheduler and the physical `/dev/sdb1` recovery are **not** claimed as tested on a real Ubuntu host.
- Begin on your **disposable Ubuntu VM snapshot**. Validate correct SSH/WG access, verify one Dynu test domain and one custom response rule, then test UFW activation/timeout and Storage recovery **with console access**. Do not test formatting on production disks.

### Build and deployment

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj -c Release
```

After local build succeeds, push to GitHub `master` and wait for the **dev** Release build to succeed. Update the disposable Ubuntu VM using the existing GUI. The release packaging workflow already includes both fixed root helpers and the installer reads these deployment assets.
