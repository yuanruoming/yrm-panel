namespace YrmPanel.Models;

public sealed record DiskSnapshot(string Name, string Path, bool Available, bool IsMountPoint,
    long TotalBytes, long UsedBytes);

public sealed record SystemSnapshot(string Hostname, string OsName, bool IsDemo,
    double CpuPercent, double MemoryPercent, long MemoryUsedBytes, long MemoryTotalBytes,
    double DownloadBytesPerSecond, double UploadBytesPerSecond, long UptimeSeconds,
    IReadOnlyList<DiskSnapshot> Disks, DateTimeOffset Timestamp);

public sealed record DockerContainer(string Id, string Name, string Image,
    string State, string Status, string Project, string Service);

public sealed record DockerResponse(bool Available, string? Error, IReadOnlyList<DockerContainer> Containers);

public sealed record Shortcut(string Name, string Url);

public sealed class PanelSettings
{
    public List<Shortcut> Shortcuts { get; set; } = new();
    public List<string> PinnedApps { get; set; } = new();
}

public sealed record SystemdServiceState(string Name, string State, string Detail);
