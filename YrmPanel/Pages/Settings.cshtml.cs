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

    public SettingsModel(
        PanelSettingsStore settings,
        AdminCredentialStore accounts,
        ISystemMetricsService metrics,
        ServerInfoService server,
        SystemdStatusService services,
        SambaManagementService samba,
        UpdateService updates)
    {
        _settings = settings;
        _accounts = accounts;
        _metrics = metrics;
        _server = server;
        _services = services;
        _samba = samba;
        _updates = updates;
    }

    [BindProperty(SupportsGet = true)] public string Tab { get; set; } = "overview";
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

    public async Task OnGetAsync()
    {
        switch (Tab)
        {
            case "services":
                Services = await _services.ListAsync();
                break;
            case "sharing":
                Sharing = await _samba.ListAsync(HttpContext.RequestAborted);
                break;
        }
    }

    public async Task<IActionResult> OnPostCheckUpdateAsync()
    {
        var result = await _updates.CheckAsync(HttpContext.RequestAborted);
        Notice = result.Available ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "about" });
    }

    public async Task<IActionResult> OnPostUpdateAsync(string? adminPassword)
    {
        var result = await _updates.StartAsync(adminPassword, HttpContext.RequestAborted);
        Notice = result.Ok ? result.Message : "Error: " + result.Message;
        return RedirectToPage(new { tab = "about" });
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
