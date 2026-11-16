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
    public LoginModel(AdminCredentialStore credentials) => _credentials = credentials;

    [BindProperty] public string Username { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    public string? Error { get; private set; }

    public IActionResult OnGet() => User.Identity?.IsAuthenticated == true ? RedirectToPage("/Index") : Page();

    public async Task<IActionResult> OnPostAsync()
    {
        if (string.IsNullOrWhiteSpace(Username) || !_credentials.Verify(Username.Trim(), Password ?? ""))
        {
            Error = "Invalid username or password.";
            return Page();
        }
        var claims = new[]
        {
            new Claim(ClaimTypes.Name, _credentials.Username),
            new Claim("yrm:credential-stamp", _credentials.SessionStamp)
        };
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
        return RedirectToPage("/Index");
    }
}
