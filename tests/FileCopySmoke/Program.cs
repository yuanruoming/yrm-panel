using YrmPanel.Services;

// Live filesystem smoke: only touches one random directory under the OS temp
// folder, never /volume*, /etc, /home data, or any existing mounted disk.
if (!OperatingSystem.IsLinux())
{
    Console.WriteLine("SKIP: Linux filesystem smoke only.");
    return;
}

var fixture = Path.Combine(Path.GetTempPath(), "yrm-file-copy-smoke-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(fixture);
try
{
    var fileManager = new FileManagerService();
    var input = Path.Combine(fixture, "input");
    var output = Path.Combine(fixture, "output");
    Directory.CreateDirectory(input);
    Directory.CreateDirectory(output);
    await File.WriteAllTextAsync(Path.Combine(input, "hello.txt"), "source remains unchanged");
    static string Rel(string path) => path.TrimStart('/');
    await fileManager.CopyAsync("system", Rel(input), "hello.txt", Rel(output), CancellationToken.None);
    Expect(File.ReadAllText(Path.Combine(output, "hello.txt")) == "source remains unchanged", "file copy contents");
    Expect(File.Exists(Path.Combine(input, "hello.txt")), "source remains after copy");
    await MustFail(() => fileManager.CopyAsync("system", Rel(input), "hello.txt", Rel(output), CancellationToken.None),
        "existing destination must not be overwritten");

    var nested = Path.Combine(input, "tree");
    Directory.CreateDirectory(Path.Combine(nested, "sub"));
    await File.WriteAllTextAsync(Path.Combine(nested, "sub", "data.txt"), "nested content");
    await fileManager.CopyAsync("system", Rel(input), "tree", Rel(output), CancellationToken.None);
    Expect(File.ReadAllText(Path.Combine(output, "tree", "sub", "data.txt")) == "nested content", "recursive directory copy");
    Expect(Directory.Exists(nested), "source directory remains after copy");

    await MustFail(() => fileManager.CopyAsync("system", Rel(input), "tree", Rel(nested), CancellationToken.None),
        "copy into itself must be refused");
    await MustFail(() => fileManager.CopyAsync("system", Rel(input), "tree", Rel(input), CancellationToken.None),
        "copy onto itself must be refused");

    var links = Path.Combine(input, "links");
    Directory.CreateDirectory(links);
    File.CreateSymbolicLink(Path.Combine(links, "outside"), Path.Combine(input, "hello.txt"));
    await MustFail(() => fileManager.CopyAsync("system", Rel(input), "links", Rel(output), CancellationToken.None),
        "symbolic links are not followed");
    Expect(!Directory.Exists(Path.Combine(output, "links")), "incomplete directory is never published");

    Console.WriteLine("PASS: File Copy (contents, directory, collision, recursive guard, symlink, rollback)");

    // Wallpaper history uses actual valid 1x1 PNGs. The restore loop checks that
    // applying the same historical image does not create duplicate files/records.
    var wallpaperRoot = Path.Combine(fixture, "wallpaper-data");
    Directory.CreateDirectory(wallpaperRoot);
    var wallpapers = new PanelSettingsStore(new PanelDataPaths(wallpaperRoot));
    var red = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4LycHAANbATzfaMhOAAAAAElFTkSuQmCC");
    var blue = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQk/sPAAGZATwBmEnjAAAAAElFTkSuQmCC");
    await wallpapers.SetWallpaperAsync(new MemoryStream(red), red.Length);
    Expect(wallpapers.ListWallpaperHistory().Count == 0, "first wallpaper does not create history");
    await wallpapers.SetWallpaperAsync(new MemoryStream(blue), blue.Length);
    var history = wallpapers.ListWallpaperHistory();
    Expect(history.Count == 1, "replaced wallpaper archived exactly once");
    var redId = history.Single().Id;
    await wallpapers.RestoreWallpaperHistoryAsync(redId);
    Expect(wallpapers.ListWallpaperHistory().Count == 2, "other wallpaper archived on restore");
    Expect(File.ReadAllBytes(wallpapers.GetWallpaper()!.Value.path).SequenceEqual(red), "restore sets selected image");
    var blueId = wallpapers.ListWallpaperHistory().Single(h => h.Id != redId).Id;
    for (var attempt = 0; attempt < 5; attempt++)
    {
        await wallpapers.RestoreWallpaperHistoryAsync(blueId);
        await wallpapers.RestoreWallpaperHistoryAsync(redId);
        Expect(wallpapers.ListWallpaperHistory().Count == 2, "restore history does not duplicate images");
    }
    await wallpapers.SetWallpaperAsync(new MemoryStream(red), red.Length);
    Expect(wallpapers.ListWallpaperHistory().Count == 2, "applying active wallpaper is a no-op");
    Console.WriteLine("PASS: Wallpaper History (archive, restore, content deduplication)");

    // The profile avatar is local to YRMPanel, never touches Linux account data.
    await wallpapers.SetProfilePhotoAsync(new MemoryStream(red), red.Length, CancellationToken.None);
    var avatar = wallpapers.GetProfilePhoto();
    Expect(avatar is not null && avatar.Value.Mime == "image/png", "valid avatar stored");
    Expect(File.ReadAllBytes(avatar!.Value.Path).SequenceEqual(red), "avatar bytes match upload");
    try
    {
        var notImage = new byte[] { 0, 1, 2, 3, 4, 5, 6, 7 };
        await wallpapers.SetProfilePhotoAsync(new MemoryStream(notImage), notImage.Length, CancellationToken.None);
        throw new Exception("FAIL: invalid avatar was accepted");
    }
    catch (InvalidOperationException) { /* rejected as expected */ }
    Expect(wallpapers.GetProfilePhoto() is not null, "invalid avatar never overwrites existing image");
    await wallpapers.ClearProfilePhotoAsync();
    Expect(wallpapers.GetProfilePhoto() is null, "restore default avatar clears local file");
    Console.WriteLine("PASS: Profile Photo (valid upload, invalid upload, restore default)");

    // Real ZIP creation from independent My Files roots, preserving folder structure.
    var zipOne = Path.Combine(fixture, "zip-one");
    var zipTwo = Path.Combine(fixture, "zip-two");
    Directory.CreateDirectory(zipOne);
    Directory.CreateDirectory(zipTwo);
    await File.WriteAllTextAsync(Path.Combine(zipOne, "hello.txt"), "one");
    await File.WriteAllTextAsync(Path.Combine(zipTwo, "hello.txt"), "two");
    await using var archiveBytes = new MemoryStream();
    await fileManager.WriteDownloadZipFromPathsAsync(new[] { zipOne, zipTwo }, archiveBytes, CancellationToken.None);
    archiveBytes.Position = 0;
    using (var archive = new System.IO.Compression.ZipArchive(archiveBytes,
        System.IO.Compression.ZipArchiveMode.Read, leaveOpen: true))
    {
        Expect(archive.Entries.Any(entry => entry.FullName == "zip-one/hello.txt"),
            "first selected folder included in ZIP");
        Expect(archive.Entries.Any(entry => entry.FullName == "zip-two/hello.txt"),
            "second selected folder included in ZIP");
    }
    Console.WriteLine("PASS: Files My Files root ZIP (multiple parents, preserved folders)");

    // A folder larger than the old 3000-entry raw cut-off must still list the
    // alphabetically first items (folders first), never an arbitrary subset.
    var big = Path.Combine(fixture, "big-folder");
    Directory.CreateDirectory(Path.Combine(big, "zdir"));
    for (var i = 0; i < 3500; i++)
        await File.WriteAllTextAsync(Path.Combine(big, $"f{i:D4}.txt"), "x");
    var bigView = fileManager.Browse("system", big.TrimStart('/'));
    Expect(bigView.Available, "large folder browse is available");
    Expect(bigView.Items.Count == 1000, "large folder returns the 1000-row window");
    Expect(bigView.Items[0].Name == "zdir" && bigView.Items[0].IsDirectory, "folders sort before files in a large folder");
    Expect(bigView.Items[1].Name == "f0000.txt" && bigView.Items[^1].Name == "f0998.txt",
        "large folder lists the alphabetically first files");
    Console.WriteLine("PASS: Files large-folder listing is sorted before truncation");
}
finally
{
    // This path is freshly generated by this test, not obtained from user input.
    if (Directory.Exists(fixture)) Directory.Delete(fixture, recursive: true);
}

static void Expect(bool condition, string reason)
{
    if (!condition) throw new Exception("FAIL: " + reason);
}
static async Task MustFail(Func<Task> action, string reason)
{
    try { await action(); }
    catch (IOException) { return; }
    catch (UnauthorizedAccessException) { return; }
    throw new Exception("FAIL: " + reason);
}
