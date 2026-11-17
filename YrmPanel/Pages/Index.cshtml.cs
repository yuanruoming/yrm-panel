using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class IndexModel : PageModel
{
    private readonly ISystemMetricsService _metrics;
    private readonly SystemPowerService _power;
    public IndexModel(ISystemMetricsService metrics, SystemPowerService power)
    { _metrics = metrics; _power = power; }
    public SystemSnapshot Snapshot { get; private set; } = default!;

    public async Task<IActionResult> OnPostRebootAsync(string? adminPassword)
    {
        var (ok, message) = await _power.RequestAsync("reboot", adminPassword, HttpContext.RequestAborted);
        TempData["PowerMessage"] = ok ? message : "Error: " + message;
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostShutdownAsync(string? adminPassword)
    {
        var (ok, message) = await _power.RequestAsync("shutdown", adminPassword, HttpContext.RequestAborted);
        TempData["PowerMessage"] = ok ? message : "Error: " + message;
        return RedirectToPage();
    }

    public void OnGet() => Snapshot = _metrics.GetSnapshot();
}
