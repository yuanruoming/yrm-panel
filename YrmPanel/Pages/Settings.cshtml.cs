using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class SettingsModel : PageModel
{
    private readonly PanelSettingsStore _settings;
    private readonly AdminCredentialStore _accounts;
    private readonly ISystemMetricsService _metrics;
    private readonly ServerInfoService _server;
    private readonly SystemdStatusService _services;
    private readonly SambaManagementService _samba;
    private readonly UpdateService _updates;
    private readonly StorageDeviceService _devices;
    private readonly FirewallService _firewall;
    private readonly DdnsService _ddns;
    private readonly PanelCertificateService _certificates;

    public SettingsModel(
        PanelSettingsStore settings,
        AdminCredentialStore accounts,
        ISystemMetricsService metrics,
        ServerInfoService server,
        SystemdStatusService services,
        SambaManagementService samba,
        UpdateService updates,
        StorageDeviceService devices,
        FirewallService firewall,
        DdnsService ddns,
        PanelCertificateService certificates)
    {
        _settings = settings;
        _accounts = accounts;
        _metrics = metrics;
        _server = server;
        _services = services;
        _samba = samba;
        _updates = updates;
        _devices = devices;
        _firewall = firewall;
        _ddns = ddns;
        _certificates = certificates;
    }

    private static readonly HashSet<string> TaskbarApps = new(StringComparer.Ordinal)
    { "/Applications", "/Docker", "/Files", "/Settings" };

    // A single administrator's pins live in the existing Panel settings.json.
    // They survive switching browsers and do not require another taskbar database.
    public IActionResult OnGetTaskbarPins()
    {
        Response.Headers["Cache-Control"] = "no-store";
        var settings = _settings.Read();
        var antiforgery = HttpContext.RequestServices
            .GetRequiredService<Microsoft.AspNetCore.Antiforgery.IAntiforgery>();
        var csrf = antiforgery.GetAndStoreTokens(HttpContext).RequestToken;
        return new JsonResult(new {
            pins = settings.PinnedApps.ToArray(),
            shortcuts = settings.Shortcuts.Select((item, index) => new {
                id = "link:" + index, name = item.Name, url = item.Url
            }).ToArray(),
            token = csrf
        });
    }

    public async Task<IActionResult> OnPostTaskbarPinAsync(string id, bool pinned)
    {
        if (!TaskbarApps.Contains(id)) return BadRequest(new { error = "Unknown application." });
        try
        {
            await _settings.SetPinnedAsync(id, pinned);
            return new JsonResult(new { ok = true });
        }
        catch (InvalidOperationException ex)
        { return BadRequest(new { error = ex.Message }); }
    }

    [BindProperty(SupportsGet = true)] public string Tab { get; set; } = "overview";
    [BindProperty(SupportsGet = true)] public string Section { get; set; } = "firewall";
    public string SecuritySection => Section == "certificates" ? "certificates" : "firewall";
    public ServerOverview Info => _server.Get();
    public SystemSnapshot Snapshot => _metrics.GetSnapshot();
    public string AccountName => OperatingSystem.IsLinux()
        ? Environment.GetEnvironmentVariable("YRM_PANEL_USER") ?? "Linux user"
        : _accounts.Username;
    public bool HasWallpaper => _settings.GetWallpaper() is not null;
    public long WallpaperVersion => _settings.WallpaperVersion;
    public IReadOnlyList<PanelSettingsStore.WallpaperHistoryItem> WallpaperHistory => _settings.ListWallpaperHistory();
    public IReadOnlyList<SystemdServiceState> Services { get; private set; } = [];
    public SambaOverview Sharing { get; private set; } = new(false, "Samba is unavailable.", "", false, []);
    public UpdateProgress UpdateStatus => _updates.Progress;
    public UpdateAvailability? LastUpdateCheck => _updates.LastCheck;
    public string UpdateChannel => _updates.Channel;
    public IReadOnlyList<StorageDevice> StorageDevices { get; private set; } = [];
    public FirewallOverview Firewall { get; private set; } = new(false, "Not checked.", false, [], "Unavailable.");
    public IReadOnlyList<DdnsProfileView> DdnsProfiles { get; private set; } = [];
    public IReadOnlyList<string> DdnsNetworkInterfaces => OperatingSystem.IsLinux()
        ? System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
            .Select(n => n.Name).OrderBy(n => n).ToArray()
        : [];
    public PanelCertificateInfo Certificate => _certificates.Info();
    [TempData] public string? Notice { get; set; }

    public bool IsVirtualAdapter(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;
        return name.Equals("docker0", StringComparison.OrdinalIgnoreCase)
            || name.Equals("lo", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("br-", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("veth", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("virbr", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("vnet", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("tun", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("tap", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("tailscale", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("wg", StringComparison.OrdinalIgnoreCase);
    }

    public bool IsLinkLocalIpv6(string address) =>
        !string.IsNullOrWhiteSpace(address) &&
        address.StartsWith("fe80:", StringComparison.OrdinalIgnoreCase);

    public bool IsSmallUnformatted(StorageDevice item)
    {
        if (item.Type != "part" || item.FileSystem.Length > 0 || item.MountPoint.Length > 0)
            return false;
        var size = item.Size.Trim().ToUpperInvariant();
        if (size.Length < 2) return false;
        var unit = size[^1];
        if (unit is not ('K' or 'M')) return false;
        return double.TryParse(size[..^1], System.Globalization.NumberStyles.Float,
                   System.Globalization.CultureInfo.InvariantCulture, out var amount)
               && amount > 0 && (unit == 'K' || amount <= 16);
    }

    public string SuggestedMountPath(StorageDevice partition)
    {
        var disks = StorageDevices.Where(x => x.Type == "disk").ToArray();
        var index = Array.FindIndex(disks, x => x.Path == partition.ParentPath || x.Path == partition.Path);
        // Friendly defaults for extra volumes; an existing directory is never overwritten.
        // Numbered volume paths are suggestions for NEW mounts only. Existing
        // UUID-mounted /data or /backup volumes are never moved automatically.
        return index >= 1 ? $"/volume{index + 1}" : "/mnt/" + partition.Name;
    }

    public bool HasVolumeShares(string mountPath)
    {
        if (!Sharing.Available || string.IsNullOrEmpty(mountPath)) return false;
        var root = mountPath.TrimEnd('/');
        return Sharing.Shares.Any(share => share.Path == root ||
            share.Path.StartsWith(root + "/", StringComparison.Ordinal));
    }

    public async Task OnGetAsync()
    {
        switch (Tab)
        {
            case "services":
                Services = await _services.ListAsync();
                break;
            case "storage":
                StorageDevices = await _devices.ListAsync(HttpContext.RequestAborted);
                Sharing = await _samba.ListAsync(HttpContext.RequestAborted);
                break;
            case "security":
                if (SecuritySection == "firewall")
                    Firewall = await _firewall.GetAsync(HttpContext.RequestAborted);
                break;
            case "ddns":
                DdnsProfiles = await _ddns.ListAsync(HttpContext.RequestAborted);
                break;
            case "sharing":
                Sharing = await _samba.ListAsync(HttpContext.RequestAborted);
                break;
        }
    }

    public async Task<IActionResult> OnPostCheckUpdateAsync()
    {
        var result = await _updates.CheckAsync(HttpContext.RequestAborted);
        // The update result belongs to About, not the global toast system.
        return RedirectToPage(new { tab = "about" });
    }

    public async Task<IActionResult> OnPostUpdateAsync(string? adminPassword)
    {
        var result = await _updates.StartAsync(adminPassword, HttpContext.RequestAborted);
        if (!result.Ok) Notice = "Error: " + result.Message;
        return RedirectToPage(new { tab = "about" });
    }

    public async Task<IActionResult> OnPostMountAsync(string uuid, string mountPath, bool automatic,
        string? adminPassword)
    {
        var result = await _devices.MountAsync(uuid, mountPath, automatic, adminPassword, HttpContext.RequestAborted);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "storage" });
    }

    public async Task<IActionResult> OnPostUnmountAsync(string mountPath, string uuid, string? adminPassword)
    {
        // Stop before unmounting a volume that still backs SMB shares.
        // Never silently redirect a share to an empty mountpoint directory.
        var ct = HttpContext.RequestAborted;
        var shares = await _samba.ListAsync(ct);
        if (!shares.Available)
        {
            Notice = "Error: Unable to verify active SMB shares; unmount cancelled.";
            return RedirectToPage(new { tab = "storage" });
        }
        var root = (mountPath ?? string.Empty).TrimEnd('/');
        if (root.Length == 0 || shares.Shares.Any(s =>
            s.Path == root || s.Path.StartsWith(root + "/", StringComparison.Ordinal)))
        {
            Notice = "Error: This volume still contains an SMB share. Stop sharing its folders in Files or Settings > Sharing before unmounting.";
            return RedirectToPage(new { tab = "storage" });
        }
        // The UUID must still identify the selected mounted filesystem. Avoid acting
        // on an old /backup or /volume2 form after an external Linux change.
        var current = await _devices.ListAsync(ct);
        if (string.IsNullOrWhiteSpace(uuid) || !current.Any(v =>
            v.Uuid == uuid && v.MountPoint == root && v.ManagedMount))
        {
            Notice = "Error: This volume changed or is no longer managed. Refresh Storage and try again.";
            return RedirectToPage(new { tab = "storage" });
        }
        var result = await _devices.UnmountAsync(root, uuid, adminPassword, ct);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "storage" });
    }

    public async Task<IActionResult> OnPostInitializeDiskAsync(string diskPath, string confirmation,
        string? adminPassword)
    {
        // The privileged helper re-examines partition tables, signatures and mounts.
        var result = await _devices.InitializeAsync(diskPath, confirmation, adminPassword, HttpContext.RequestAborted);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "storage" });
    }

    public async Task<IActionResult> OnPostCompleteDiskAsync(string partitionPath, string confirmation,
        string? adminPassword)
    {
        var result = await _devices.CompleteAsync(partitionPath, confirmation, adminPassword, HttpContext.RequestAborted);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "storage" });
    }

    public async Task<IActionResult> OnPostFirewallAsync(string? rulesJson, bool? firewallEnabled, string? adminPassword)
    {
        var result = await _firewall.ApplyAsync(rulesJson, firewallEnabled, adminPassword, HttpContext.RequestAborted);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "security", section = "firewall" });
    }

    public async Task<IActionResult> OnPostFirewallConfirmAsync(string nonce)
    {
        var result = await _firewall.ConfirmAsync(nonce, HttpContext.RequestAborted);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "security", section = "firewall" });
    }

    public async Task<IActionResult> OnPostDdnsAddAsync(string name, string hostname, string recordType,
        string urlTemplate, string httpMethod, string headerName, string token, string bodyTemplate,
        string successContains, int intervalMinutes, string? detectionUrl, string? authType,
        string? username, string? responseMode, string? successCodes, string? unchangedCodes,
        string? errorCodes, string? jsonProperty, string? jsonExpected, bool verifyDns, string? provider)
    {
        var options = new DdnsProfileOptions(
            detectionUrl ?? "", authType ?? "header", username ?? "", responseMode ?? "codes",
            successCodes ?? "", unchangedCodes ?? "", errorCodes ?? "",
            jsonProperty ?? "success", jsonExpected ?? "true", verifyDns, provider ?? "custom");
        Notice = await _ddns.AddAsync(name, hostname, recordType, urlTemplate, httpMethod, headerName,
            token, bodyTemplate, successContains, intervalMinutes, HttpContext.RequestAborted, options);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsAddGroupAsync(string name, string hostname, string recordType,
        string urlTemplate, string httpMethod, string headerName, string token, string bodyTemplate,
        string successContains, int intervalMinutes, string? detectionUrl, string? authType,
        string? username, string? responseMode, string? successCodes, string? unchangedCodes,
        string? errorCodes, string? jsonProperty, string? jsonExpected, bool verifyDns, string? provider,
        bool ipv4Enabled, bool ipv6Enabled)
    {
        var ct = HttpContext.RequestAborted;
        provider = (provider ?? "custom").Trim().ToLowerInvariant();
        var families = provider == "custom"
            ? new[] { recordType == "AAAA" ? "AAAA" : "A" }
            : new[] { ipv4Enabled ? "A" : "", ipv6Enabled ? "AAAA" : "" }.Where(x => x.Length > 0).ToArray();
        if (families.Length == 0)
        {
            Notice = "Error: Enable IPv4, IPv6 or both.";
            return RedirectToPage(new { tab = "ddns" });
        }
        var before = await _ddns.ListAsync(ct);
        if (before.Any(p => p.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase) &&
            p.Hostname.Equals(hostname?.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            Notice = "Error: This hostname already has a provider configuration. Use Edit instead.";
            return RedirectToPage(new { tab = "ddns" });
        }
        var options = new DdnsProfileOptions(detectionUrl ?? "", authType ?? "header", username ?? "",
            responseMode ?? "codes", successCodes ?? "", unchangedCodes ?? "", errorCodes ?? "",
            jsonProperty ?? "success", jsonExpected ?? "true", verifyDns, provider);
        foreach (var type in families)
        {
            var apiUrl = provider == "dynu" ? (type == "AAAA"
                ? "https://api-ipv6.dynu.com/nic/update?hostname={hostname}&myip=no&myipv6={ip}"
                : "https://api-ipv4.dynu.com/nic/update?hostname={hostname}&myip={ip}&myipv6=no")
                : urlTemplate;
            var result = await _ddns.AddAsync(name, hostname, type, apiUrl, httpMethod, headerName,
                token, bodyTemplate, successContains, intervalMinutes, ct, options);
            if (!result.StartsWith("Error:", StringComparison.Ordinal)) continue;
            // Roll back only records this request added; a two-record form must
            // not silently leave a half-created provider if the second fails.
            var created = (await _ddns.ListAsync(ct)).Where(p => !before.Any(b => b.Id == p.Id) &&
                p.Provider == provider && p.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)).ToArray();
            foreach (var p in created) await _ddns.RemoveAsync(p.Id, ct);
            Notice = result;
            return RedirectToPage(new { tab = "ddns" });
        }
        Notice = null;
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsEditGroupAsync(string provider, string originalHostname,
        string name, string hostname, string? username, string? token,
        bool ipv4Enabled, bool ipv6Enabled, string? ipSource4, string? ipSource6,
        string? manualIp4, string? manualIp6, string? interfaceName4, string? interfaceName6,
        int intervalMinutes, bool enabled, string? apiUrl, string? httpMethod,
        string? authType, string? headerName, string? bodyTemplate, string? responseMode,
        string? successCodes, string? unchangedCodes, string? errorCodes,
        string? jsonProperty, string? jsonExpected)
    {
        var ct = HttpContext.RequestAborted;
        var all = await _ddns.ListAsync(ct);
        var group = all.Where(p => p.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase) &&
            p.Hostname.Equals(originalHostname, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (group.Length == 0 || all.Any(p => !group.Any(x => x.Id == p.Id) &&
            p.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase) &&
            p.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)))
        {
            Notice = "Error: Provider is missing or hostname already belongs to another configuration.";
            return RedirectToPage(new { tab = "ddns" });
        }
        // Validate each family's options before changing either record so a
        // bad IPv6 manual IP cannot leave IPv4 saved and IPv6 rejected.
        foreach (var family in new[] {
            (on: ipv4Enabled, src: ipSource4, ip: manualIp4, iface: interfaceName4,
             addressFamily: System.Net.Sockets.AddressFamily.InterNetwork),
            (on: ipv6Enabled, src: ipSource6, ip: manualIp6, iface: interfaceName6,
             addressFamily: System.Net.Sockets.AddressFamily.InterNetworkV6) })
        {
            if (!family.on) continue;
            var source = family.src ?? "public";
            if (source is not ("public" or "manual" or "interface"))
            { Notice = "Error: Invalid IP source."; return RedirectToPage(new { tab = "ddns" }); }
            if (source == "manual" && (!System.Net.IPAddress.TryParse(family.ip, out var parsed) ||
                parsed.AddressFamily != family.addressFamily))
            { Notice = "Error: Invalid IPv4 or IPv6 manual address."; return RedirectToPage(new { tab = "ddns" }); }
            if (source == "interface" && (string.IsNullOrWhiteSpace(family.iface) ||
                !DdnsNetworkInterfaces.Contains(family.iface, StringComparer.Ordinal)))
            { Notice = "Error: Select an existing network interface."; return RedirectToPage(new { tab = "ddns" }); }
        }
        var missing = new[] { (type: "A", on: ipv4Enabled), (type: "AAAA", on: ipv6Enabled) }
            .Where(x => x.on && !group.Any(p => p.RecordType == x.type)).ToArray();
        if (missing.Length > 0 && (string.IsNullOrWhiteSpace(token) || provider == "custom"))
        {
            Notice = "Error: To enable a new IP record, enter the provider credential again. Custom APIs require a separate record template.";
            return RedirectToPage(new { tab = "ddns" });
        }
        foreach (var item in group)
        {
            var isV4 = item.RecordType == "A";
            var on = isV4 ? ipv4Enabled : ipv6Enabled;
            var source = on ? (isV4 ? ipSource4 : ipSource6) ?? "public" : "disabled";
            var manual = isV4 ? manualIp4 : manualIp6;
            var iface = isV4 ? interfaceName4 : interfaceName6;
            var result = await _ddns.EditAsync(item.Id, name, hostname, username ?? "", token ?? "",
                source, manual ?? "", iface ?? "", intervalMinutes, enabled, ct,
                apiUrl, httpMethod, authType, headerName, bodyTemplate, responseMode,
                successCodes, unchangedCodes, errorCodes, jsonProperty, jsonExpected);
            if (result.StartsWith("Error:", StringComparison.Ordinal))
            {
                Notice = result;
                return RedirectToPage(new { tab = "ddns" });
            }
        }
        if (missing.Length > 0)
        {
            var sample = group[0];
            var opts = new DdnsProfileOptions(sample.DetectionUrl, sample.AuthType,
                username ?? sample.Username, sample.ResponseMode, sample.SuccessCodes,
                sample.UnchangedCodes, sample.ErrorCodes, sample.JsonProperty,
                sample.JsonExpected, sample.VerifyDns, sample.Provider);
            foreach (var item in missing)
            {
                var url = provider == "dynu" ? (item.type == "AAAA"
                    ? "https://api-ipv6.dynu.com/nic/update?hostname={hostname}&myip=no&myipv6={ip}"
                    : "https://api-ipv4.dynu.com/nic/update?hostname={hostname}&myip={ip}&myipv6=no")
                    : sample.UrlTemplate;
                var result = await _ddns.AddAsync(name, hostname, item.type, url, sample.HttpMethod,
                    sample.HeaderName, token ?? "", sample.BodyTemplate, sample.SuccessContains,
                    intervalMinutes, ct, opts);
                if (result.StartsWith("Error:", StringComparison.Ordinal))
                {
                    Notice = result;
                    return RedirectToPage(new { tab = "ddns" });
                }
                var added = (await _ddns.ListAsync(ct)).FirstOrDefault(p =>
                    p.Provider == provider && p.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)
                    && p.RecordType == item.type && !all.Any(old => old.Id == p.Id));
                if (added is not null)
                {
                    var v4 = item.type == "A";
                    var changed = await _ddns.EditAsync(added.Id, name, hostname, username ?? "", "",
                        (v4 ? ipSource4 : ipSource6) ?? "public",
                        (v4 ? manualIp4 : manualIp6) ?? "",
                        (v4 ? interfaceName4 : interfaceName6) ?? "",
                        intervalMinutes, enabled, ct);
                    if (changed.StartsWith("Error:", StringComparison.Ordinal))
                    { Notice = changed; return RedirectToPage(new { tab = "ddns" }); }
                }
            }
        }
        Notice = null;
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsDeleteGroupAsync(string provider, string hostname)
    {
        var ct = HttpContext.RequestAborted;
        var matches = (await _ddns.ListAsync(ct)).Where(p =>
            p.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase) &&
            p.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)).ToArray();
        foreach (var item in matches)
        {
            var status = await _ddns.RemoveAsync(item.Id, ct);
            if (status.StartsWith("Error:", StringComparison.Ordinal))
            {
                Notice = status;
                return RedirectToPage(new { tab = "ddns" });
            }
        }
        Notice = null;
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsEditAsync(string id, string name, string hostname,
        string? username, string? token, string? ipSource, string? manualIp,
        string? interfaceName, int intervalMinutes, bool enabled,
        string? apiUrl, string? httpMethod, string? authType, string? headerName,
        string? bodyTemplate, string? responseMode, string? successCodes,
        string? unchangedCodes, string? errorCodes, string? jsonProperty, string? jsonExpected)
    {
        Notice = await _ddns.EditAsync(id, name, hostname, username ?? "", token ?? "",
            ipSource ?? "public", manualIp ?? "", interfaceName ?? "", intervalMinutes, enabled,
            HttpContext.RequestAborted, apiUrl, httpMethod, authType, headerName, bodyTemplate,
            responseMode, successCodes, unchangedCodes, errorCodes, jsonProperty, jsonExpected);
        return RedirectToPage(new { tab = "ddns" });
    }

    // The toolbar's Update button checks all enabled profiles. This uses the
    // existing provider updater and changes no DDNS configuration or DNS records
    // unless an update is actually required by that provider.
    public async Task<IActionResult> OnPostDdnsUpdateAllAsync()
    {
        var profiles = (await _ddns.ListAsync(HttpContext.RequestAborted))
            .Where(p => p.Enabled && p.IpSource != "disabled")
            .Take(50).ToArray();
        if (profiles.Length == 0)
        {
            Notice = "No enabled DDNS records to update.";
            return RedirectToPage(new { tab = "ddns" });
        }
        var failed = 0;
        foreach (var profile in profiles)
        {
            var result = await _ddns.UpdateAsync(profile.Id, true, HttpContext.RequestAborted);
            if (result.Contains("Failed", StringComparison.OrdinalIgnoreCase) ||
                result.StartsWith("Error:", StringComparison.OrdinalIgnoreCase)) failed++;
        }
        Notice = failed > 0 ? $"Error: {failed} of {profiles.Length} DNS records failed. Check the status below."
            : $"Checked {profiles.Length} DNS records.";
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsGroupCheckAsync(string hostname, string provider)
    {
        var profiles = await _ddns.ListAsync(HttpContext.RequestAborted);
        var matches = profiles.Where(p => p.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)
            && p.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase)).Take(4).ToArray();
        if (matches.Length == 0) Notice = "Error: No matching DDNS profiles.";
        else
        {
            var results = new List<string>();
            foreach (var item in matches.Where(p => p.IpSource != "disabled"))
            {
                var state = await _ddns.UpdateAsync(item.Id, true, HttpContext.RequestAborted);
                results.Add($"{item.RecordType}: {state}");
            }
            Notice = results.Count == 0 ? "Error: No enabled IP source exists for this hostname. Edit the provider first." :
                results.Any(x => x.Contains("Failed", StringComparison.OrdinalIgnoreCase)
                || x.Contains("Error:", StringComparison.OrdinalIgnoreCase))
                ? "Error: " + string.Join("; ", results)
                : "DDNS check completed. Provider states are shown below.";
        }
        if (Request.Headers["X-Requested-With"] == "XMLHttpRequest")
        {
            var refreshed = (await _ddns.ListAsync(HttpContext.RequestAborted))
                .Where(p => p.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)
                    && p.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase))
                .Select(p => new { id = p.Id, ip = p.LastIp, status = p.LastStatus,
                    lastRun = p.LastRun?.ToLocalTime().ToString("dd MMM yyyy HH:mm"),
                    verification = p.Verification, enabled = p.Enabled, ipSource = p.IpSource }).ToArray();
            var message = Notice ?? "DDNS check completed.";
            Notice = null; // JSON action must not leave a stale TempData toast for later GETs.
            return new JsonResult(new { ok = !message.StartsWith("Error:", StringComparison.Ordinal),
                message, records = refreshed });
        }
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsConnectionAsync(string id)
    {
        Notice = await _ddns.TestConnectionAsync(id, HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsDeleteAsync(string id)
    {
        Notice = await _ddns.RemoveAsync(id,HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsTestAsync(string id)
    {
        Notice = await _ddns.UpdateAsync(id, true, HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsDetectAsync(string id)
    {
        Notice = await _ddns.DetectAsync(id, HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsVerifyAsync(string id)
    {
        Notice = await _ddns.VerifyAsync(id, HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostDdnsToggleAsync(string id)
    {
        Notice = await _ddns.ToggleAsync(id, HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "ddns" });
    }

    public async Task<IActionResult> OnPostCertificateAsync(IFormFile? certificate,IFormFile? privateKey)
    {
        Notice = await _certificates.ImportAsync(certificate,privateKey,HttpContext.RequestAborted);
        return RedirectToPage(new { tab = "security", section = "certificates" });
    }

    public IActionResult OnPostRestoreCertificate()
    {
        Notice = _certificates.RestoreDefault();
        return RedirectToPage(new { tab = "security", section = "certificates" });
    }

    public async Task<IActionResult> OnPostWallpaperAsync(IFormFile? wallpaper)
    {
        if (wallpaper is null)
        {
            Notice = "Error: Select an image first.";
            return RedirectToPage(new { tab = "appearance" });
        }
        try
        {
            await using var input = wallpaper.OpenReadStream();
            await _settings.SetWallpaperAsync(input, wallpaper.Length);
            Notice = "Desktop wallpaper updated.";
        }
        catch (InvalidOperationException ex)
        {
            Notice = "Error: " + ex.Message;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Notice = "Error: Cannot save the wallpaper in the Panel data directory.";
        }
        return RedirectToPage(new { tab = "appearance" });
    }

    public IActionResult OnGetWallpaperHistoryImage(string? id)
    {
        var history = _settings.FindWallpaperHistoryImage(id);
        if (history is null) return NotFound();
        try
        {
            Response.Headers["Cache-Control"] = "private, max-age=600";
            return File(System.IO.File.OpenRead(history.Value.Path), history.Value.Mime);
        }
        catch (IOException) { return NotFound(); }
        catch (UnauthorizedAccessException) { return NotFound(); }
    }

    public async Task<IActionResult> OnPostRestoreWallpaperHistoryAsync(string? id)
    {
        try
        {
            await _settings.RestoreWallpaperHistoryAsync(id);
            Notice = "Wallpaper restored from history.";
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            Notice = "Error: Could not restore this wallpaper.";
        }
        return RedirectToPage(new { tab = "appearance" });
    }

    public async Task<IActionResult> OnPostDeleteWallpaperHistoryAsync(string? id)
    {
        try
        {
            await _settings.DeleteWallpaperHistoryAsync(id);
            Notice = "Wallpaper history item deleted.";
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            Notice = "Error: Could not delete this wallpaper history item.";
        }
        return RedirectToPage(new { tab = "appearance" });
    }

    public async Task<IActionResult> OnPostClearWallpaperAsync()
    {
        try
        {
            await _settings.ClearWallpaperAsync();
            Notice = "Default wallpaper restored.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Notice = "Error: Cannot restore the default wallpaper.";
        }
        return RedirectToPage(new { tab = "appearance" });
    }
}
