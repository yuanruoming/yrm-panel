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

    public FilesModel(FileManagerService files, StorageManagementService storage,
        SambaManagementService samba, MyFoldersStore folders)
    {
        _files = files;
        _storage = storage;
        _samba = samba;
        _folders = folders;
    }

    [BindProperty(SupportsGet = true)] public string Path { get; set; } = "";
    [BindProperty(SupportsGet = true)] public bool Hidden { get; set; }
    public bool IsMyFolders => Path == FolderHome;
    private string CurrentRelative => Path == "/" ? "" : Path;
    public FileView View { get; private set; } = new("system", "", false, "Not loaded", []);
    public IReadOnlyList<string> MyFolders { get; private set; } = [];
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

    public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload)
    {
        if (upload is null) { Notice = "Error: Select a file."; return Back(); }
        try { await _files.UploadAsync("system", CurrentRelative, upload, HttpContext.RequestAborted); Notice = "File uploaded."; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                   or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
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
                if (!_folders.List().Contains(full, StringComparer.Ordinal))
                    throw new UnauthorizedAccessException("Add the folder to My Folders before sharing it.");
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
