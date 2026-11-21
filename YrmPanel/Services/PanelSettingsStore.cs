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
            var dockerPin = id.StartsWith("docker:", StringComparison.Ordinal) && id.Length <= 71 &&
                System.Text.RegularExpressions.Regex.IsMatch(id[7..], @"^[A-Za-z0-9_.-]{1,64}$");
            if (!dockerPin && !BuiltInPins.Contains(id) && (shortcutIndex < 0 || shortcutIndex >= settings.Shortcuts.Count))
                throw new InvalidOperationException("This application cannot be pinned.");
            settings.PinnedApps.RemoveAll(x => x == id);
            if (pinned && settings.PinnedApps.Count < 16) settings.PinnedApps.Add(id);
            await SaveAsync(settings);
        }
        finally { _gate.Release(); }
    }

    public async Task UpdateShortcutAsync(int index, string name, string url)
    {
        await _gate.WaitAsync();
        try
        {
            var settings = Read();
            if (index < 0 || index >= settings.Shortcuts.Count)
                throw new InvalidOperationException("Application not found.");
            settings.Shortcuts[index] = new Shortcut(name.Trim(), url.Trim());
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
            // Legacy link pins use a list index. Keep the remaining links aligned.
            settings.PinnedApps = settings.PinnedApps.Select(id =>
            {
                if (!id.StartsWith("link:", StringComparison.Ordinal) || !int.TryParse(id[5..], out var old)) return id;
                if (old == index) return "";
                return old > index ? "link:" + (old - 1) : id;
            }).Where(id => id.Length > 0).ToList();
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

    // One locally stored avatar for the signed-in panel account. Never touch Linux login/SMB profiles.
    public (string Path, string Mime, long Version)? GetProfilePhoto()
    {
        foreach (var ext in new[] { "png", "jpg", "webp" })
        {
            var path = Path.Combine(_root, "profile-photo." + ext);
            if (!File.Exists(path)) continue;
            try
            {
                if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) return null;
                return (path, WallpaperMime("." + ext), File.GetLastWriteTimeUtc(path).Ticks);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }
        }
        return null;
    }

    public async Task SetProfilePhotoAsync(Stream upload, long size, CancellationToken ct)
    {
        const long maxSize = 2 * 1024 * 1024;
        if (size <= 0 || size > maxSize) throw new InvalidOperationException("Avatar must be an image up to 2 MB.");
        using var data = new MemoryStream();
        await upload.CopyToAsync(data, ct);
        var bytes = data.ToArray();
        if (bytes.LongLength != size) throw new InvalidOperationException("Incomplete image upload.");
        var png = bytes.Length > 24 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        var jpg = bytes.Length > 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[^2] == 0xFF && bytes[^1] == 0xD9;
        var webp = bytes.Length > 16 && System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" &&
            System.Text.Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP";
        var ext = png ? "png" : jpg ? "jpg" : webp ? "webp" : "";
        if (ext.Length == 0) throw new InvalidOperationException("Only genuine PNG, JPEG and WebP images are supported.");
        await _gate.WaitAsync(ct);
        var tmp = Path.Combine(_root, "profile-photo.upload-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(_root);
            await File.WriteAllBytesAsync(tmp, bytes, ct);
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(tmp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            // Publish the new file before removing alternate extensions. Failures preserve the old image.
            File.Move(tmp, Path.Combine(_root, "profile-photo." + ext), true);
            foreach (var other in new[] { "png", "jpg", "webp" })
                if (other != ext) File.Delete(Path.Combine(_root, "profile-photo." + other));
        }
        finally
        {
            if (File.Exists(tmp)) File.Delete(tmp);
            _gate.Release();
        }
    }

    public async Task ClearProfilePhotoAsync()
    {
        await _gate.WaitAsync();
        try
        {
            foreach (var ext in new[] { "png", "jpg", "webp" })
                File.Delete(Path.Combine(_root, "profile-photo." + ext));
        }
        finally { _gate.Release(); }
    }

    public sealed record WallpaperHistoryItem(string Id, string Mime, long SizeBytes, DateTime SavedUtc);

    private string WallpaperHistoryRoot => Path.Combine(_root, "wallpaper-history");

    private static string WallpaperMime(string extension) => extension.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" => "image/jpeg",
        ".webp" => "image/webp",
        _ => "application/octet-stream"
    };

    // Content hashes are needed to deduplicate history, but opening Appearance
    // should not re-hash up to ten 8 MB originals every single time.
    private readonly object _wallpaperDigestSync = new();
    private readonly Dictionary<string, (long Length, long LastWriteTicks, string Digest)> _wallpaperDigests =
        new(StringComparer.Ordinal);

    private string WallpaperDigest(string path)
    {
        var info = new FileInfo(path);
        var length = info.Length;
        var modified = info.LastWriteTimeUtc.Ticks;
        lock (_wallpaperDigestSync)
        {
            if (_wallpaperDigests.TryGetValue(path, out var existing) &&
                existing.Length == length && existing.LastWriteTicks == modified)
                return existing.Digest;
        }
        using var file = File.OpenRead(path);
        var digest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(file));
        lock (_wallpaperDigestSync)
        {
            // The archive is capped at ten images; never retain unbounded stale keys.
            if (_wallpaperDigests.Count > 32) _wallpaperDigests.Clear();
            _wallpaperDigests[path] = (length, modified, digest);
        }
        return digest;
    }

    private IEnumerable<string> StoredWallpaperHistory() =>
        Directory.Exists(WallpaperHistoryRoot)
            ? Directory.EnumerateFiles(WallpaperHistoryRoot)
                .Where(path => IsWallpaperHistoryId(Path.GetFileName(path)) &&
                    !File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
            : Enumerable.Empty<string>();

    // Deduplicate by bytes, not names (history filenames contain random GUIDs).
    // Always keep the newest occurrence and retain the existing 10-image limit.
    private void PruneWallpaperHistory()
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var path in StoredWallpaperHistory().OrderByDescending(File.GetLastWriteTimeUtc))
        {
            if (!seen.Add(WallpaperDigest(path))) File.Delete(path);
        }
        foreach (var old in StoredWallpaperHistory().OrderByDescending(File.GetLastWriteTimeUtc).Skip(10))
            File.Delete(old);
    }

    // Only archive files managed in the existing Panel data directory.
    // No new database, symlink traversal or arbitrary filesystem paths.
    public IReadOnlyList<WallpaperHistoryItem> ListWallpaperHistory()
    {
        try
        {
            if (!Directory.Exists(WallpaperHistoryRoot)) return [];
            return StoredWallpaperHistory()
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .GroupBy(WallpaperDigest, StringComparer.Ordinal)
                .Select(group => group.First())
                .Take(10)
                .Select(path => new FileInfo(path))
                .Select(file => new WallpaperHistoryItem(file.Name,
                    WallpaperMime(file.Extension), file.Length, file.LastWriteTimeUtc))
                .ToArray();
        }
        catch (IOException) { return []; }
        catch (UnauthorizedAccessException) { return []; }
    }

    private static bool IsWallpaperHistoryId(string? id) =>
        !string.IsNullOrEmpty(id) && System.Text.RegularExpressions.Regex.IsMatch(id,
            @"^[0-9]{17}-[a-f0-9]{32}\.(jpg|png|webp)$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    public (string Path, string Mime)? FindWallpaperHistoryImage(string? id)
    {
        if (!IsWallpaperHistoryId(id)) return null;
        var path = Path.Combine(WallpaperHistoryRoot, id!);
        return File.Exists(path) ? (path, WallpaperMime(Path.GetExtension(path))) : null;
    }

    private string? ArchiveCurrentWallpaper()
    {
        var current = GetWallpaper();
        if (current is null) return null;
        Directory.CreateDirectory(WallpaperHistoryRoot);
        var digest = WallpaperDigest(current.Value.path);
        var existing = StoredWallpaperHistory().FirstOrDefault(path => WallpaperDigest(path) == digest);
        if (existing is not null)
        {
            File.SetLastWriteTimeUtc(existing, DateTime.UtcNow);
            PruneWallpaperHistory();
            return existing;
        }
        var extension = Path.GetExtension(current.Value.path);
        var id = DateTime.UtcNow.ToString("yyyyMMddHHmmssfff",
            System.Globalization.CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N") + extension;
        var archive = Path.Combine(WallpaperHistoryRoot, id);
        File.Copy(current.Value.path, archive, overwrite: false);
        if (OperatingSystem.IsLinux()) File.SetUnixFileMode(archive,
            UnixFileMode.UserRead | UnixFileMode.UserWrite);
        PruneWallpaperHistory();
        return archive;
    }

    public async Task RestoreWallpaperHistoryAsync(string? id)
    {
        var image = FindWallpaperHistoryImage(id)
            ?? throw new InvalidOperationException("Wallpaper history item is unavailable.");
        var bytes = await File.ReadAllBytesAsync(image.Path);
        // Retain the selected historical image even if the archive reaches 10 items.
        File.SetLastWriteTimeUtc(image.Path, DateTime.UtcNow);
        using var stream = new MemoryStream(bytes);
        await SetWallpaperAsync(stream, bytes.Length);
    }

    public async Task DeleteWallpaperHistoryAsync(string? id)
    {
        if (!IsWallpaperHistoryId(id))
            throw new InvalidOperationException("Invalid wallpaper history item.");
        await _gate.WaitAsync();
        try
        {
            var image = FindWallpaperHistoryImage(id);
            if (image is not null) File.Delete(image.Value.Path);
        }
        finally { _gate.Release(); }
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
            // Applying an already active image is a no-op, not a new history entry.
            var current = GetWallpaper();
            if (current is not null && File.ReadAllBytes(current.Value.path).AsSpan().SequenceEqual(bytes))
                return;
            var temp = Path.Combine(_root, "wallpaper.upload");
            await File.WriteAllBytesAsync(temp, bytes);
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(temp,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
            var archived = ArchiveCurrentWallpaper();
            try
            {
                foreach (var ext in new[] { "jpg", "png", "webp" })
                    File.Delete(Path.Combine(_root, $"wallpaper.{ext}"));
                File.Move(temp, Path.Combine(_root, $"wallpaper.{extension}"));
            }
            catch
            {
                if (archived is not null && File.Exists(archived) && GetWallpaper() is null)
                    File.Copy(archived, Path.Combine(_root, "wallpaper" + Path.GetExtension(archived)));
                throw;
            }
        }
        finally { _gate.Release(); }
    }

    public async Task ClearWallpaperAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ArchiveCurrentWallpaper();
            foreach (var ext in new[] { "jpg", "png", "webp" })
                File.Delete(Path.Combine(_root, $"wallpaper.{ext}"));
        }
        finally { _gate.Release(); }
    }
}
