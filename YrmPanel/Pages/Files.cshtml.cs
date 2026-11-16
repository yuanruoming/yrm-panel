using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class FilesModel : PageModel
{
    private readonly FileManagerService _files;
    public FilesModel(FileManagerService files) => _files = files;
    public FileView View { get; private set; } = new("data", "", false, "Not loaded", []);
    [TempData] public string? Notice { get; set; }
    [BindProperty(SupportsGet = true)] public string Root { get; set; } = "data";
    [BindProperty(SupportsGet = true)] public string Path { get; set; } = "";
    public string DisplayRoot => _files.DisplayRoot(Root);
    public string Parent => System.IO.Path.GetDirectoryName(Path.Replace('/', System.IO.Path.DirectorySeparatorChar))?.Replace('\\','/') ?? "";

    public void OnGet() => View = _files.Browse(Root, Path);

    public IActionResult OnGetDownload(string name)
    {
        try
        {
            var (stream, fileName) = _files.OpenDownload(Root, Path, name);
            return new FileStreamResult(stream, "application/octet-stream")
            {
                FileDownloadName = fileName,
                EnableRangeProcessing = true
            };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            Notice = FileManagerService.SafeError(ex);
            return RedirectToPage(new { root = Root, path = Path });
        }
    }

    public IActionResult OnPostCreate(string name) => Run(() => _files.CreateFolder(Root, Path, name), "Folder created.");
    public IActionResult OnPostRename(string name, string newName) => Run(() => _files.Rename(Root, Path, name, newName), "Item renamed.");
    public IActionResult OnPostDelete(string name) => Run(() => _files.Delete(Root, Path, name), "Item deleted.");
    public IActionResult OnPostMove(string name, string destination) => Run(() => _files.Move(Root, Path, name, destination), "Item moved.");
    public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload)
    {
        if (upload is null) { Notice = "Select a file to upload."; return RedirectBack(); }
        try { await _files.UploadAsync(Root, Path, upload, HttpContext.RequestAborted); Notice = "File uploaded."; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = FileManagerService.SafeError(ex); }
        return RedirectBack();
    }
    private IActionResult Run(Action action, string success)
    {
        try { action(); Notice = success; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { Notice = FileManagerService.SafeError(ex); }
        return RedirectBack();
    }
    private IActionResult RedirectBack() => RedirectToPage(new { root = Root, path = Path });
}
