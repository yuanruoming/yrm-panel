using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using YrmPanel.Services;

namespace YrmPanel.Pages.Account;

[AllowAnonymous]
[EnableRateLimiting("login")]
public sealed class LoginModel : PageModel
{
    private readonly AdminCredentialStore _credentials;
    private readonly LinuxPamAuthenticator _linux;

    public LoginModel(AdminCredentialStore credentials, LinuxPamAuthenticator linux)
    { _credentials = credentials; _linux = linux; }

    [BindProperty] public string Username { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    public string? Error { get; private set; }
    public string AccountDescription => OperatingSystem.IsLinux() ? "Linux account" : "Development account";

    public IActionResult OnGet() => User.Identity?.IsAuthenticated == true ? RedirectToPage("/Index") : Page();

    public async Task<IActionResult> OnPostAsync()
    {
        var username = Username.Trim();
        var verified = OperatingSystem.IsLinux()
            ? await _linux.VerifyAsync(username, Password, HttpContext.RequestAborted)
            : _credentials.Verify(username, Password);
        if (!verified)
        {
            Error = "Invalid Linux username or password.";
            return Page();
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.Name, username),
            new Claim("yrm:credential-stamp", OperatingSystem.IsLinux() ? "linux-pam-v1" : _credentials.SessionStamp)
        };
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
        return RedirectToPage("/Index");
    }
}
