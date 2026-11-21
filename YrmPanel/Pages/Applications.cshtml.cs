using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class ApplicationsModel : PageModel
{
    private readonly DockerApiService _docker;
    private readonly PanelSettingsStore _settings;
    public ApplicationsModel(DockerApiService docker, PanelSettingsStore settings)
    { _docker = docker; _settings = settings; }
    public DockerResponse Docker { get; private set; } = default!;
    public IReadOnlyList<Shortcut> Shortcuts { get; private set; } = [];
    public IReadOnlyList<string> Pinned => _settings.Read().PinnedApps;
    [TempData] public string? Notice { get; set; }
    // Applications was retired as a separate Web-link catalog. YRM-HOME
    // remains the user's navigation homepage. Preserve old settings data.
    public IActionResult OnGet() => RedirectToPage("/Docker");
    public async Task<IActionResult> OnPostSaveAsync(int index, string name, string url)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 40 ||
            !Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https") ||
            !string.IsNullOrWhiteSpace(parsed.UserInfo))
        { Notice = "Error: Enter a valid name and HTTP(S) address."; return RedirectToPage(); }
        try
        {
            if (index == -1) await _settings.AddShortcutAsync(name, url);
            else await _settings.UpdateShortcutAsync(index, name, url);
            Notice = "Application saved.";
        }
        catch (InvalidOperationException ex) { Notice = "Error: " + ex.Message; }
        return RedirectToPage();
    }
    public async Task<IActionResult> OnPostDeleteAsync(int index)
    { await _settings.RemoveShortcutAsync(index); Notice = "Application removed."; return RedirectToPage(); }
    public async Task<IActionResult> OnPostPinAsync(string id, bool pinned)
    {
        // Validate Docker app identifiers against the live engine before persisting.
        if (id.StartsWith("docker:", StringComparison.Ordinal))
        {
            var docker = await _docker.ListAsync(HttpContext.RequestAborted);
            var name = id[7..];
            if (!docker.Available || !docker.Containers.Any(c =>
                (string.IsNullOrWhiteSpace(c.Project) ? c.Name : c.Project) == name))
            { Notice = "Error: Docker application unavailable."; return RedirectToPage(); }
        }
        try { await _settings.SetPinnedAsync(id, pinned); Notice = pinned ? "Pinned." : "Unpinned."; }
        catch (InvalidOperationException ex) { Notice = "Error: " + ex.Message; }
        return RedirectToPage();
    }
}
