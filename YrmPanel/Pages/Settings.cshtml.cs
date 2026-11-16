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
    public SettingsModel(PanelSettingsStore settings, AdminCredentialStore accounts,
        ISystemMetricsService metrics, ServerInfoService server)
    { _settings = settings; _accounts = accounts; _metrics = metrics; _server = server; }

    [BindProperty(SupportsGet = true)] public string Tab { get; set; } = "overview";
    public ServerOverview Info => _server.Get();
    public SystemSnapshot Snapshot => _metrics.GetSnapshot();
    public string AccountName => _accounts.Username;
    public bool HasWallpaper => _settings.GetWallpaper() is not null;
    public long WallpaperVersion => _settings.WallpaperVersion;
    [TempData] public string? Notice { get; set; }

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
