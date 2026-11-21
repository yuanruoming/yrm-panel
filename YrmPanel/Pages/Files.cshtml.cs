using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Diagnostics;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class FilesModel : PageModel
{
    private const string FolderHome = "@folders";
    private readonly FileManagerService _files;
    private readonly StorageManagementService _storage;
    private readonly SambaManagementService _samba;
    private readonly MyFoldersStore _folders;
    private readonly StorageDeviceService _devices;
    private readonly FilesNavigationSnapshot _navigation;

    public FilesModel(FileManagerService files, StorageManagementService storage,
        SambaManagementService samba, MyFoldersStore folders, StorageDeviceService devices,
        FilesNavigationSnapshot navigation)
    {
        _files = files;
        _storage = storage;
        _samba = samba;
        _folders = folders;
        _devices = devices;
        _navigation = navigation;
    }

    [BindProperty(SupportsGet = true)] public string Path { get; set; } = "";
    [BindProperty(SupportsGet = true)] public bool Hidden { get; set; }
    public bool IsMyFolders => Path == FolderHome;
    private string CurrentRelative => Path == "/" ? "" : Path;
    public FileView View { get; private set; } = new("system", "", false, "Not loaded", []);
    public IReadOnlyList<string> MyFiles { get; private set; } = [];
    public IReadOnlyList<string> QuickAccess { get; private set; } = [];
    public IReadOnlyList<StorageDevice> MountedVolumes { get; private set; } = [];
    public IReadOnlyList<StorageDevice> PhysicalDisks { get; private set; } = [];
    public string FormatSize(long size) => FileManagerService.FormatSize(size);
    public string StorageLabel(StorageDevice volume)
    {
        var index = MountedVolumes.ToList().FindIndex(item => item.MountPoint == volume.MountPoint);
        return index >= 0 ? $"Volume {index + 2}" :
            (!string.IsNullOrWhiteSpace(volume.Label) ? volume.Label : volume.Name);
    }
    public SambaOverview Samba { get; private set; } = new(false, "Samba unavailable", "", false, []);
    [TempData] public string? Notice { get; set; }
    public sealed record FileBreadcrumb(string Label, string Route);
    public IReadOnlyList<FileBreadcrumb> Breadcrumbs
    {
        get
        {
            var list = new List<FileBreadcrumb>();
            if (IsMyFolders) { list.Add(new("My Files", FolderHome)); return list; }
            var absolute = Absolute;
            var myRoot = MyFiles.Where(x => absolute == x || absolute.StartsWith(x + "/", StringComparison.Ordinal))
                .OrderByDescending(x => x.Length).FirstOrDefault();
            string relative;
            string current;
            if (myRoot is not null)
            {
                list.Add(new("My Files", FolderHome));
                current = myRoot.TrimStart('/');
                list.Add(new(System.IO.Path.GetFileName(myRoot), current));
                relative = absolute == myRoot ? "" : absolute[(myRoot.Length + 1)..];
            }
            else
            {
                list.Add(new("System Files", "/"));
                current = "";
                relative = Path.Trim('/');
            }
            foreach (var part in relative.Split('/', StringSplitOptions.RemoveEmptyEntries))
            {
                current = string.IsNullOrEmpty(current) ? part : current + "/" + part;
                list.Add(new(part, current));
            }
            return list;
        }
    }

    public string Parent => string.IsNullOrEmpty(Path) ? FolderHome : FileManagerService.ParentOf(Path);
    public string Absolute => IsMyFolders ? "" : FileManagerService.Absolute(Path);
    public string HomePath => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimStart('/');
    public string DefaultCreateParent => IsMyFolders ? HomePath : Path;

    public async Task OnGetAsync()
    {
        if (!Request.Query.ContainsKey("path")) Path = FolderHome;
        if (Path == "/") Path = "";
        var started = Stopwatch.GetTimestamp();
        QuickAccess = _folders.ListPins();
        // A genuine Refresh bypasses the short-lived navigation snapshot.
        var refresh = Request.Headers["X-YRM-Refresh"].ToString() == "1";
        var (discovered, samba) = await _navigation.GetAsync(HttpContext.RequestAborted, refresh);
        var catalogMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;

        PhysicalDisks = discovered.Where(d => d.Type == "disk").ToArray();
        MountedVolumes = discovered
            .Where(device => device.MountPoint.Length > 0 && device.CanMount &&
                device.MountPoint != "/" &&
                !device.MountPoint.StartsWith("/var/", StringComparison.Ordinal) &&
                !device.MountPoint.StartsWith("/boot", StringComparison.Ordinal) &&
                !device.MountPoint.StartsWith("/home/", StringComparison.Ordinal))
            .GroupBy(device => device.MountPoint, StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(device => device.Path, StringComparer.Ordinal)
            .ToArray();
        MyFiles = DiscoverMyFiles();
        var foldersMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds - catalogMs;
        if (IsMyFolders)
        {
            View = new FileView("system", "", true, null, []);
        }
        else
        {
            View = _files.Browse("system", CurrentRelative, Hidden);
            // Hide known YRMPanel installation leftovers from top-level Linux home
            // folders (including the selected file user, not only the service HOME).
            // This is presentation-only: never delete, move, or alter these files.
            if (View.Available && IsUserHomeDirectory(Absolute))
                View = View with { Items = View.Items.Where(item =>
                    item.IsDirectory || !IsPanelInstallArtifact(item.Name)).ToArray() };
        }
        Samba = samba;
        var browseMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds - catalogMs - foldersMs;
        Response.Headers["Server-Timing"] = FormattableString.Invariant(
            $"catalog;dur={catalogMs:0.0},folders;dur={foldersMs:0.0},browse;dur={browseMs:0.0}");
    }

    private static bool IsUserHomeDirectory(string absolute)
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd('/');
        if (string.Equals(absolute, home, StringComparison.Ordinal)) return true;
        // The panel runs as a service, and its HOME can differ from the Linux
        // user's /home/<username> being browsed. Limit the fallback to the
        // top-level home itself: do not hide normal project install.sh files.
        if (!OperatingSystem.IsLinux()) return false;
        if (absolute == "/root") return true;
        return absolute.StartsWith("/home/", StringComparison.Ordinal) &&
            absolute.Length > "/home/".Length &&
            absolute.IndexOf('/', "/home/".Length) < 0;
    }

    private static bool IsPanelInstallArtifact(string name) =>
        name is "install.sh" or "uninstall.sh" or "yrm-panel-update-trigger.sh" ||
        // A previously executed diagnostic command accidentally became a filename.
        name.StartsWith("systemctl show yrm-panel.service", StringComparison.OrdinalIgnoreCase) ||
        // The actual diagnostic orphan is missing the leading 's'.
        name.StartsWith("ystemctl show yrm-panel.service", StringComparison.OrdinalIgnoreCase);

    // The visible My Files root is derived from real directories, not a parallel
    // 'registered folders' database. Historical bookmarks are read for compatibility.
    // Nothing here moves, copies, deletes, or changes permissions on user files.
    private IReadOnlyList<string> DiscoverMyFiles()
    {
        var roots = new List<string>();
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrWhiteSpace(home) && home != "/" && Directory.Exists(home))
            roots.Add(System.IO.Path.TrimEndingDirectorySeparator(home));
        roots.AddRange(MountedVolumes.Select(v => v.MountPoint)
            .Where(m => Directory.Exists(m) && m != "/"));
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in roots.Distinct(StringComparer.Ordinal))
        {
            // FileManagerService already skips hidden entries, symlinks and lost+found.
            var browse = _files.Browse("system", root.TrimStart('/'));
            if (!browse.Available) continue;
            foreach (var entry in browse.Items.Where(e => e.IsDirectory))
            {
                var path = System.IO.Path.Combine(root, entry.Name);
                if (Directory.Exists(path)) found.Add(path);
            }
        }
        foreach (var old in _folders.List())
        {
            // Preserve formerly-added external folders even when their parent is
            // outside the two normal managed storage roots.
            if (Directory.Exists(old) && _files.Browse("system", old.TrimStart('/')).Available)
                found.Add(old);
        }
        return found.OrderBy(x => System.IO.Path.GetFileName(x), StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x, StringComparer.Ordinal).ToArray();
    }

    private async Task<bool> IsMyFilesEntryAsync(string absolute)
    {
        if (_folders.List().Contains(absolute, StringComparer.Ordinal)) return true;
        var parent = System.IO.Path.GetDirectoryName(absolute);
        var home = System.IO.Path.TrimEndingDirectorySeparator(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        if (string.Equals(parent, home, StringComparison.Ordinal)) return true;
        var devices = await _devices.ListAsync(HttpContext.RequestAborted);
        return devices.Any(device => device.MountPoint == parent && device.MountPoint != "/" &&
            device.FileSystem.Length > 0 && !device.MountPoint.StartsWith("/boot", StringComparison.Ordinal) &&
            !device.MountPoint.StartsWith("/var/", StringComparison.Ordinal));
    }

    private async Task<IReadOnlyList<(string Full, string Parent, string Name)>> ResolveLibrarySelectionAsync(string[] paths)
    {
        if (paths.Length == 0 || paths.Length > 200)
            throw new ArgumentException("Select between 1 and 200 folders.");
        var devices = await _devices.ListAsync(HttpContext.RequestAborted);
        MountedVolumes = devices.Where(d => d.MountPoint.Length > 0 && d.CanMount && d.MountPoint != "/" &&
            !d.MountPoint.StartsWith("/var/", StringComparison.Ordinal) &&
            !d.MountPoint.StartsWith("/boot", StringComparison.Ordinal) &&
            !d.MountPoint.StartsWith("/home/", StringComparison.Ordinal))
            .GroupBy(d => d.MountPoint, StringComparer.Ordinal).Select(g => g.First()).ToArray();
        var allowed = DiscoverMyFiles().ToHashSet(StringComparer.Ordinal);
        var selected = new List<(string Full, string Parent, string Name)>();
        foreach (var value in paths.Distinct(StringComparer.Ordinal))
        {
            if (!allowed.Contains(value) || !Directory.Exists(value))
                throw new UnauthorizedAccessException("A selected My Files folder is missing or unavailable.");
            var parent = System.IO.Path.GetDirectoryName(value) ?? "/";
            var name = System.IO.Path.GetFileName(value);
            selected.Add((value, parent.TrimStart('/'), name));
        }
        return selected;
    }

    public IActionResult OnGetTree(string path = "")
    {
        var view = _files.Browse("system", path, Hidden);
        if (!view.Available) return BadRequest(new { error = view.Error });
        return new JsonResult(new
        {
            path = view.Relative,
            absolute = FileManagerService.Absolute(view.Relative),
            folders = view.Items.Where(x => x.IsDirectory).Select(x => x.Name),
            // A folder always has a chevron. Loading its children is lazy, so
            // we do not scan each directory just to decide whether to draw one.
            folderNodes = view.Items.Where(x => x.IsDirectory).Select(x => new { name = x.Name }),
            canManage = view.CanWrite,
            canEnable = view.CanEnable
        });
    }

    public IActionResult OnGetDownload(string name)
    {
        try
        {
            var (stream, filename) = _files.OpenDownload("system", CurrentRelative, name);
            return new FileStreamResult(stream, "application/octet-stream")
                { FileDownloadName = filename, EnableRangeProcessing = true };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                      or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); return Back(); }
    }

    public async Task<IActionResult> OnPostBulkDownloadAsync(string[] names)
    {
        try
        {
            var items = names?.Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct(StringComparer.Ordinal).ToArray() ?? [];
            if (items.Length == 0) return BadRequest("No files selected.");
            Response.ContentType = "application/zip";
            Response.Headers["Content-Disposition"] =
                $"attachment; filename=\"yrm-files-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip\"";
            Response.Headers["Cache-Control"] = "private, no-store";
            if (IsMyFolders)
            {
                var roots = await ResolveLibrarySelectionAsync(items);
                await _files.WriteDownloadZipFromPathsAsync(roots.Select(x => x.Full).ToArray(),
                    Response.Body, HttpContext.RequestAborted);
            }
            else await _files.WriteDownloadZipAsync("system", CurrentRelative, items,
                Response.Body, HttpContext.RequestAborted);
            return new EmptyResult();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException
            or NotSupportedException)
        {
            if (Response.HasStarted) { HttpContext.Abort(); return new EmptyResult(); }
            Response.Headers.Remove("Content-Disposition");
            return BadRequest("Could not prepare download: " + FileManagerService.SafeError(ex));
        }
    }

    public IActionResult OnPostAddExisting(string folderPath)
    {
        Path = FolderHome;
        try
        {
            var absolute = MyFoldersStore.Normalize(folderPath);
            var view = _files.Browse("system", absolute.TrimStart('/'), true);
            if (!view.Available || !view.CanWrite)
                throw new UnauthorizedAccessException("Choose a folder your Linux user can manage.");
            _folders.Add(absolute);
            Notice = "Folder added to My Files. No files or permissions were changed.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                      or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public IActionResult OnPostRemoveMissingLibrary(string folderPath)
    {
        Path = FolderHome;
        try
        {
            var absolute = MyFoldersStore.Normalize(folderPath);
            if (Directory.Exists(absolute))
                throw new IOException("Folder exists. Use Delete Folder to remove the real directory.");
            _folders.Remove(absolute);
            _folders.Unpin(absolute);
            Notice = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public IActionResult OnPostPinFolder(string folderPath)
    {
        try
        {
            var path = MyFoldersStore.Normalize(folderPath);
            if (!Directory.Exists(path) || !_files.Browse("system", path.TrimStart('/')).Available)
                throw new IOException("Folder is not accessible.");
            _folders.Pin(path);
            Notice = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public IActionResult OnPostUnpinFolder(string folderPath)
    {
        try { _folders.Unpin(folderPath); Notice = null; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    // A My Files deletion acts on the real folder. Quick Access only removes shortcuts.
    // Quick Access uses Unpin instead, never deleting real data.
    public async Task<IActionResult> OnPostDeleteLibraryAsync(string folderPath)
    {
        Path = FolderHome;
        try
        {
            var absolute = MyFoldersStore.Normalize(folderPath);
            if (!await IsMyFilesEntryAsync(absolute))
                throw new UnauthorizedAccessException("Folder is not an entry in My Files.");
            await AssertNoSharesAsync(absolute);
            _files.DeleteLibraryFolder(absolute);
            _folders.ForgetDeletedTree(absolute);
            Notice = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    private async Task AssertNoSharesAsync(string absolute)
    {
        var smb = await _samba.ListAsync(HttpContext.RequestAborted);
        if (!smb.Available) throw new IOException("Cannot verify SMB shares. Deletion was cancelled.");
        if (smb.Shares.Any(x => x.Path == absolute || x.Path.StartsWith(absolute + "/", StringComparison.Ordinal)))
            throw new IOException("Stop sharing this folder before deleting it.");
    }

    public async Task<IActionResult> OnPostCreateAsync(
        string parent, string name, string? adminPassword, string? returnTo)
    {
        var normalizedParent = (parent ?? string.Empty).Trim('/');
        // The location picker chooses the real parent, including siblings of the current folder.
        // The file service still verifies this destination before creating anything.
        Path = returnTo == FolderHome ? FolderHome : (returnTo ?? normalizedParent).TrimStart('/');
        var rootParent = normalizedParent.Length == 0;
        if (rootParent)
        {
            Notice = await _storage.RunAsync("create-root", name, adminPassword,
                HttpContext.RequestAborted);
        }
        else
        {
            var absoluteParent = FileManagerService.Absolute(normalizedParent);
            if (!_files.IsManaged(absoluteParent))
            {
                // The selected mountpoint is not yet writable. For a real mounted
                // data volume only, request one sudo authorization and grant its
                // root directory ACL; never recursively alter existing files.
                var volumes = await _devices.ListAsync(HttpContext.RequestAborted);
                var volume = volumes.FirstOrDefault(v =>
                    v.MountPoint == absoluteParent && v.FileSystem.Length > 0 && !v.ReadOnly &&
                    v.MountPoint != "/" && !v.MountPoint.StartsWith("/home/", StringComparison.Ordinal) &&
                    !v.MountPoint.StartsWith("/boot", StringComparison.Ordinal) &&
                    !v.MountPoint.StartsWith("/var/", StringComparison.Ordinal));
                if (volume is not null && !string.IsNullOrEmpty(adminPassword) &&
                    !string.IsNullOrWhiteSpace(name) && name is not ("." or "..") &&
                    !name.Contains('/') && !name.Contains('\\') && !name.Contains('\0') &&
                    !name.Any(char.IsControl))
                {
                    var granted = await _storage.RunAsync("grant", absoluteParent, adminPassword,
                        HttpContext.RequestAborted);
                    if (granted.StartsWith("Error:", StringComparison.Ordinal))
                    {
                        Notice = granted;
                        return Back();
                    }
                }
            }
            Notice = Act(() => _files.CreateFolder("system", normalizedParent, name), "Folder created.");
        }
        // The new folder appears in My Files through directory discovery.
        // Do not add another entry to the legacy my-folders.json registry.
        return Back();
    }

    public async Task<IActionResult> OnPostEnableAsync(string? adminPassword)
    {
        Notice = await _storage.RunAsync("grant", FileManagerService.Absolute(CurrentRelative), adminPassword, HttpContext.RequestAborted);
        return Back();
    }

    public async Task<IActionResult> OnPostEnableFolderAsync(string name, string? adminPassword)
    {
        var current = _files.Browse("system", CurrentRelative, true);
        if (!current.Available || !current.Items.Any(x => x.Name == name && x.IsDirectory))
        { Notice = "Error: Selected folder not found."; return Back(); }
        var full = FileManagerService.Absolute(string.IsNullOrEmpty(CurrentRelative) ? name : CurrentRelative.Trim('/') + "/" + name);
        if (!_files.CanEnable(full))
        { Notice = "Error: This folder cannot be managed with administrator permissions."; return Back(); }
        Notice = await _storage.RunAsync("grant", full, adminPassword, HttpContext.RequestAborted);
        return Back();
    }

    public async Task<IActionResult> OnPostRenameAsync(string name, string newName, string? sourcePath)
    {
        try
        {
            var parent = CurrentRelative;
            if (IsMyFolders)
            {
                var selected = await ResolveLibrarySelectionAsync([sourcePath ?? ""]);
                if (selected.Count != 1 || selected[0].Name != name)
                    throw new UnauthorizedAccessException("The selected folder has changed.");
                parent = selected[0].Parent;
            }
            _files.Rename("system", parent, name, newName);
            Notice = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public async Task<IActionResult> OnPostDeleteAsync(string name)
    {
        try
        {
            var absolute = FileManagerService.Absolute(string.IsNullOrEmpty(CurrentRelative)
                ? name : CurrentRelative.Trim('/') + "/" + name);
            await AssertNoSharesAsync(absolute);
            _files.Delete("system", CurrentRelative, name);
            _folders.ForgetDeletedTree(absolute);
            Notice = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    // One authenticated operation for a selection; server-side validation is
    // performed for every entry. No client-side loop of destructive POSTs.
    public async Task<IActionResult> OnPostBulkDeleteAsync([FromForm] string[] names)
    {
        var selected = (names ?? []).Distinct(StringComparer.Ordinal).ToArray();
        if (selected.Length == 0 || selected.Length > 500)
        { Notice = "Error: Select between 1 and 500 items."; return Back(); }
        var completed = 0;
        try
        {
            // Validate once against current directory and one SMB snapshot.
            // Read-only preflight avoids 100 repeated Samba calls for 100 items.
            IReadOnlyList<(string Full, string Parent, string Name)> library = IsMyFolders
                ? await ResolveLibrarySelectionAsync(selected) : [];
            var view = IsMyFolders ? null : _files.Browse("system", CurrentRelative);
            if (view is not null && !view.Available) throw new IOException("Current folder unavailable.");
            var smb = await _samba.ListAsync(HttpContext.RequestAborted);
            if (!smb.Available) throw new IOException("Cannot verify SMB shares. Deletion was cancelled.");
            foreach (var name in selected)
            {
                var full = IsMyFolders ? name : FileManagerService.Absolute(string.IsNullOrEmpty(CurrentRelative)
                    ? name : CurrentRelative.Trim('/') + "/" + name);
                if (!IsMyFolders && !view!.Items.Any(item => item.Name == name))
                    throw new IOException("Selected item no longer exists.");
                if (smb.Shares.Any(share => share.Path == full ||
                    share.Path.StartsWith(full + "/", StringComparison.Ordinal)))
                    throw new IOException("Stop sharing this folder before deleting it.");
            }
            foreach (var name in selected)
            {
                var full = IsMyFolders ? name : FileManagerService.Absolute(string.IsNullOrEmpty(CurrentRelative)
                    ? name : CurrentRelative.Trim('/') + "/" + name);
                if (IsMyFolders) _files.DeleteLibraryFolder(full);
                else _files.Delete("system", CurrentRelative, name);
                _folders.ForgetDeletedTree(full);
                completed++;
            }
            Notice = $"Deleted {completed} items.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = $"Error: Deleted {completed} of {selected.Length}. " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public async Task<IActionResult> OnPostBulkCopyAsync([FromForm] string[] names, string destination)
    {
        var selected = (names ?? []).Distinct(StringComparer.Ordinal).ToArray();
        if (selected.Length == 0 || selected.Length > 500)
        { Notice = "Error: Select between 1 and 500 items."; return Back(); }
        var completed = 0;
        try
        {
            IReadOnlyList<(string Full, string Parent, string Name)> library = IsMyFolders
                ? await ResolveLibrarySelectionAsync(selected) : [];
            foreach (var item in library)
            {
                await _files.CopyAsync("system", item.Parent, item.Name, destination,
                    HttpContext.RequestAborted);
                completed++;
            }
            if (!IsMyFolders) foreach (var name in selected)
            {
                await _files.CopyAsync("system", CurrentRelative, name, destination,
                    HttpContext.RequestAborted);
                completed++;
            }
            Notice = $"Copied {completed} items.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or
                                   NotSupportedException or OperationCanceledException)
        { Notice = $"Error: Copied {completed} of {selected.Length}. " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public async Task<IActionResult> OnPostBulkMoveAsync([FromForm] string[] names, string destination)
    {
        var selected = (names ?? []).Distinct(StringComparer.Ordinal).ToArray();
        if (selected.Length == 0 || selected.Length > 500)
        { Notice = "Error: Select between 1 and 500 items."; return Back(); }
        var completed = 0;
        try
        {
            IReadOnlyList<(string Full, string Parent, string Name)> library = IsMyFolders
                ? await ResolveLibrarySelectionAsync(selected) : [];
            if (IsMyFolders)
            {
                var smb = await _samba.ListAsync(HttpContext.RequestAborted);
                if (!smb.Available) throw new IOException("Cannot verify active SMB shares. Move cancelled.");
                if (library.Any(item => smb.Shares.Any(share =>
                    share.Path == item.Full || share.Path.StartsWith(item.Full + "/", StringComparison.Ordinal))))
                    throw new IOException("Stop sharing selected folders before moving them.");
            }
            foreach (var item in library)
            { _files.Move("system", item.Parent, item.Name, destination); completed++; }
            if (!IsMyFolders) foreach (var name in selected)
            {
                _files.Move("system", CurrentRelative, name, destination);
                completed++;
            }
            Notice = $"Moved {completed} items.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = $"Error: Moved {completed} of {selected.Length}. " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public IActionResult OnPostMove(string name, string destination)
    { Notice = Act(() => _files.Move("system", CurrentRelative, name, destination), "Moved."); return Back(); }

    public async Task<IActionResult> OnPostCopyAsync(string name, string destination)
    {
        try
        {
            await _files.CopyAsync("system", CurrentRelative, name, destination,
                HttpContext.RequestAborted);
            Notice = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or
                                   ArgumentException or NotSupportedException or OperationCanceledException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public IActionResult OnGetExists(string name)
    {
        try { return new JsonResult(new { exists = _files.Exists("system", CurrentRelative, name) }); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { return BadRequest(new { error = FileManagerService.SafeError(ex) }); }
    }

    public IActionResult OnGetPreview(string name)
    {
        var ext = System.IO.Path.GetExtension(name).ToLowerInvariant();
        var mime = ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png", ".webp" => "image/webp", ".gif" => "image/gif",
            ".mp4" => "video/mp4", ".webm" => "video/webm",
            ".mp3" => "audio/mpeg", ".wav" => "audio/wav", ".ogg" => "audio/ogg",
            ".pdf" => "application/pdf", ".txt" or ".log" or ".json" or ".xml" => "text/plain",
            _ => null
        };
        if (mime is null) return BadRequest("Preview is not available for this file type.");
        try
        {
            var (stream, _) = _files.OpenDownload("system", CurrentRelative, name);
            // Let ASP.NET Core perform ETag, If-Range, 304 and 206 handling.
            // A manual If-None-Match early return can bypass media range processing.
            var details = new System.IO.FileInfo(stream.Name);
            var etag = $"\"{details.Length:x}-{details.LastWriteTimeUtc.Ticks:x}\"";
            Response.Headers["Cache-Control"] = "private, no-cache";
            // Embedded PDF preview stays same-origin; no public proxy caching.
            Response.Headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'self'; object-src 'none'";
            return new FileStreamResult(stream, mime)
            {
                EnableRangeProcessing = true,
                EntityTag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue(etag),
                LastModified = new DateTimeOffset(details.LastWriteTimeUtc, TimeSpan.Zero)
            };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { return BadRequest(FileManagerService.SafeError(ex)); }
    }

    public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload, bool replace = false, string? targetParent = null)
    {
        var ajax = Request.Headers.Accept.ToString().Contains("application/json", StringComparison.OrdinalIgnoreCase);
        if (upload is null) return ajax ? BadRequest(new { ok = false, message = "Select a file." })
            : Back();
        try
        {
            var uploadParent = CurrentRelative;
            if (IsMyFolders)
            {
                var devices = await _devices.ListAsync(HttpContext.RequestAborted);
                var home = HomePath;
                var valid = new HashSet<string>(devices.Where(d => d.CanMount && d.MountPoint.Length > 0 &&
                    d.MountPoint != "/" && !d.MountPoint.StartsWith("/var/", StringComparison.Ordinal) &&
                    !d.MountPoint.StartsWith("/boot", StringComparison.Ordinal))
                    .Select(d => d.MountPoint.TrimStart('/')), StringComparer.Ordinal) { home };
                if (targetParent is null || !valid.Contains(targetParent))
                    throw new UnauthorizedAccessException("Select a valid mounted destination.");
                uploadParent = targetParent;
            }
            if (!replace && _files.Exists("system", uploadParent, upload.FileName))
            {
                if (ajax)
                    return new ConflictObjectResult(new { ok = false, conflict = true, message = "File exists." });
                Notice = "Error: File already exists. Choose Replace or Skip.";
                return Back();
            }
            await _files.UploadAsync("system", uploadParent, upload, replace, HttpContext.RequestAborted);
            if (ajax) return new JsonResult(new { ok = true, message = "File uploaded." });
            Notice = "File uploaded.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            var message = FileManagerService.SafeError(ex);
            if (ajax) return BadRequest(new { ok = false, message });
            Notice = "Error: " + message;
        }
        return Back();
    }

    public async Task<IActionResult> OnPostShareAsync(
        string folder, string? shareName, bool readOnly, string? smbPassword,
        string? adminPassword, string? absoluteFolder)
    {
        string full;
        try
        {
            if (!string.IsNullOrWhiteSpace(absoluteFolder))
            {
                full = MyFoldersStore.Normalize(absoluteFolder);
            }
            else
            {
                var view = _files.Browse("system", CurrentRelative, true);
                if (!view.Available || !view.Items.Any(item => item.IsDirectory && item.Name == folder))
                    throw new IOException("Folder not found.");
                var target = string.IsNullOrEmpty(Path) ? folder : Path.Trim('/') + "/" + folder;
                full = FileManagerService.Absolute(target);
            }
            if (!_files.IsManaged(full))
                throw new UnauthorizedAccessException("Your Linux user cannot manage this folder.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                      or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); return Back(); }

        var state = await _samba.ListAsync(HttpContext.RequestAborted);
        if (!state.Available) { Notice = "Error: " + state.Message; return Back(); }
        if (!state.AccountConfigured)
        {
            if (string.IsNullOrEmpty(smbPassword))
            { Notice = "Error: Set your SMB password when sharing for the first time."; return Back(); }
            Notice = await _samba.SetPasswordAsync(smbPassword, adminPassword, HttpContext.RequestAborted);
            if (Notice.StartsWith("Error:", StringComparison.Ordinal)) return Back();
        }
        var name = string.IsNullOrWhiteSpace(shareName) ? folder : shareName.Trim();
        Notice = await _samba.SaveAsync(name, full, readOnly, adminPassword, HttpContext.RequestAborted);
        if (!Notice.StartsWith("Error:", StringComparison.Ordinal)) _navigation.Invalidate();
        return Back();
    }

    public async Task<IActionResult> OnPostUnshareAsync(string name, string? adminPassword)
    {
        var message = await _samba.DeleteAsync(name, adminPassword, HttpContext.RequestAborted);
        // A removed share is already reflected by the next server-side listing.
        // Keep failures visible; avoid the redundant green "removed" notification.
        Notice = message.StartsWith("Error:", StringComparison.Ordinal) ? message : null;
        if (Notice is null) _navigation.Invalidate();
        return Back();
    }

    private IActionResult Back() => RedirectToPage(new
    {
        path = IsMyFolders ? FolderHome : (string.IsNullOrEmpty(Path) ? "/" : Path), hidden = Hidden
    });

    private static string Act(Action action, string success)
    {
        try { action(); return success; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                   or ArgumentException or NotSupportedException)
        { return "Error: " + FileManagerService.SafeError(ex); }
    }
}
