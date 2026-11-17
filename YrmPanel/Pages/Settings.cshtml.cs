using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Services;
using YrmPanel.Models;

namespace YrmPanel.Pages;

public sealed class SettingsModel : PageModel
{
    private readonly PanelSettingsStore _settings;
    private readonly AdminCredentialStore _accounts;
    private readonly ISystemMetricsService _metrics;
    private readonly ServerInfoService _server;
    private readonly SystemdStatusService _services;
    private readonly UpdateService _updates;

    public SettingsModel(PanelSettingsStore settings, AdminCredentialStore accounts,
        ISystemMetricsService metrics, ServerInfoService server,
        SystemdStatusService services, UpdateService updates)
    {
        _settings = settings;
        _accounts = accounts;
        _metrics = metrics;
        _server = server;
        _services = services;
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
    public UpdateProgress UpdateStatus => _updates.Progress;
    [TempData] public string? Notice { get; set; }

    public async Task OnGetAsync()
    {
        if (Tab == "services") Services = await _services.ListAsync();
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
        if (wallpaper is null) { Notice = "Error: Select an image."; return RedirectToPage(new { tab = "appearance" }); }
        try
        {
            await using var input = wallpaper.OpenReadStream();
            await _settings.SetWallpaperAsync(input, wallpaper.Length);
            Notice = "Wallpaper updated.";
        }
        catch (InvalidOperationException ex) { Notice = "Error: " + ex.Message; }
        return RedirectToPage(new { tab = "appearance" });
    }

    public async Task<IActionResult> OnPostClearWallpaperAsync()
    {
        await _settings.ClearWallpaperAsync();
        Notice = "Default background restored.";
        return RedirectToPage(new { tab = "appearance" });
    }
}
