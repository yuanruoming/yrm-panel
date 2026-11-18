using System.Text.Json;

namespace YrmPanel.Services;

/// <summary>
/// A presentation-only list of folders the owner explicitly chose to manage.
/// This store grants no Linux permissions and never creates or deletes files.
/// </summary>
public sealed class MyFoldersStore
{
    private readonly string _file;
    private readonly object _sync = new();

    public MyFoldersStore(PanelDataPaths paths)
    {
        Directory.CreateDirectory(paths.Root);
        _file = Path.Combine(paths.Root, "my-folders.json");
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

    private List<string> ReadUnsafe()
    {
        try
        {
            if (!File.Exists(_file)) return [];
            var data = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(_file)) ?? [];
            return data.Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.Ordinal).Take(256).ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return [];
        }
    }

    private void SaveUnsafe(List<string> folders)
    {
        var temp = _file + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(folders, new JsonSerializerOptions { WriteIndented = true }));
            if (OperatingSystem.IsLinux())
                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            File.Move(temp, _file, true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
