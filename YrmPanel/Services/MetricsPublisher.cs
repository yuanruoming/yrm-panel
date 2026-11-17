using YrmPanel.Models;

namespace YrmPanel.Services;

/// <summary>
/// One system-wide 1-second sampler. Connected browsers consume its latest
/// sample over SSE instead of each independently polling /proc.
/// </summary>
public sealed class MetricsPublisher : BackgroundService
{
    private readonly ISystemMetricsService _metrics;
    private readonly ILogger<MetricsPublisher> _logger;
    private SystemSnapshot? _latest;
    public SystemSnapshot Current => Volatile.Read(ref _latest) ?? _metrics.GetSnapshot();

    public MetricsPublisher(ISystemMetricsService metrics, ILogger<MetricsPublisher> logger)
    {
        _metrics = metrics;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        do
        {
            try { Volatile.Write(ref _latest, _metrics.GetSnapshot()); }
            catch (Exception ex) { _logger.LogWarning(ex, "Metrics sampler failed"); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
