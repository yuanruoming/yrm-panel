using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class SharesModel : PageModel
{
    private readonly SambaManagementService _samba;
    private readonly FileManagerService _files;
    public SharesModel(SambaManagementService samba, FileManagerService files)
    { _samba = samba; _files = files; }
    public SambaOverview Samba { get; private set; } = new(false, "Not loaded", "", false, []);
    [TempData] public string? Notice { get; set; }
    public async Task OnGetAsync() => Samba = await _samba.ListAsync(HttpContext.RequestAborted);

    public IActionResult OnGetFolders(string root, string path = "")
    {
        var result = _files.Browse(root ?? "", path ?? "");
        if (!result.Available) return BadRequest(new { error = result.Error ?? "Folder unavailable" });
        return new JsonResult(new
        {
            root,
            path = path ?? "",
            absolute = _files.DisplayRoot(root ?? "") +
                (string.IsNullOrEmpty(path) ? "" : "/" + path.Trim('/')),
            folders = result.Items.Where(i => i.IsDirectory).Select(i => i.Name).ToArray()
        });
    }

    public IActionResult OnPostMakeFolder(string root, string path, string name)
    {
        try
        {
            _files.CreateFolder(root, path, name);
            return new JsonResult(new { ok = true });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { return BadRequest(new { error = FileManagerService.SafeError(ex) }); }
    }


    public async Task<IActionResult> OnPostSaveAsync(string name, string path, bool readOnly)
    {
        Notice = await _samba.SaveAsync(name, path, readOnly, HttpContext.RequestAborted);
        return RedirectToPage();
    }
    public async Task<IActionResult> OnPostDeleteAsync(string name)
    {
        Notice = await _samba.DeleteAsync(name, HttpContext.RequestAborted);
        return RedirectToPage();
    }
    public async Task<IActionResult> OnPostPasswordAsync(string password)
    {
        Notice = await _samba.SetPasswordAsync(password, HttpContext.RequestAborted);
        return RedirectToPage();
    }
}
