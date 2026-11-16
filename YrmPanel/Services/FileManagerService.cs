using System.Text.Json;

namespace YrmPanel.Services;

public sealed record FileItem(string Name, bool IsDirectory, long Size, DateTime ModifiedUtc);
public sealed record FileView(string Root, string Relative, bool Available, string? Error,
    IReadOnlyList<FileItem> Items, bool CanWrite = false, bool CanEnable = false);

/// <summary>
/// Read-only Linux filesystem navigation begins at /. File mutations are permitted
/// only inside explicitly registered data roots. Privileged root creation and scoped
/// ACL grants are performed by the separate storage helper, never here.
/// </summary>
public sealed class FileManagerService
{
    private const string Registry = "/etc/yrm-panel/managed-roots.json";
    private static readonly HashSet<string> SystemFolders = new(StringComparer.Ordinal)
    { "bin", "boot", "dev", "etc", "home", "lib", "lib64", "lost+found", "media", "mnt",
      "opt", "proc", "root", "run", "sbin", "snap", "srv", "sys", "tmp", "usr", "var" };

    public string DisplayRoot(string root) => root == "system" ? "/" : "Unavailable";
    public static string Absolute(string? relative) => string.IsNullOrEmpty(relative) ? "/" : "/" + relative.Trim('/');
    public static string ParentOf(string? relative)
    {
        var parts = (relative ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries);
        return string.Join('/', parts.Take(Math.Max(0, parts.Length - 1)));
    }

    public FileView Browse(string root, string? relative)
    {
        try
        {
            var directory = Resolve(root, relative, requireExisting: true);
            if (!Directory.Exists(directory)) throw new IOException("Folder not found.");
            var managed = IsManaged(directory);
            // Outside the managed roots, disclose only folder names, not file contents.
            var items = new List<FileItem>();
            foreach (var path in Directory.EnumerateFileSystemEntries(directory).Take(3000))
            {
                try
                {
                    var attributes = File.GetAttributes(path);
                    if (attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                    var folder = attributes.HasFlag(FileAttributes.Directory);
                    if (!folder && !managed) continue;
                    items.Add(new FileItem(Path.GetFileName(path), folder,
                        folder ? 0 : new FileInfo(path).Length, File.GetLastWriteTimeUtc(path)));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* Individual inaccessible entry. */ }
            }
            var ordered = items.OrderByDescending(x => x.IsDirectory)
                .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).Take(1000).ToArray();
            return new FileView(root, relative ?? "", true, null, ordered,
                managed, CanEnable(directory));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return new FileView(root, relative ?? "", false, SafeError(ex), []);
        }
    }

    public IReadOnlyList<string> ManagedRoots()
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(File.ReadAllText(Registry))?.Where(x => x.StartsWith("/", StringComparison.Ordinal)).Distinct(StringComparer.Ordinal).ToArray() ?? [];
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return []; }
    }

    public bool IsManaged(string absolute)
    {
        var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(absolute));
        var isManaged = ManagedRoots().Any(root => path == root || path.StartsWith(root + "/", StringComparison.Ordinal));
        if (!isManaged) return false;
        if ((path == "/backup" || path.StartsWith("/backup/", StringComparison.Ordinal)) && !BackupMounted())
            return false;
        return true;
    }

    public bool CanEnable(string absolute)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(absolute));
        var components = full.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (components.Length == 0 || SystemFolders.Contains(components[0]) || components[0].StartsWith('.')) return false;
        if ((full == "/backup" || full.StartsWith("/backup/", StringComparison.Ordinal)) && !BackupMounted()) return false;
        return components.Length == 1 || ManagedRoots().Contains("/" + components[0]);
    }

    public void CreateFolder(string root, string? relative, string name)
    {
        var parent = ResolveWritable(root, relative);
        ValidateName(name);
        var destination = Resolve(root, Combine(relative, name));
        EnsureAbsent(destination);
        Directory.CreateDirectory(destination);
    }

    public void Rename(string root, string? relative, string name, string newName)
    {
        ValidateName(name); ValidateName(newName);
        _ = ResolveWritable(root, relative);
        var source = Resolve(root, Combine(relative, name), true);
        var target = Resolve(root, Combine(relative, newName));
        EnsureAbsent(target);
        if (Directory.Exists(source)) Directory.Move(source, target);
        else if (File.Exists(source)) File.Move(source, target);
        else throw new IOException("Item not found.");
    }

    public void Delete(string root, string? relative, string name)
    {
        ValidateName(name);
        _ = ResolveWritable(root, relative);
        var target = Resolve(root, Combine(relative, name), true);
        if (File.Exists(target)) File.Delete(target);
        else if (Directory.Exists(target)) Directory.Delete(target, recursive: false);
        else throw new IOException("Item not found.");
    }

    public void Move(string root, string? relative, string name, string destinationRelative)
    {
        ValidateName(name);
        _ = ResolveWritable(root, relative);
        var source = Resolve(root, Combine(relative, name), true);
        var folder = ResolveWritable(root, destinationRelative);
        if (!Directory.Exists(folder)) throw new IOException("Destination folder is missing.");
        var target = Resolve(root, Combine(destinationRelative, name));
        if (Directory.Exists(source) && folder.StartsWith(source + "/", StringComparison.Ordinal))
            throw new IOException("A folder cannot be moved into itself.");
        EnsureAbsent(target);
        if (Directory.Exists(source)) Directory.Move(source, target);
        else if (File.Exists(source)) File.Move(source, target);
        else throw new IOException("Item not found.");
    }

    public async Task UploadAsync(string root, string? relative, IFormFile file, CancellationToken ct)
    {
        if (file.Length <= 0 || file.Length > 256L * 1024 * 1024)
            throw new IOException("Upload limit: 256 MiB per file.");
        ValidateName(file.FileName);
        _ = ResolveWritable(root, relative);
        var target = Resolve(root, Combine(relative, file.FileName));
        EnsureAbsent(target);
        await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None,
            1024 * 1024, FileOptions.Asynchronous);
        try { await file.CopyToAsync(output, ct); }
        catch { await output.DisposeAsync(); File.Delete(target); throw; }
    }

    public (FileStream Stream, string Name) OpenDownload(string root, string? relative, string name)
    {
        ValidateName(name);
        _ = ResolveWritable(root, relative);
        var path = Resolve(root, Combine(relative, name), true);
        if (!File.Exists(path)) throw new IOException("File not found.");
        return (new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read), name);
    }

    private string ResolveWritable(string root, string? relative)
    {
        var full = Resolve(root, relative, true);
        if (!IsManaged(full)) throw new UnauthorizedAccessException("Select 'Enable management' on this folder first.");
        return full;
    }

    private static string Combine(string? folder, string name) =>
        string.IsNullOrEmpty(folder) ? name : folder.Trim('/') + "/" + name;

    private string Resolve(string root, string? relative, bool requireExisting = false)
    {
        if (!OperatingSystem.IsLinux()) throw new NotSupportedException("File management requires Linux.");
        if (root != "system") throw new ArgumentException("Invalid file root.");
        var rel = relative ?? "";
        if (rel.StartsWith('/') || rel.Contains('\\') || rel.Contains('\0') ||
            rel.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(x => x is "." or ".."))
            throw new ArgumentException("Invalid folder path.");
        var full = Path.GetFullPath(Path.Combine("/", rel));
        if (full != "/" && !full.StartsWith("/", StringComparison.Ordinal)) throw new ArgumentException("Invalid path.");
        var current = "/";
        foreach (var part in rel.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            try
            {
                if (File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint))
                    throw new UnauthorizedAccessException("Symbolic links cannot be opened.");
            }
            catch (FileNotFoundException) { if (requireExisting) throw new IOException("Folder not found."); }
            catch (DirectoryNotFoundException) { if (requireExisting) throw new IOException("Folder not found."); }
        }
        if (requireExisting && !File.Exists(full) && !Directory.Exists(full)) throw new IOException("Path not found.");
        return full;
    }

    private static bool BackupMounted()
    {
        try
        {
            string? rootDevice = null, backupDevice = null;
            foreach (var line in File.ReadLines("/proc/self/mountinfo"))
            {
                var words = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (words.Length < 5) continue;
                if (words[4] == "/") rootDevice = words[2];
                if (words[4] == "/backup") backupDevice = words[2];
            }
            return backupDevice != null && rootDevice != null && backupDevice != rootDevice;
        }
        catch (IOException) { return false; }
    }
    private static void ValidateName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 255 || name is "." or ".." ||
            name.Contains('/') || name.Contains('\\') || name.Contains('\0') || name.Any(char.IsControl))
            throw new ArgumentException("Invalid item name.");
    }
    private static void EnsureAbsent(string path)
    {
        if (File.Exists(path) || Directory.Exists(path)) throw new IOException("The destination already exists.");
    }
    public static string SafeError(Exception ex) => ex switch
    {
        UnauthorizedAccessException => "Access denied. Select a managed folder or grant access to it.",
        _ => ex.Message
    };
}
