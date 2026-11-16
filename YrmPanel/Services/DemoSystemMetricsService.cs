using YrmPanel.Models;

namespace YrmPanel.Services;

public sealed class DemoSystemMetricsService : ISystemMetricsService
{
    private readonly DateTimeOffset _started = DateTimeOffset.UtcNow;
    public SystemSnapshot GetSnapshot()
    {
        var seconds = (DateTimeOffset.UtcNow - _started).TotalSeconds;
        return new SystemSnapshot(Environment.MachineName, "Windows / UI demo (not Linux measurements)", true,
            12 + Math.Sin(seconds / 8) * 3, 28, 2_400_000_000, 8_500_000_000,
            100_000 + 30_000 * Math.Sin(seconds / 4), 30_000, (long)seconds,
            new[] {
                new DiskSnapshot("System", "/", true, true, 500_000_000_000, 195_000_000_000),
                new DiskSnapshot("Data", "/data", true, false, 500_000_000_000, 195_000_000_000),
                new DiskSnapshot("Backup", "/backup", false, false, 0, 0)
            }, DateTimeOffset.UtcNow);
    }
}
