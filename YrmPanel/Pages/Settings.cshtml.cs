using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class SettingsModel : PageModel
{
    private readonly PanelSettingsStore _settings;
    private readonly IConfiguration _configuration;
    private readonly AdminCredentialStore _account;
    public SettingsModel(PanelSettingsStore settings, IConfiguration configuration, AdminCredentialStore account)
    { _settings = settings; _configuration = configuration; _account = account; }
    public string AccountName => _account.Username;

    public IReadOnlyList<Shortcut> Shortcuts => _settings.Read().Shortcuts;
    public IReadOnlyList<string> Pins => _settings.Read().PinnedApps;
    public static readonly (string Id, string Label)[] BuiltIn =
    [
        ("/Applications", "Applications"), ("/Docker", "Docker"), ("/Services", "Services"),
        ("/Files", "Files"), ("/Shares", "File Sharing"), ("/Settings", "Settings")
    ];
    public async Task<IActionResult> OnPostPinAsync(string id, bool pinned)
    {
        try { await _settings.SetPinnedAsync(id, pinned); Notice = pinned ? "Pinned to desktop." : "Removed from desktop."; }
        catch (InvalidOperationException ex) { Notice = ex.Message; }
        return RedirectToPage();
    }

    public string ListenUrl => _configuration["Panel:Url"] ?? "http://127.0.0.1:6080";
    public bool HasWallpaper => _settings.GetWallpaper() is not null;
    [TempData] public string? Notice { get; set; }

    public async Task<IActionResult> OnPostAddShortcutAsync(string name, string url)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 40 ||
            !Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            parsed.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(parsed.UserInfo))
        {
            Notice = "Use a name (1–40 characters) and an http:// or https:// URL without credentials.";
            return RedirectToPage();
        }
        try { await _settings.AddShortcutAsync(name, url); Notice = "Shortcut saved."; }
        catch (InvalidOperationException ex) { Notice = ex.Message; }
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostRemoveShortcutAsync(int index)
    {
        await _settings.RemoveShortcutAsync(index);
        Notice = "Shortcut removed.";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostWallpaperAsync(IFormFile? wallpaper)
    {
        if (wallpaper is null) { Notice = "Choose an image first."; return RedirectToPage(); }
        try { await _settings.SetWallpaperAsync(wallpaper.OpenReadStream(), wallpaper.Length); Notice = "Wallpaper updated."; }
        catch (InvalidOperationException ex) { Notice = ex.Message; }
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostClearWallpaperAsync()
    {
        await _settings.ClearWallpaperAsync();
        Notice = "Default background restored.";
        return RedirectToPage();
    }
}
