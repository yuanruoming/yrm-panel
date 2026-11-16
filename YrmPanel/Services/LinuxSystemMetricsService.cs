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
            var disks = BuildDisks(main, backup, mounts);
            return new SystemSnapshot(Environment.MachineName, ReadOsName(), false,
                cpu, memory.total == 0 ? 0 : 100.0 * memory.used / memory.total,
                memory.used, memory.total, down, up, ReadUptime(), disks, now);
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

    // Resolve paths to the filesystem that actually backs them. /data and / are
    // frequently the SAME filesystem; directory names are not disk identities.
    private sealed record MountInfo(string Point, string Device, string FileSystem);

    private static List<MountInfo> ReadMounts()
    {
        var mounts = new List<MountInfo>();
        foreach (var line in File.ReadLines("/proc/self/mountinfo"))
        {
            var parts = line.Split(" - ", 2, StringSplitOptions.None);
            if (parts.Length != 2) continue;
            var left = parts[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var right = parts[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (left.Length < 5 || right.Length < 1) continue;
            mounts.Add(new MountInfo(left[4].Replace("\\040", " "), left[2], right[0]));
        }
        return mounts;
    }

    private static MountInfo? BackingMount(string path, List<MountInfo> mounts) =>
        mounts.Where(m => path == m.Point || m.Point == "/" ||
                          path.StartsWith(m.Point.TrimEnd('/') + "/", StringComparison.Ordinal))
              .OrderByDescending(m => m.Point.Length).FirstOrDefault();

    private static IReadOnlyList<DiskSnapshot> BuildDisks(string main, string backup, List<MountInfo> mounts)
    {
        // Derive actual mounted filesystems, without inventing /data or /backup.
        // Deduplicate bind mounts using the kernel's major:minor filesystem identity.
        var allowedTypes = new HashSet<string>(StringComparer.Ordinal)
            { "ext4", "ext3", "xfs", "btrfs", "zfs", "ntfs3", "exfat", "f2fs" };
        var candidates = mounts.Where(m => m.Point == "/" || allowedTypes.Contains(m.FileSystem))
            .Where(m => !m.Point.StartsWith("/var/lib/docker", StringComparison.Ordinal) &&
                        !m.Point.StartsWith("/var/lib/containerd", StringComparison.Ordinal) &&
                        !m.Point.StartsWith("/run/", StringComparison.Ordinal))
            .OrderBy(m => m.Point == "/" ? 0 : 1)
            .ThenBy(m => m.Point.Length).ToArray();
        var output = new List<DiskSnapshot>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var mount in candidates)
        {
            if (!seen.Add(mount.Device)) continue;
            try
            {
                var drive = new DriveInfo(mount.Point);
                if (!drive.IsReady || drive.TotalSize <= 0) continue;
                var label = mount.Point == "/" ? "Disk 1 · System" : $"Disk {output.Count + 1} · Storage";
                output.Add(new DiskSnapshot(label, mount.Point, true, true,
                    drive.TotalSize, drive.TotalSize - drive.AvailableFreeSpace));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
            { /* Ignore inaccessible or disconnected filesystems. */ }
        }
        return output;
    }

}
