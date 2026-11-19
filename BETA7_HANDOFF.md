# YRM PANEL v1.0.0 BETA7 — Direct replacement handoff

**Baseline:** GitHub master `3403a8283e1cb7eeedd335acf6bf622fc1f15d18` (BETA6).

## Apply

Extract this ZIP at the root of the existing project, replacing matching files. **Do not** delete the existing project: this is an overlay containing every *changed or new* file, not a standalone .NET project. Keep your existing `YrmPanel/Services/CloudflareDdnsClient.cs`, original `panel.js`, installers and untouched project files.

Build on Windows:

```powershell
dotnet build .\YrmPanel\YrmPanel.csproj -c Release
```

Commit/push the new files `YrmPanel/wwwroot/js/v1-confirm.js`, `YrmPanel/wwwroot/js/v1-ddns-edit.js`, `tests/test_beta7.py` as well as changed files. Deploy the rolling dev release only to the disposable Ubuntu VM first.

## Storage test (important)

The original failure was `/etc` being read-only *inside the YRM web service's mount namespace*, confirmed by the user's `nsenter` output. The updated root helper submits all mount/unmount/provision operations to **host systemd** with `systemd-run --system --wait --pipe --collect`. It will never silently retry inside the restricted web namespace. The root worker continues performing the same UUID/partition/path checks; no automatic format is introduced.

1. The existing `/dev/sdb1` is already ext4. **Do not initialize or format again.**
2. In Storage use Mount `/data` + Mount on startup. Supply the Linux admin password once.
3. Check `findmnt --mountpoint /data`, `findmnt --mountpoint /data -o UUID,TARGET,SOURCE`, and `grep yrm-panel-managed /etc/fstab` in host Ubuntu. A mount success toast alone is not proof.
4. Test creating a folder inside `/data` through Files. For a brand-new empty ext4 volume mounted at `/data` or `/backup`, the helper tries to make the **volume root only** writable by the selected Panel account. Existing populated volumes are unchanged; no recursive chown occurs.
5. Reboot disposable VM and verify `/data` exists, readable/writable through Files and listed by `findmnt`.
6. If the helper reports error, check `journalctl -t systemd-run -n 30` and `journalctl --since '5 minutes ago' | grep -i yrm-panel-mount`. No unverified manual `mkfs` or `wipefs -a`.

**Not yet proven on real Ubuntu:** the sandbox cannot exercise the user's systemd manager or privileged mount namespace. `systemd-run` behavior has only been checked against its documented contract and mocked tests.

## DDNS

- Existing BETA6 Cloudflare, Dynu IPv4/IPv6 and Custom profiles are preserved in the existing profile JSON (new fields are optional with defaults).
- One row per provider+hostname with separate IPv4 and IPv6 states. Record-level Edit can adjust stored hostname, credentials, IP source, interval and enabled state (including advanced request/response settings for Custom API); it keeps the existing secret if the password/token field is blank.
- IP source: automatic public (default), network interface's actual address, manual address, or disabled. Selecting a private network-interface address may intentionally publish a private record; it is not automatically the router's public address.
- **Check Now** runs detection, necessary provider update and verification; DNS lookup unavailable is not categorized as an update rejection.
- **Test** for Cloudflare reads Zone/record via official API without changing the DNS record. **Test & Update** for Dynu or Custom sends a real request and asks for confirmation.
- This release does not add extra provider-specific adapters. New mobile app/PWA is deferred to 4.0.

## Dialogs

The new global YRM confirm modal intercepts existing `data-confirm` forms at window capture before the existing shell handler, and temporarily clears the `data-confirm` attribute on the approved re-submission. That preserves the existing CSRF, AJAX and sudo password flows. Files duplicate uploads also use the new async dialog, Firewall invalid ports get inline errors. Browser-owned HTTPS certificate warnings cannot be replaced by the web app.

## Checks performed

- `python -m unittest discover -s tests -p 'test_beta*.py'` (**51 tests passed**, mostly source checks/mock unit tests).
- `python -m py_compile scripts/yrm-panel-mount.py`.
- `node --check` for the modified JS and existing BETA6 DOM preset test.
- Full ZIP path, zip-entry CRC and content hash verified before handoff.

**Not completed:** .NET 10 SDK compilation (not installed here), an actual browser E2E, host mount + reboot, or live Dynu/Cloudflare transactions. Confirm all on Windows/Ubuntu before a Stable release.
