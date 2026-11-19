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
    public IReadOnlyList<string> MyFolders { get; private set; } = [];
    public IReadOnlyList<StorageDevice> MountedVolumes { get; private set; } = [];
    public IReadOnlyList<StorageDevice> PhysicalDisks { get; private set; } = [];
    public bool CanSelectStorage => IsMyFolders || string.IsNullOrEmpty(Path);
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
        MyFolders = _folders.List();
        var discovered = await _devices.ListAsync(HttpContext.RequestAborted);
        PhysicalDisks = discovered.Where(d => d.Type == "disk").ToArray();
        MountedVolumes = discovered
            .Where(device => device.MountPoint.Length > 0 && device.FileSystem.Length > 0 &&
                device.MountPoint != "/" &&
                !device.MountPoint.StartsWith("/var/", StringComparison.Ordinal) &&
                !device.MountPoint.StartsWith("/boot", StringComparison.Ordinal) &&
                !device.MountPoint.StartsWith("/home/", StringComparison.Ordinal))
            .GroupBy(device => device.MountPoint, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToArray();
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
            Notice = "Folder added to My Folders. No files or permissions were changed.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                      or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }

    public IActionResult OnPostRemoveManaged(string folderPath)
    {
        Path = FolderHome;
        try
        {
            _folders.Remove(folderPath);
            Notice = "Folder removed from My Folders. Files and SMB shares were preserved.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                      or ArgumentException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
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
            Notice = Act(() => _files.CreateFolder("system", normalizedParent, name), "Folder created.");
        }
        if (!Notice.StartsWith("Error:", StringComparison.Ordinal) &&
            (rootParent || Path == FolderHome))
        {
            try
            {
                var createdPath = FileManagerService.Absolute(
                    rootParent ? name : normalizedParent + "/" + name);
                _folders.Add(createdPath);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                          or ArgumentException)
            { Notice += " Could not pin it automatically: " + ex.Message; }
        }
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

    public IActionResult OnPostDelete(string name)
    { Notice = Act(() => _files.Delete("system", CurrentRelative, name), "Removed."); return Back(); }

    public IActionResult OnPostMove(string name, string destination)
    { Notice = Act(() => _files.Move("system", CurrentRelative, name, destination), "Moved."); return Back(); }

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
    { Notice = await _samba.DeleteAsync(name, adminPassword, HttpContext.RequestAborted); return Back(); }

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
