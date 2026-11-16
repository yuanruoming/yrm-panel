using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;
using YrmPanel.Services;

var dataRoot = Environment.GetEnvironmentVariable("YRM_PANEL_DATA_DIR");
if (string.IsNullOrWhiteSpace(dataRoot))
{
    dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YrmPanel");
}
dataRoot = Path.GetFullPath(dataRoot);
Directory.CreateDirectory(dataRoot);

var accounts = new AdminCredentialStore(dataRoot);
if (args.Contains("--set-admin", StringComparer.Ordinal))
{
    await accounts.ConfigureFromConsoleAsync();
    return;
}

if (!accounts.IsConfigured)
{
    Console.Error.WriteLine("No admin account configured. Run: dotnet run -- --set-admin");
    Environment.ExitCode = 2;
    return;
}

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(builder.Configuration["Panel:Url"] ?? "http://127.0.0.1:6080");

builder.Services.AddSingleton(accounts);
builder.Services.AddSingleton(new PanelDataPaths(dataRoot));
builder.Services.AddSingleton<PanelSettingsStore>();
builder.Services.AddSingleton<DockerApiService>();
builder.Services.AddSingleton<FileManagerService>();
builder.Services.AddSingleton<SambaManagementService>();
builder.Services.AddSingleton<SystemdStatusService>();
builder.Services.AddSingleton<SystemPowerService>();
builder.Services.AddSingleton<ISystemMetricsService>(sp =>
    OperatingSystem.IsLinux()
        ? ActivatorUtilities.CreateInstance<LinuxSystemMetricsService>(sp)
        : ActivatorUtilities.CreateInstance<DemoSystemMetricsService>(sp));

var keyDirectory = Path.Combine(dataRoot, "keys");
Directory.CreateDirectory(keyDirectory);
builder.Services.AddDataProtection()
    .SetApplicationName("YrmPanel")
    .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/Account/Login";
        options.AccessDeniedPath = "/Account/Login";
        options.Cookie.Name = "YrmPanel.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        // Cookie from a previous username is no longer valid after account reconfiguration.
        options.Events.OnValidatePrincipal = context =>
        {
            if (!string.Equals(context.Principal?.Identity?.Name, accounts.Username, StringComparison.Ordinal) ||
                !string.Equals(context.Principal?.FindFirst("yrm:credential-stamp")?.Value,
                    accounts.SessionStamp, StringComparison.Ordinal))
                context.RejectPrincipal();
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            }
            context.Response.Redirect(context.RedirectUri);
            return Task.CompletedTask;
        };
    });
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 256L * 1024 * 1024);
builder.Services.AddAuthorization();
builder.Services.AddRazorPages(options =>
{
    options.Conventions.AuthorizeFolder("/");
    options.Conventions.AllowAnonymousToPage("/Account/Login");
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 8,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0
            }));
});

builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 257L * 1024 * 1024);
var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
}
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    if (context.Request.Path.StartsWithSegments("/api"))
        context.Response.Headers["Cache-Control"] = "no-store";
    await next();
});
app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapRazorPages();
app.MapGet("/api/metrics", (ISystemMetricsService metrics) => Results.Ok(metrics.GetSnapshot()))
    .RequireAuthorization();

app.MapGet("/wallpaper", (HttpContext context, PanelSettingsStore settings) =>
{
    context.Response.Headers["Cache-Control"] = "private, no-store";
    var wallpaper = settings.GetWallpaper();
    return wallpaper is null
        ? Results.NotFound()
        : Results.File(wallpaper.Value.path, wallpaper.Value.mime, enableRangeProcessing: true);
}).RequireAuthorization();

app.Run();
