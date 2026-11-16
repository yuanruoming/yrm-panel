using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

/// <summary>The desktop only needs a host label; Docker is loaded on demand in its own page.</summary>
public sealed class IndexModel : PageModel
{
    private readonly ISystemMetricsService _metrics;
    public IndexModel(ISystemMetricsService metrics) => _metrics = metrics;
    public SystemSnapshot Snapshot { get; private set; } = default!;
    public void OnGet() => Snapshot = _metrics.GetSnapshot();
}
