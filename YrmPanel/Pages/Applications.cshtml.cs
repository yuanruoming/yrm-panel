using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class ApplicationsModel : PageModel
{
    private readonly DockerApiService _docker;
    private readonly PanelSettingsStore _settings;
    public ApplicationsModel(DockerApiService docker, PanelSettingsStore settings)
    {
        _docker = docker; _settings = settings;
    }
    public DockerResponse Docker { get; private set; } = default!;
    public IReadOnlyList<Shortcut> Shortcuts { get; private set; } = [];
    public async Task OnGetAsync()
    {
        Docker = await _docker.ListAsync(HttpContext.RequestAborted);
        Shortcuts = _settings.Read().Shortcuts;
    }
}
