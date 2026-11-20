using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
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

    public FilesModel(FileManagerService files, StorageManagementService storage,
        SambaManagementService samba, MyFoldersStore folders, StorageDeviceService devices)
    {
        _files = files;
        _storage = storage;
        _samba = samba;
        _folders = folders;
        _devices = devices;
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
    public bool CanSelectStorage => IsMyFolders || string.IsNullOrEmpty(Path);
    public string FormatSize(long size) => FileManagerService.FormatSize(size);
    public string StorageLabel(StorageDevice volume)
    {
        var number = 0;
        for (var i = 0; i < PhysicalDisks.Count; i++)
        {
            if (PhysicalDisks[i].Path != volume.ParentPath && PhysicalDisks[i].Path != volume.Path) continue;
            number = i + 1;
            break;
        }
        var display = !string.IsNullOrWhiteSpace(volume.Label) ? volume.Label : volume.Name;
        return number > 0 ? $"Disk {number} · {display} — {volume.MountPoint}" : $"{display} — {volume.MountPoint}";
    }
    public SambaOverview Samba { get; private set; } = new(false, "Samba unavailable", "", false, []);
    [TempData] public string? Notice { get; set; }
    public string Parent => string.IsNullOrEmpty(Path) ? FolderHome : FileManagerService.ParentOf(Path);
    public string Absolute => IsMyFolders ? "" : FileManagerService.Absolute(Path);
    public string HomePath => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimStart('/');
    public string DefaultCreateParent => IsMyFolders ? HomePath : Path;

    public async Task OnGetAsync()
    {
        if (!Request.Query.ContainsKey("path")) Path = FolderHome;
        if (Path == "/") Path = "";
        QuickAccess = _folders.ListPins();
        var discovered = await _devices.ListAsync(HttpContext.RequestAborted);
        PhysicalDisks = discovered.Where(d => d.Type == "disk").ToArray();
        MountedVolumes = discovered
            .Where(device => device.MountPoint.Length > 0 && device.CanMount &&
                device.MountPoint != "/" &&
                !device.MountPoint.StartsWith("/var/", StringComparison.Ordinal) &&
                !device.MountPoint.StartsWith("/boot", StringComparison.Ordinal) &&
                !device.MountPoint.StartsWith("/home/", StringComparison.Ordinal))
            .GroupBy(device => device.MountPoint, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToArray();
        MyFiles = DiscoverMyFiles();
        if (IsMyFolders)
        {
            View = new FileView("system", "", true, null, []);
        }
        else
        {
            View = _files.Browse("system", CurrentRelative, Hidden);
        }
        Samba = await _samba.ListAsync(HttpContext.RequestAborted);
    }

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

    public IActionResult OnGetTree(string path = "")
    {
        var view = _files.Browse("system", path, Hidden);
        if (!view.Available) return BadRequest(new { error = view.Error });
        return new JsonResult(new
        {
            path = view.Relative,
            absolute = FileManagerService.Absolute(view.Relative),
            folders = view.Items.Where(x => x.IsDirectory).Select(x => x.Name),
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
        // When browsing an existing directory, New Folder always belongs there.
        // Only the library overview or filesystem root may choose another mount.
        var fixedLocation = returnTo != FolderHome && !string.IsNullOrWhiteSpace(returnTo) && returnTo != "/";
        if (fixedLocation) normalizedParent = returnTo!.Trim('/');
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

    public IActionResult OnPostRename(string name, string newName)
    { Notice = Act(() => _files.Rename("system", CurrentRelative, name, newName), "Renamed."); return Back(); }

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
            // Private browser cache with revalidation: do not stream the same image again
            // when it has not changed. Never cache it publicly on a proxy/VPN gateway.
            var details = new System.IO.FileInfo(stream.Name);
            var etag = $"\"{details.Length:x}-{details.LastWriteTimeUtc.Ticks:x}\"";
            Response.Headers["ETag"] = etag;
            Response.Headers["Cache-Control"] = "private, no-cache";
            if (Request.Headers["If-None-Match"].ToString() == etag)
            {
                stream.Dispose();
                return new StatusCodeResult(StatusCodes.Status304NotModified);
            }
            // The built-in PDF preview is same-origin only.
            Response.Headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'self'; object-src 'none'";
            return new FileStreamResult(stream, mime) { EnableRangeProcessing = true };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { return BadRequest(FileManagerService.SafeError(ex)); }
    }

    public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload, bool replace = false)
    {
        var ajax = Request.Headers.Accept.ToString().Contains("application/json", StringComparison.OrdinalIgnoreCase);
        if (upload is null) return ajax ? BadRequest(new { ok = false, message = "Select a file." })
            : Back();
        try
        {
            if (!replace && _files.Exists("system", CurrentRelative, upload.FileName))
            {
                if (ajax)
                    return new ConflictObjectResult(new { ok = false, conflict = true, message = "File exists." });
                Notice = "Error: File already exists. Choose Replace or Skip.";
                return Back();
            }
            await _files.UploadAsync("system", CurrentRelative, upload, replace, HttpContext.RequestAborted);
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
        return Back();
    }

    public async Task<IActionResult> OnPostUnshareAsync(string name, string? adminPassword)
    {
        var message = await _samba.DeleteAsync(name, adminPassword, HttpContext.RequestAborted);
        // A removed share is already reflected by the next server-side listing.
        // Keep failures visible; avoid the redundant green "removed" notification.
        Notice = message.StartsWith("Error:", StringComparison.Ordinal) ? message : null;
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
