using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class FilesModel : PageModel
{
    private readonly FileManagerService _files;
    private readonly StorageManagementService _storage;
    private readonly SambaManagementService _samba;
    public FilesModel(FileManagerService files, StorageManagementService storage, SambaManagementService samba)
    { _files = files; _storage = storage; _samba = samba; }

    [BindProperty(SupportsGet = true)] public string Path { get; set; } = "";
    public FileView View { get; private set; } = new("system", "", false, "Not loaded", []);
    public SambaOverview Samba { get; private set; } = new(false, "Samba unavailable", "", false, []);
    [TempData] public string? Notice { get; set; }
    public string Parent => FileManagerService.ParentOf(Path);
    public string Absolute => FileManagerService.Absolute(Path);

    public async Task OnGetAsync()
    {
        View = _files.Browse("system", Path);
        Samba = await _samba.ListAsync(HttpContext.RequestAborted);
    }

    public IActionResult OnGetTree(string path = "")
    {
        var view = _files.Browse("system", path);
        if (!view.Available) return BadRequest(new { error = view.Error });
        return new JsonResult(new { path = view.Relative, absolute = FileManagerService.Absolute(view.Relative),
            folders = view.Items.Where(x => x.IsDirectory).Select(x => x.Name),
            canManage = view.CanWrite, canEnable = view.CanEnable });
    }

    public IActionResult OnGetDownload(string name)
    {
        try
        {
            var (stream, fileName) = _files.OpenDownload("system", Path, name);
            return new FileStreamResult(stream, "application/octet-stream")
            { FileDownloadName = fileName, EnableRangeProcessing = true };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); return Back(); }
    }

    public async Task<IActionResult> OnPostCreateAsync(string parent, string name)
    {
        Path = parent ?? "";
        if (string.IsNullOrEmpty(Path)) Notice = await _storage.RunAsync("create-root", name, HttpContext.RequestAborted);
        else Notice = Act(() => _files.CreateFolder("system", Path, name), "Folder created.");
        return Back();
    }
    public async Task<IActionResult> OnPostEnableAsync()
    {
        Notice = await _storage.RunAsync("grant", Absolute, HttpContext.RequestAborted);
        return Back();
    }
    public async Task<IActionResult> OnPostEnableFolderAsync(string name)
    {
        var view = _files.Browse("system", Path);
        if (!view.Available || !view.Items.Any(x => x.Name == name && x.IsDirectory))
        { Notice = "Error: Selected folder not found."; return Back(); }
        var full = FileManagerService.Absolute(string.IsNullOrEmpty(Path) ? name : Path.Trim('/') + "/" + name);
        if (!_files.CanEnable(full))
        { Notice = "Error: System folders cannot be enabled for editing."; return Back(); }
        Notice = await _storage.RunAsync("grant", full, HttpContext.RequestAborted);
        return Back();
    }
    public IActionResult OnPostRename(string name, string newName)
    { Notice = Act(() => _files.Rename("system", Path, name, newName), "Renamed."); return Back(); }
    public IActionResult OnPostDelete(string name)
    { Notice = Act(() => _files.Delete("system", Path, name), "Removed."); return Back(); }
    public IActionResult OnPostMove(string name, string destination)
    { Notice = Act(() => _files.Move("system", Path, name, destination), "Moved."); return Back(); }
    public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload)
    {
        if (upload is null) { Notice = "Error: Select a file first."; return Back(); }
        try { await _files.UploadAsync("system", Path, upload, HttpContext.RequestAborted); Notice = "File uploaded."; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = "Error: " + FileManagerService.SafeError(ex); }
        return Back();
    }
    public async Task<IActionResult> OnPostShareAsync(string folder, string? shareName, bool readOnly)
    {
        // The submitted folder must be a direct child of the currently browsed path.
        var view = _files.Browse("system", Path);
        if (!view.Available || !view.Items.Any(item => item.IsDirectory && item.Name == folder) || !_files.IsManaged(FileManagerService.Absolute(
            string.IsNullOrEmpty(Path) ? folder : Path.Trim('/') + "/" + folder)))
            Notice = "Error: This folder cannot be shared from this location.";
        else
        {
            var name = string.IsNullOrWhiteSpace(shareName) ? folder : shareName.Trim();
            Notice = await _samba.SaveAsync(name, FileManagerService.Absolute(
                string.IsNullOrEmpty(Path) ? folder : Path.Trim('/') + "/" + folder),
                readOnly, HttpContext.RequestAborted);
        }
        return Back();
    }
    public async Task<IActionResult> OnPostUnshareAsync(string name)
    { Notice = await _samba.DeleteAsync(name, HttpContext.RequestAborted); return Back(); }
    public async Task<IActionResult> OnPostPasswordAsync(string password)
    { Notice = await _samba.SetPasswordAsync(password, HttpContext.RequestAborted); return Back(); }

    private IActionResult Back() => RedirectToPage(new { path = Path });
    private static string Act(Action action, string success)
    {
        try { action(); return success; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { return "Error: " + FileManagerService.SafeError(ex); }
    }
}
