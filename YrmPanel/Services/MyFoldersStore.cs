using System.Text.Json;

namespace YrmPanel.Services;

/// <summary>
/// A presentation-only list of folders the owner explicitly chose to manage.
/// This store grants no Linux permissions and never creates or deletes files.
/// </summary>
public sealed class MyFoldersStore
{
    private readonly string _file;
    private readonly string _pinsFile;
    private readonly object _sync = new();

    public MyFoldersStore(PanelDataPaths paths)
    {
        Directory.CreateDirectory(paths.Root);
        _file = Path.Combine(paths.Root, "my-folders.json");
        _pinsFile = Path.Combine(paths.Root, "quick-access.json");
    }

    public IReadOnlyList<string> List()
    {
        lock (_sync) return ReadUnsafe();
    }

    public void Add(string absolutePath)
    {
        var path = Normalize(absolutePath);
        lock (_sync)
        {
            var items = ReadUnsafe();
            if (!items.Contains(path, StringComparer.Ordinal))
            {
                items.Add(path);
                SaveUnsafe(items);
            }
        }
    }

    public void Remove(string absolutePath)
    {
        var path = Normalize(absolutePath);
        lock (_sync)
        {
            var items = ReadUnsafe();
            if (items.RemoveAll(value => string.Equals(value, path, StringComparison.Ordinal)) > 0)
                SaveUnsafe(items);
        }
    }

    // Quick Access contains bookmarks only; it never changes the Linux filesystem.
    public IReadOnlyList<string> ListPins()
    {
        lock (_sync) return ReadFileUnsafe(_pinsFile);
    }

    public void Pin(string absolutePath)
    {
        var path = Normalize(absolutePath);
        lock (_sync)
        {
            var items = ReadFileUnsafe(_pinsFile);
            if (!items.Contains(path, StringComparer.Ordinal))
            {
                items.Add(path);
                SaveFileUnsafe(_pinsFile, items);
            }
        }
    }

    public void Unpin(string absolutePath)
    {
        var path = Normalize(absolutePath);
        lock (_sync)
        {
            var items = ReadFileUnsafe(_pinsFile);
            if (items.RemoveAll(x => x == path) > 0) SaveFileUnsafe(_pinsFile, items);
        }
    }

    public void ForgetDeletedTree(string absolutePath)
    {
        var path = Normalize(absolutePath);
        lock (_sync)
        {
            foreach (var filename in new[] { _file, _pinsFile })
            {
                var items = ReadFileUnsafe(filename);
                if (items.RemoveAll(x => x == path || x.StartsWith(path + "/", StringComparison.Ordinal)) > 0)
                    SaveFileUnsafe(filename, items);
            }
        }
    }

    public static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path) ||
            path.Contains('\\') || path.Contains('\0') ||
            path.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(part => part is "." or ".."))
            throw new ArgumentException("Enter a normal absolute Linux folder path.");
        var normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (normalized == "/") throw new ArgumentException("The filesystem root cannot be added to My Folders.");
        var first = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        if (new HashSet<string>(StringComparer.Ordinal)
            { "bin", "boot", "dev", "etc", "lib", "lib64", "proc", "root", "run", "sbin", "sys", "usr", "var" }.Contains(first))
            throw new ArgumentException("System directories must be browsed under System Files instead.");
        return normalized;
    }

    private List<string> ReadUnsafe() => ReadFileUnsafe(_file);

    private List<string> ReadFileUnsafe(string filename)
    {
        try
        {
            if (!File.Exists(filename)) return [];
            var data = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(filename)) ?? [];
            return data.Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.Ordinal).Take(256).ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return [];
        }
    }

    private void SaveUnsafe(List<string> folders) => SaveFileUnsafe(_file, folders);

    private void SaveFileUnsafe(string filename, List<string> folders)
    {
        var temp = filename + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(folders, new JsonSerializerOptions { WriteIndented = true }));
            if (OperatingSystem.IsLinux())
                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            File.Move(temp, filename, true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
