using System.Diagnostics;
using System.Text.Json;

namespace YrmPanel.Services;

public sealed record StorageDevice(string Path, string Name, string Type, string FileSystem,
    string Uuid, string Label, string Size, string MountPoint, bool ReadOnly, bool Removable,
    bool CanMount, bool ManagedMount, string ParentPath = "");

/// <summary>Read-only lsblk discovery. Mount mutations are delegated to the fixed root helper.</summary>
public sealed class StorageDeviceService
{
    private readonly PrivilegedCommandService _privileged;
    private readonly ILogger<StorageDeviceService> _logger;
    public StorageDeviceService(PrivilegedCommandService privileged, ILogger<StorageDeviceService> logger)
    { _privileged = privileged; _logger = logger; }

    public async Task<IReadOnlyList<StorageDevice>> ListAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux()) return [];
        var start = new ProcessStartInfo("/usr/bin/lsblk")
        { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-J", "-p", "-o", "NAME,TYPE,FSTYPE,UUID,LABEL,SIZE,MOUNTPOINTS,RO,RM" })
            start.ArgumentList.Add(a);
        try
        {
            using var process = Process.Start(start);
            if (process is null) return [];
            var stdout = process.StandardOutput.ReadToEndAsync(ct);
            var stderr = process.StandardError.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            _ = await stderr;
            if (process.ExitCode != 0) return [];
            using var json = JsonDocument.Parse(await stdout);
            var all = new List<StorageDevice>();
            foreach (var item in json.RootElement.GetProperty("blockdevices").EnumerateArray()) Collect(item, all);
            HashSet<string> managed = new(StringComparer.Ordinal);
            try
            {
                foreach (var line in File.ReadLines("/etc/fstab"))
                {
                    if (!line.Contains("# yrm-panel-managed:", StringComparison.Ordinal)) continue;
                    var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2) managed.Add(parts[1]);
                }
                var manualPath = "/etc/yrm-panel/manual-mounts.json";
                if (File.Exists(manualPath))
                {
                    var manual = JsonSerializer.Deserialize<string[]>(File.ReadAllText(manualPath)) ?? [];
                    foreach (var point in manual) managed.Add(point);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { }
            // Root mounts can be reported as /var/tmp first on systems that
            // bind the root device at several locations. findmnt reflects the
            // actual system root and avoids hiding Disk 1 from Storage Spaces.
            if (!all.Any(d => d.MountPoint == "/"))
            {
                try
                {
                    var rootStart = new ProcessStartInfo("/usr/bin/findmnt")
                    { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
                    foreach (var arg in new[] { "-n", "-o", "SOURCE", "--target", "/" })
                        rootStart.ArgumentList.Add(arg);
                    using var findRoot = Process.Start(rootStart);
                    if (findRoot is not null)
                    {
                        var sourceTask = findRoot.StandardOutput.ReadToEndAsync(ct);
                        var errorTask = findRoot.StandardError.ReadToEndAsync(ct);
                        await findRoot.WaitForExitAsync(ct);
                        _ = await errorTask;
                        if (findRoot.ExitCode == 0)
                        {
                            var sourceText = (await sourceTask).Trim();
                            var bracket = sourceText.IndexOf('[');
                            var source = bracket >= 0 ? sourceText[..bracket] : sourceText;
                            all = all.Select(d => d.Path == source
                                ? d with { MountPoint = "/" } : d).ToList();
                        }
                    }
                }
                catch (Exception ex) when (ex is IOException or InvalidOperationException or
                    System.ComponentModel.Win32Exception or OperationCanceledException)
                { _logger.LogDebug(ex, "Unable to find Linux root mount"); }
            }
            return all.Select(d => d with { ManagedMount = managed.Contains(d.MountPoint) }).ToArray();
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or JsonException
            or System.ComponentModel.Win32Exception or OperationCanceledException)
        { _logger.LogWarning(ex, "Unable to inspect block devices"); return []; }
    }

    private static string Field(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value) || value.ValueKind == JsonValueKind.Null) return "";
        return value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ToString();
    }
    private static bool Flag(JsonElement element, string property) => Field(element, property) is "1" or "true" or "True";
    private static void Collect(JsonElement item, List<StorageDevice> devices, string parentPath = "")
    {
        var type = Field(item, "type");
        var mount = "";
        if (item.TryGetProperty("mountpoints", out var mounts) && mounts.ValueKind == JsonValueKind.Array)
        {
            var points = mounts.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToArray();
            // lsblk may list /var/tmp before /. The system volume must be
            // classified by its root mount, not by an arbitrary first entry.
            mount = points.Contains("/", StringComparer.Ordinal) ? "/" :
                points.FirstOrDefault(x => !x.StartsWith("/var/", StringComparison.Ordinal)) ??
                points.FirstOrDefault() ?? "";
        }
        var fs = Field(item, "fstype");
        var uuid = Field(item, "uuid");
        var allowed = new[] { "ext4", "xfs", "btrfs", "vfat", "exfat", "ntfs" };
        var canMount = (type is "part" or "disk") && uuid.Length > 0 &&
                       allowed.Contains(fs, StringComparer.OrdinalIgnoreCase) && !Flag(item, "ro");
        devices.Add(new StorageDevice(Field(item, "name"), Field(item, "name").Split('/').Last(),
            type, fs, uuid, Field(item, "label"), Field(item, "size"), mount,
            Flag(item, "ro"), Flag(item, "rm"), canMount, false, parentPath));
        if (item.TryGetProperty("children", out var children) && children.ValueKind == JsonValueKind.Array)
            foreach (var child in children.EnumerateArray()) Collect(child, devices, Field(item, "name"));
    }

    public Task<PrivilegedResult> MountAsync(string uuid, string mountPath, bool automatic,
        string? password, CancellationToken ct) =>
        _privileged.RunAsync("mount", "mount", [uuid, mountPath, automatic ? "auto" : "manual"], password, null, ct);
    public Task<PrivilegedResult> UnmountAsync(string mountPath, string uuid, string? password,
        CancellationToken ct) => _privileged.RunAsync("mount", "unmount", [mountPath, uuid], password, null, ct);

    public Task<PrivilegedResult> CompleteAsync(string partitionPath, string confirmation,
        string? password, CancellationToken ct)
    {
        if (confirmation != "FORMAT " + partitionPath)
            return Task.FromResult(new PrivilegedResult(false, "Type FORMAT and the exact partition path to confirm."));
        return _privileged.RunAsync("mount", "complete", [partitionPath, confirmation], password, null, ct);
    }

    public Task<PrivilegedResult> InitializeAsync(string diskPath, string confirmation,
        string? password, CancellationToken ct)
    {
        if (confirmation != "ERASE " + diskPath)
            return Task.FromResult(new PrivilegedResult(false, "Type ERASE and the exact device path to confirm."));
        return _privileged.RunAsync("mount", "initialize", [diskPath, confirmation], password, null, ct);
    }
}
