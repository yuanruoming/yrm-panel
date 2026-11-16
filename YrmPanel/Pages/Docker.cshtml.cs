using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class DockerModel : PageModel
{
    private readonly DockerApiService _docker;
    public DockerModel(DockerApiService docker) => _docker = docker;
    public DockerResponse Docker { get; private set; } = default!;
    public bool ControlsEnabled => _docker.ControlsEnabled;
    [TempData] public string? Notice { get; set; }

    public async Task OnGetAsync() => Docker = await _docker.ListAsync(HttpContext.RequestAborted);

    public async Task<IActionResult> OnGetLogsAsync(string id)
    {
        var result = await _docker.LogsAsync(id ?? "", HttpContext.RequestAborted);
        Response.Headers.CacheControl = "no-store";
        return Content(result, "text/plain; charset=utf-8");
    }

    public async Task<IActionResult> OnPostControlAsync(string id, string operation)
    {
        var (ok, message) = await _docker.ControlAsync(id ?? "", operation ?? "", HttpContext.RequestAborted);
        Notice = (ok ? "Success: " : "Error: ") + message;
        return RedirectToPage();
    }
}
