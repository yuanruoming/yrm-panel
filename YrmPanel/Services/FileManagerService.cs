using System.Runtime.InteropServices;

namespace YrmPanel.Services;

public sealed record FileItem(string Name, bool IsDirectory, long Size, DateTime ModifiedUtc);
public sealed record FileView(string Root, string Relative, bool Available, string? Error,
    IReadOnlyList<FileItem> Items, bool CanWrite = false, bool CanEnable = false);

/// <summary>Browse the real Linux filesystem as the chosen Linux user. Never act as root here.</summary>
public sealed class FileManagerService
{
    private static readonly HashSet<string> SystemFolders = new(StringComparer.Ordinal)
    { "bin", "boot", "dev", "etc", "lib", "lib64", "lost+found", "proc", "root", "run", "sbin", "snap", "sys", "usr" };

    [DllImport("libc", EntryPoint = "access", SetLastError = true)]
    private static extern int LinuxAccess([MarshalAs(UnmanagedType.LPUTF8Str)] string path, int mode);

    private static bool Writeable(string path) =>
        OperatingSystem.IsLinux() && Directory.Exists(path) && LinuxAccess(path, 3) == 0;

    public static string FormatSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes:N0} B";
        string[] units = ["KB", "MB", "GB", "TB", "PB"];
        double size = bytes;
        var unit = -1;
        do { size /= 1024d; unit++; } while (size >= 1024 && unit < units.Length - 1);
        return size.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " " + units[unit];
    }

    public string DisplayRoot(string root) => root == "system" ? "/" : "Unavailable";
    public static string Absolute(string? relative) => string.IsNullOrEmpty(relative) ? "/" : "/" + relative.Trim('/');
    public static string ParentOf(string? relative)
    {
        var parts = (relative ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries);
        return string.Join('/', parts.Take(Math.Max(0, parts.Length - 1)));
    }

    public FileView Browse(string root, string? relative, bool showHidden = false)
    {
        try
        {
            var directory = Resolve(root, relative, true);
            if (!Directory.Exists(directory)) throw new IOException("Folder not found.");
            var items = new List<FileItem>();
            foreach (var path in Directory.EnumerateFileSystemEntries(directory).Take(3000))
            {
                var entryName = Path.GetFileName(path);
                // ext4 filesystem housekeeping must not clutter ordinary NAS browsing.
                // Never delete or modify the actual lost+found directory.
                if (entryName == "lost+found" || (!showHidden && entryName.StartsWith('.'))) continue;
                try
                {
                    var attrs = File.GetAttributes(path);
                    if (attrs.HasFlag(FileAttributes.ReparsePoint)) continue;
                    bool folder = attrs.HasFlag(FileAttributes.Directory);
                    items.Add(new FileItem(Path.GetFileName(path), folder,
                        folder ? 0 : new FileInfo(path).Length, File.GetLastWriteTimeUtc(path)));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                { /* A single unreadable entry must not prevent directory navigation. */ }
            }
            return new FileView(root, relative ?? "", true, null,
                items.OrderByDescending(x => x.IsDirectory)
                    .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).Take(1000).ToArray(),
                Writeable(directory), CanEnable(directory));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return new FileView(root, relative ?? "", false, SafeError(ex), []);
        }
    }

    public bool IsManaged(string absolute)
    {
        var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(absolute));
        if ((path == "/backup" || path.StartsWith("/backup/", StringComparison.Ordinal)) && !BackupMounted()) return false;
        return Writeable(path);
    }

    public bool CanEnable(string absolute)
    {
        var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(absolute));
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 && !SystemFolders.Contains(parts[0]) &&
            !parts[0].StartsWith('.') && !Writeable(path) &&
            !(path.StartsWith("/backup", StringComparison.Ordinal) && !BackupMounted());
    }

    public void CreateFolder(string root, string? relative, string name)
    {
        _ = ResolveWritable(root, relative);
        ValidateName(name);
        var target = Resolve(root, Combine(relative, name));
        EnsureAbsent(target);
        Directory.CreateDirectory(target);
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
        else if (Directory.Exists(target)) SafeRecursiveDelete(target);
        else throw new IOException("Item not found.");
    }

    // Permanent folder deletion. Never cross a Linux mount, traverse a symbolic
    // link, delete the actual home/root, or operate on a stale unmounted volume.
    public void DeleteLibraryFolder(string absolutePath)
    {
        var normalized = MyFoldersStore.Normalize(absolutePath);
        var home = Path.TrimEndingDirectorySeparator(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        if (normalized is "/home" or "/mnt" or "/media" or "/tmp" or "/backup" ||
            normalized == home || normalized == "/volume2" || normalized == "/volume3")
            throw new UnauthorizedAccessException("Cannot delete a system or volume root directory.");
        var path = Resolve("system", normalized.TrimStart('/'), true);
        if (!Directory.Exists(path)) throw new IOException("Folder no longer exists.");
        var parent = Path.GetDirectoryName(path) ?? "/";
        if (!Writeable(parent)) throw new UnauthorizedAccessException("Linux user cannot delete items here.");
        if (path.StartsWith("/backup/", StringComparison.Ordinal) && !BackupMounted())
            throw new IOException("Backup volume is not mounted.");
        SafeRecursiveDelete(path);
    }

    private static void SafeRecursiveDelete(string target)
    {
        var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(target));
        if (path == "/" || path == "/home" || path == "/var" ||
            File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
            throw new UnauthorizedAccessException("Protected or symbolic-link folder cannot be deleted.");
        // mountinfo is authoritative even when mounts have been changed outside
        // YRM Panel. Refuse both mount roots and any nested mountpoints.
        foreach (var line in File.ReadLines("/proc/self/mountinfo"))
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 5) continue;
            var mount = parts[4].Replace("\\040", " ").Replace("\\011", "\t")
                .Replace("\\012", "\n").Replace("\\134", "\\");
            if (mount == path || mount.StartsWith(path + "/", StringComparison.Ordinal))
                throw new IOException("Folder is a mount point or contains another mounted filesystem.");
        }
        var count = 0;
        var stack = new Stack<string>();
        stack.Push(path);
        while (stack.Count > 0)
        {
            var item = stack.Pop();
            foreach (var child in Directory.EnumerateFileSystemEntries(item))
            {
                if (++count > 100000)
                    throw new IOException("Folder contains too many items for this operation.");
                var attrs = File.GetAttributes(child);
                if (attrs.HasFlag(FileAttributes.ReparsePoint))
                    throw new IOException("Folder contains symbolic links; remove them separately.");
                if (attrs.HasFlag(FileAttributes.Directory)) stack.Push(child);
            }
        }
        Directory.Delete(path, recursive: true);
    }

    public void Move(string root, string? relative, string name, string destinationRelative)
    {
        ValidateName(name);
        _ = ResolveWritable(root, relative);
        var source = Resolve(root, Combine(relative, name), true);
        var dest = ResolveWritable(root, destinationRelative);
        if (Directory.Exists(source) && (dest == source || dest.StartsWith(source + "/", StringComparison.Ordinal)))
            throw new IOException("Cannot move a folder into itself.");
        var target = Path.Combine(dest, name);
        EnsureAbsent(target);
        if (Directory.Exists(source)) Directory.Move(source, target);
        else if (File.Exists(source)) File.Move(source, target);
        else throw new IOException("Item not found.");
    }

    public bool Exists(string root, string? relative, string name)
    {
        ValidateName(name);
        _ = Resolve(root, relative, true);
        var target = Resolve(root, Combine(relative, name));
        return File.Exists(target) || Directory.Exists(target);
    }

    public async Task UploadAsync(string root, string? relative, IFormFile file,
        bool replace, CancellationToken ct)
    {
        if (file.Length <= 0 || file.Length > 4L * 1024 * 1024 * 1024)
            throw new IOException("Upload limit: 4 GiB per file.");
        ValidateName(file.FileName);
        var parent = ResolveWritable(root, relative);
        var target = Resolve(root, Combine(relative, file.FileName));
        if (Directory.Exists(target) || File.Exists(target) && !replace)
            throw new IOException("A file with that name already exists. Choose Replace or Skip.");
        if (File.Exists(target) && File.GetAttributes(target).HasFlag(FileAttributes.ReparsePoint))
            throw new UnauthorizedAccessException("Cannot overwrite a symbolic link.");
        var temp = Path.Combine(parent, ".yrm-upload-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write,
                FileShare.None, 1024 * 1024, FileOptions.Asynchronous))
            {
                await file.CopyToAsync(output, ct);
                await output.FlushAsync(ct);
            }
            if (Directory.Exists(target) || File.Exists(target) && !replace)
                throw new IOException("A file with that name already exists. Choose Replace or Skip.");
            if (File.Exists(target) && File.GetAttributes(target).HasFlag(FileAttributes.ReparsePoint))
                throw new UnauthorizedAccessException("Cannot overwrite a symbolic link.");
            File.Move(temp, target, replace);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    public (FileStream Stream, string Name) OpenDownload(string root, string? relative, string name)
    {
        ValidateName(name);
        _ = Resolve(root, relative, true);
        var full = Resolve(root, Combine(relative, name), true);
        if (!File.Exists(full)) throw new IOException("File not found.");
        return (new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read), name);
    }

    private string ResolveWritable(string root, string? relative)
    {
        var path = Resolve(root, relative, true);
        if (!Writeable(path)) throw new UnauthorizedAccessException("Linux user lacks write permission.");
        if ((path == "/backup" || path.StartsWith("/backup/", StringComparison.Ordinal)) && !BackupMounted())
            throw new UnauthorizedAccessException("Backup disk is not mounted.");
        return path;
    }

    private static string Combine(string? folder, string name) =>
        string.IsNullOrEmpty(folder) ? name : folder.Trim('/') + "/" + name;

    private static string Resolve(string root, string? relative, bool requireExisting = false)
    {
        if (!OperatingSystem.IsLinux()) throw new NotSupportedException("File management requires Linux.");
        if (root != "system") throw new ArgumentException("Invalid file root.");
        var rel = relative ?? "";
        if (rel.StartsWith('/') || rel.Contains('\\') || rel.Contains('\0') ||
            rel.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(x => x is "." or ".."))
            throw new ArgumentException("Invalid folder path.");
        var path = Path.GetFullPath(Path.Combine("/", rel));
        var step = "/";
        foreach (var part in rel.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            step = Path.Combine(step, part);
            try
            {
                if (File.GetAttributes(step).HasFlag(FileAttributes.ReparsePoint))
                    throw new UnauthorizedAccessException("Symbolic links cannot be opened.");
            }
            catch (FileNotFoundException) { if (requireExisting) throw new IOException("Folder not found."); }
            catch (DirectoryNotFoundException) { if (requireExisting) throw new IOException("Folder not found."); }
        }
        if (requireExisting && !Directory.Exists(path) && !File.Exists(path))
            throw new IOException("Path not found.");
        return path;
    }

    private static bool BackupMounted()
    {
        try
        {
            string? rootDevice = null, backupDevice = null;
            foreach (var line in File.ReadLines("/proc/self/mountinfo"))
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5) continue;
                if (parts[4] == "/") rootDevice = parts[2];
                if (parts[4] == "/backup") backupDevice = parts[2];
            }
            return rootDevice is not null && backupDevice is not null && rootDevice != backupDevice;
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
        if (File.Exists(path) || Directory.Exists(path))
            throw new IOException("Destination already exists.");
    }

    public static string SafeError(Exception ex) => ex is UnauthorizedAccessException
        ? "Access denied by Linux file permissions." : ex.Message;
}
