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
    public IReadOnlyList<SystemdServiceState> Services { get; private set; } = [];
    public SambaOverview Sharing { get; private set; } = new(false, "Samba is unavailable.", "", false, []);
    public UpdateProgress UpdateStatus => _updates.Progress;
    public UpdateAvailability? LastUpdateCheck => _updates.LastCheck;
    public string UpdateChannel => _updates.Channel;
    public IReadOnlyList<StorageDevice> StorageDevices { get; private set; } = [];
    public FirewallOverview Firewall { get; private set; } = new(false, "Not checked.", false, [], "Unavailable.");
    public IReadOnlyList<DdnsProfileView> DdnsProfiles { get; private set; } = [];
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
        return index switch
        {
            1 => "/data",
            2 => "/backup",
            _ => "/mnt/" + partition.Name
        };
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

    public async Task<IActionResult> OnPostUnmountAsync(string mountPath, string? adminPassword)
    {
        var result = await _devices.UnmountAsync(mountPath, adminPassword, HttpContext.RequestAborted);
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
