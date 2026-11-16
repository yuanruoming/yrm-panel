using System.Globalization;
using YrmPanel.Models;

namespace YrmPanel.Services;

public sealed class LinuxSystemMetricsService : ISystemMetricsService
{
    private readonly IConfiguration _configuration;
    private readonly object _gate = new();
    private (long idle, long total)? _lastCpu;
    private (long receive, long transmit, DateTimeOffset time)? _lastNet;

    public LinuxSystemMetricsService(IConfiguration configuration) => _configuration = configuration;

    public SystemSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            var (idle, total) = ReadCpu();
            double cpu = 0;
            if (_lastCpu is { } last && total > last.total)
                cpu = Math.Clamp(100.0 * (1.0 - (idle - last.idle) / (double)(total - last.total)), 0, 100);
            _lastCpu = (idle, total);

            var memory = ReadMemory();
            var now = DateTimeOffset.UtcNow;
            var (receive, transmit) = ReadNetwork();
            double down = 0, up = 0;
            if (_lastNet is { } previous)
            {
                var seconds = (now - previous.time).TotalSeconds;
                if (seconds > 0.1)
                {
                    down = Math.Max(0, (receive - previous.receive) / seconds);
                    up = Math.Max(0, (transmit - previous.transmit) / seconds);
                }
            }
            _lastNet = (receive, transmit, now);

            var main = _configuration["Storage:MainPath"] ?? "/data";
            var backup = _configuration["Storage:BackupPath"] ?? "/backup";
            var mounts = ReadMounts();
            return new SystemSnapshot(Environment.MachineName, ReadOsName(), false,
                cpu, memory.total == 0 ? 0 : 100.0 * memory.used / memory.total,
                memory.used, memory.total, down, up, ReadUptime(),
                new[] { BuildDisk("System", "/", mounts), BuildDisk("Data", main, mounts),
                        BuildDisk("Backup", backup, mounts) }, now);
        }
    }

    private static (long idle, long total) ReadCpu()
    {
        var line = File.ReadLines("/proc/stat").First();
        var values = line.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Skip(1).Select(x => long.Parse(x, CultureInfo.InvariantCulture)).ToArray();
        long idle = values[3] + (values.Length > 4 ? values[4] : 0);
        return (idle, values.Sum());
    }

    private static (long used, long total) ReadMemory()
    {
        long total = 0, available = 0;
        foreach (var line in File.ReadLines("/proc/meminfo"))
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;
            if (parts[0] == "MemTotal:") total = long.Parse(parts[1], CultureInfo.InvariantCulture) * 1024;
            if (parts[0] == "MemAvailable:") available = long.Parse(parts[1], CultureInfo.InvariantCulture) * 1024;
        }
        return (Math.Max(0, total - available), total);
    }

    private static (long receive, long transmit) ReadNetwork()
    {
        long rx = 0, tx = 0;
        foreach (var line in File.ReadLines("/proc/net/dev").Skip(2))
        {
            var segments = line.Split(':', 2);
            if (segments.Length != 2) continue;
            var name = segments[0].Trim();
            if (name == "lo" || name.StartsWith("veth") || name.StartsWith("docker") ||
                name.StartsWith("br-") || name.StartsWith("virbr")) continue;
            var values = segments[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (values.Length < 16) continue;
            rx += long.Parse(values[0], CultureInfo.InvariantCulture);
            tx += long.Parse(values[8], CultureInfo.InvariantCulture);
        }
        return (rx, tx);
    }

    private static long ReadUptime()
    {
        var first = File.ReadAllText("/proc/uptime").Split(' ')[0];
        return (long)double.Parse(first, CultureInfo.InvariantCulture);
    }

    private static string ReadOsName()
    {
        try
        {
            var line = File.ReadLines("/etc/os-release").FirstOrDefault(x => x.StartsWith("PRETTY_NAME="));
            return line?.Split('=', 2)[1].Trim('"') ?? "Linux";
        }
        catch (IOException) { return "Linux"; }
    }

    private static HashSet<string> ReadMounts()
    {
        var mounts = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in File.ReadLines("/proc/self/mountinfo"))
        {
            var parts = line.Split(' ');
            if (parts.Length < 5) continue;
            mounts.Add(parts[4].Replace("\\040", " "));
        }
        return mounts;
    }

    private static DiskSnapshot BuildDisk(string name, string path, HashSet<string> mounts)
    {
        path = Path.GetFullPath(path).TrimEnd('/');
        if (path.Length == 0) path = "/";
        bool mounted = mounts.Contains(path);
        // /backup is intentionally considered unavailable if a physical disk is not mounted:
        // this avoids making a missing backup disk look like usable backup storage.
        bool available = Directory.Exists(path) && (name != "Backup" || mounted);
        if (!available) return new DiskSnapshot(name, path, false, mounted, 0, 0);
        try
        {
            var matching = DriveInfo.GetDrives()
                .Where(d => path == d.RootDirectory.FullName.TrimEnd('/') ||
                    (d.RootDirectory.FullName == "/" ||
                     path.StartsWith(d.RootDirectory.FullName.TrimEnd('/') + "/", StringComparison.Ordinal)))
                .OrderByDescending(d => d.RootDirectory.FullName.Length)
                .FirstOrDefault();
            if (matching is null || !matching.IsReady)
                return new DiskSnapshot(name, path, false, mounted, 0, 0);
            return new DiskSnapshot(name, path, true, mounted,
                matching.TotalSize, matching.TotalSize - matching.AvailableFreeSpace);
        }
        catch (IOException) { return new DiskSnapshot(name, path, false, mounted, 0, 0); }
        catch (UnauthorizedAccessException) { return new DiskSnapshot(name, path, false, mounted, 0, 0); }
    }
}
