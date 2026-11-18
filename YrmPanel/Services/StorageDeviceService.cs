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
            mount = mounts.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString() ?? "").FirstOrDefault(x => x.Length > 0) ?? "";
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
    public Task<PrivilegedResult> UnmountAsync(string mountPath, string? password,
        CancellationToken ct) => _privileged.RunAsync("mount", "unmount", [mountPath], password, null, ct);
}
