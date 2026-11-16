using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class SharesModel : PageModel
{
    private readonly SambaManagementService _samba;
    public SharesModel(SambaManagementService samba) => _samba = samba;
    public SambaOverview Samba { get; private set; } = new(false, "Not loaded", "", false, []);
    [TempData] public string? Notice { get; set; }
    public async Task OnGetAsync() => Samba = await _samba.ListAsync(HttpContext.RequestAborted);

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
