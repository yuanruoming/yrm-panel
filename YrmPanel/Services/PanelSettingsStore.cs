using System.Text.Json;
using YrmPanel.Models;

namespace YrmPanel.Services;

public sealed class PanelSettingsStore
{
    private readonly string _settingsPath;
    private readonly string _root;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public PanelSettingsStore(PanelDataPaths paths)
    {
        _root = paths.Root;
        _settingsPath = Path.Combine(_root, "settings.json");
    }

    public PanelSettings Read()
    {
        try
        {
            return File.Exists(_settingsPath)
                ? JsonSerializer.Deserialize<PanelSettings>(File.ReadAllText(_settingsPath)) ?? new PanelSettings()
                : new PanelSettings();
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            return new PanelSettings();
        }
    }

    public async Task AddShortcutAsync(string name, string url)
    {
        await _gate.WaitAsync();
        try
        {
            var settings = Read();
            if (settings.Shortcuts.Count >= 30) throw new InvalidOperationException("Maximum 30 shortcuts.");
            settings.Shortcuts.Add(new Shortcut(name.Trim(), url.Trim()));
            await SaveAsync(settings);
        }
        finally { _gate.Release(); }
    }

    private static readonly HashSet<string> BuiltInPins =
        new(["/Applications", "/Docker", "/Services", "/Files", "/Shares", "/Settings"], StringComparer.Ordinal);

    public async Task SetPinnedAsync(string id, bool pinned)
    {
        await _gate.WaitAsync();
        try
        {
            var settings = Read();
            var shortcutIndex = id.StartsWith("link:", StringComparison.Ordinal) &&
                int.TryParse(id[5..], out var index) ? index : -1;
            if (!BuiltInPins.Contains(id) && (shortcutIndex < 0 || shortcutIndex >= settings.Shortcuts.Count))
                throw new InvalidOperationException("This application cannot be pinned.");
            settings.PinnedApps.RemoveAll(x => x == id);
            if (pinned && settings.PinnedApps.Count < 16) settings.PinnedApps.Add(id);
            await SaveAsync(settings);
        }
        finally { _gate.Release(); }
    }

    public async Task RemoveShortcutAsync(int index)
    {
        await _gate.WaitAsync();
        try
        {
            var settings = Read();
            if (index < 0 || index >= settings.Shortcuts.Count) return;
            settings.Shortcuts.RemoveAt(index);
            await SaveAsync(settings);
        }
        finally { _gate.Release(); }
    }

    private async Task SaveAsync(PanelSettings settings)
    {
        var temp = _settingsPath + ".tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(settings,
            new JsonSerializerOptions { WriteIndented = true }));
        if (OperatingSystem.IsLinux()) File.SetUnixFileMode(temp,
            UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(temp, _settingsPath, true);
    }

    public (string path, string mime)? GetWallpaper()
    {
        foreach (var (extension, mime) in new[] {
            ("jpg", "image/jpeg"), ("png", "image/png"), ("webp", "image/webp") })
        {
            var path = Path.Combine(_root, $"wallpaper.{extension}");
            if (File.Exists(path)) return (path, mime);
        }
        return null;
    }

    public long WallpaperVersion => GetWallpaper() is { } image
        ? File.GetLastWriteTimeUtc(image.path).Ticks : 0;

    public async Task SetWallpaperAsync(Stream input, long size)
    {
        if (size <= 0 || size > 8 * 1024 * 1024)
            throw new InvalidOperationException("Wallpaper must be smaller than 8 MB.");
        using var content = new MemoryStream();
        await input.CopyToAsync(content);
        var bytes = content.ToArray();
        if (bytes.Length != size) throw new InvalidOperationException("Upload was incomplete.");
        string extension = bytes.Length >= 8 && bytes.Take(8).SequenceEqual(
            new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ? "png" :
            bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF ? "jpg" :
            bytes.Length >= 12 && System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" &&
                System.Text.Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP" ? "webp" : "";
        if (extension.Length == 0) throw new InvalidOperationException("Only JPEG, PNG and WebP images are supported.");
        await _gate.WaitAsync();
        try
        {
            var temp = Path.Combine(_root, "wallpaper.upload");
            await File.WriteAllBytesAsync(temp, bytes);
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(temp,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
            foreach (var ext in new[] { "jpg", "png", "webp" })
                File.Delete(Path.Combine(_root, $"wallpaper.{ext}"));
            File.Move(temp, Path.Combine(_root, $"wallpaper.{extension}"));
        }
        finally { _gate.Release(); }
    }

    public async Task ClearWallpaperAsync()
    {
        await _gate.WaitAsync();
        try
        {
            foreach (var ext in new[] { "jpg", "png", "webp" })
                File.Delete(Path.Combine(_root, $"wallpaper.{ext}"));
        }
        finally { _gate.Release(); }
    }
}
