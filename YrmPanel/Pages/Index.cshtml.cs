using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

/// <summary>The desktop only needs a host label; Docker is loaded on demand in its own page.</summary>
public sealed class IndexModel : PageModel
{
    private readonly ISystemMetricsService _metrics;
    private readonly SystemPowerService _power;
    public IndexModel(ISystemMetricsService metrics, SystemPowerService power)
    { _metrics = metrics; _power = power; }
    public SystemSnapshot Snapshot { get; private set; } = default!;
    public async Task<IActionResult> OnPostRebootAsync()
    {
        var (ok, message) = await _power.RequestAsync("reboot", HttpContext.RequestAborted);
        TempData["PowerMessage"] = message;
        return RedirectToPage();
    }
    public async Task<IActionResult> OnPostShutdownAsync()
    {
        var (ok, message) = await _power.RequestAsync("shutdown", HttpContext.RequestAborted);
        TempData["PowerMessage"] = message;
        return RedirectToPage();
    }
    public void OnGet() => Snapshot = _metrics.GetSnapshot();
}
