using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
namespace YrmPanel.Pages;
public sealed class SharesModel : PageModel
{
    public IActionResult OnGet() => RedirectToPage("/Files");
}
