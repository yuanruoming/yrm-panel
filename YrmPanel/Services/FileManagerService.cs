using Microsoft.AspNetCore.Http;

namespace YrmPanel.Services;

public sealed record FileItem(string Name, bool IsDirectory, long Size, DateTime ModifiedUtc);
public sealed record FileView(string Root, string Relative, bool Available, string? Error, IReadOnlyList<FileItem> Items);

/// <summary>
/// File access is confined to administrator-configured roots. Symlinks and mount-point
/// substitutions are rejected. Run under a dedicated, non-root system user.
/// </summary>
public sealed class FileManagerService
{
    private readonly Dictionary<string, string> _roots;
    public FileManagerService(IConfiguration configuration)
    {
        _roots = new(StringComparer.Ordinal)
        {
            ["data"] = Path.GetFullPath(configuration["Storage:MainPath"] ?? "/data"),
            ["backup"] = Path.GetFullPath(configuration["Storage:BackupPath"] ?? "/backup")
        };
    }

    public string DisplayRoot(string root) => _roots.GetValueOrDefault(root, "Unavailable");

    public FileView Browse(string root, string? relative)
    {
        try
        {
            var directory = Resolve(root, relative, requireExisting: true);
            if (!Directory.Exists(directory)) throw new IOException("This folder does not exist.");
            var items = Directory.EnumerateFileSystemEntries(directory)
                .Select(path =>
                {
                    var info = new FileInfo(path);
                    var attrs = File.GetAttributes(path);
                    return new FileItem(Path.GetFileName(path), attrs.HasFlag(FileAttributes.Directory),
                        attrs.HasFlag(FileAttributes.Directory) ? 0 : info.Length,
                        File.GetLastWriteTimeUtc(path));
                })
                .OrderByDescending(x => x.IsDirectory).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
                .Take(1000).ToArray();
            return new FileView(root, relative ?? "", true, null, items);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return new FileView(root, relative ?? "", false, SafeError(ex), []);
        }
    }

    public void CreateFolder(string root, string? relative, string name)
    {
        var parent = Resolve(root, relative, true);
        if (!Directory.Exists(parent)) throw new IOException("Destination folder is unavailable.");
        ValidateName(name);
        var dest = Resolve(root, Path.Combine(relative ?? "", name));
        EnsureAbsent(dest);
        Directory.CreateDirectory(dest);
    }

    public void Rename(string root, string? relative, string name, string newName)
    {
        ValidateName(name); ValidateName(newName);
        var source = Resolve(root, Path.Combine(relative ?? "", name), true);
        var target = Resolve(root, Path.Combine(relative ?? "", newName));
        EnsureAbsent(target);
        if (Directory.Exists(source)) Directory.Move(source, target);
        else if (File.Exists(source)) File.Move(source, target);
        else throw new IOException("The selected item no longer exists.");
    }

    public void Delete(string root, string? relative, string name)
    {
        ValidateName(name);
        var target = Resolve(root, Path.Combine(relative ?? "", name), true);
        if (File.Exists(target)) File.Delete(target);
        else if (Directory.Exists(target)) Directory.Delete(target, recursive: false);
        else throw new IOException("The selected item no longer exists.");
    }

    public void Move(string root, string? relative, string name, string destinationRelative)
    {
        ValidateName(name);
        var source = Resolve(root, Path.Combine(relative ?? "", name), true);
        var destDir = Resolve(root, destinationRelative, true);
        if (!Directory.Exists(destDir)) throw new IOException("The destination folder does not exist.");
        var target = Resolve(root, Path.Combine(destinationRelative, name));
        EnsureAbsent(target);
        if (Directory.Exists(source)) Directory.Move(source, target);
        else if (File.Exists(source)) File.Move(source, target);
        else throw new IOException("The selected item no longer exists.");
    }

    public async Task UploadAsync(string root, string? relative, IFormFile file, CancellationToken ct)
    {
        if (file.Length <= 0 || file.Length > 256L * 1024 * 1024)
            throw new IOException("Upload limit: 256 MiB per file.");
        ValidateName(file.FileName);
        var folder = Resolve(root, relative, true);
        if (!Directory.Exists(folder)) throw new IOException("Destination folder is unavailable.");
        var target = Resolve(root, Path.Combine(relative ?? "", file.FileName));
        EnsureAbsent(target);
        // Exclusive creation prevents accidentally replacing user files.
        await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write,
            FileShare.None, 1024 * 1024, FileOptions.Asynchronous);
        try
        {
            await file.CopyToAsync(output, ct);
        }
        catch
        {
            await output.DisposeAsync();
            File.Delete(target);
            throw;
        }
    }

    public (FileStream Stream, string Name) OpenDownload(string root, string? relative, string name)
    {
        ValidateName(name);
        var target = Resolve(root, Path.Combine(relative ?? "", name), true);
        if (!File.Exists(target)) throw new IOException("File not found.");
        return (new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read), name);
    }

    private string Resolve(string root, string? relative, bool requireExisting = false)
    {
        if (!OperatingSystem.IsLinux()) throw new NotSupportedException("File management is available on Linux only.");
        if (!_roots.TryGetValue(root, out var basePath)) throw new ArgumentException("Invalid storage volume.");
        if (!Path.IsPathFullyQualified(basePath)) throw new ArgumentException("Storage root must be absolute.");
        var normalizedBase = Path.TrimEndingDirectorySeparator(basePath);
        if (normalizedBase is "/" or "/home" or "/root" or "/etc" or "/var" or "/opt")
            throw new ArgumentException("System directories cannot be configured as file roots.");
        var rel = relative ?? "";
        if (Path.IsPathRooted(rel) || rel.Contains('\\') || rel.Contains('\0'))
            throw new ArgumentException("Invalid relative path.");
        if (rel.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(x => x is "." or ".."))
            throw new ArgumentException("Parent traversal is not allowed.");
        var full = Path.GetFullPath(Path.Combine(normalizedBase, rel));
        if (full != normalizedBase && !full.StartsWith(normalizedBase + "/", StringComparison.Ordinal))
            throw new ArgumentException("Path is outside the selected storage volume.");
        // Backup MUST be a mounted filesystem, not an empty directory on the system disk.
        if (root == "backup" && !IsMountPoint(normalizedBase))
            throw new IOException($"Backup disk is not mounted at {normalizedBase}.");
        // Check every existing component, including root itself. This deliberately forbids symlinks.
        var current = normalizedBase;
        CheckLink(current);
        if (full != normalizedBase)
        {
            foreach (var component in Path.GetRelativePath(normalizedBase, full).Split('/'))
            {
                current = Path.Combine(current, component);
                if (File.Exists(current) || Directory.Exists(current)) CheckLink(current);
            }
        }
        if (requireExisting && !File.Exists(full) && !Directory.Exists(full))
            throw new IOException("Path does not exist.");
        return full;
    }

    private static void CheckLink(string path)
    {
        if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
            throw new UnauthorizedAccessException("Symbolic links cannot be accessed in the file manager.");
    }

    private static bool IsMountPoint(string path)
    {
        try
        {
            return File.ReadLines("/proc/self/mountinfo").Any(line =>
            {
                var fields = line.Split(' ');
                return fields.Length > 4 && fields[4].Replace("\\040", " ", StringComparison.Ordinal) == path;
            });
        }
        catch (IOException) { return false; }
    }

    private static void ValidateName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 255 || name is "." or ".." ||
            name.Contains('/') || name.Contains('\\') || name.Contains('\0') || name.Any(char.IsControl))
            throw new ArgumentException("Invalid file or folder name.");
    }
    private static void EnsureAbsent(string path)
    {
        if (File.Exists(path) || Directory.Exists(path)) throw new IOException("A file or folder with this name already exists.");
    }
    public static string SafeError(Exception ex) => ex switch
    {
        UnauthorizedAccessException => "Permission denied. Grant the Panel service account access to this folder.",
        ArgumentException => ex.Message,
        NotSupportedException => ex.Message,
        _ => ex.Message
    };
}
