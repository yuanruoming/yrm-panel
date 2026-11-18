using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;
using YrmPanel.Services;

var isLinux = OperatingSystem.IsLinux();
var dataRoot = Environment.GetEnvironmentVariable("YRM_PANEL_DATA_DIR");
if (string.IsNullOrWhiteSpace(dataRoot))
    dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YrmPanel");
dataRoot = Path.GetFullPath(dataRoot);
Directory.CreateDirectory(dataRoot);

var accounts = new AdminCredentialStore(dataRoot);
var panelCertificate = new PanelCertificateService(dataRoot);
if (args.Contains("--set-admin", StringComparer.Ordinal))
{
    if (isLinux)
    {
        Console.Error.WriteLine("Linux login uses PAM and the selected Linux account, not --set-admin.");
        Environment.ExitCode = 2;
        return;
    }
    await accounts.ConfigureFromConsoleAsync();
    return;
}
if (!isLinux && !accounts.IsConfigured)
{
    Console.Error.WriteLine("Configure the Windows development account: dotnet run -- --set-admin");
    Environment.ExitCode = 2;
    return;
}
if (isLinux && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("YRM_PANEL_USER")))
{
    Console.Error.WriteLine("YRM_PANEL_USER must be set by the RC4 installer.");
    Environment.ExitCode = 2;
    return;
}

var builder = WebApplication.CreateBuilder(args);
var httpPort = int.TryParse(builder.Configuration["Panel:HttpPort"], out var hp) ? hp : 6080;
var localOnly = builder.Configuration["Panel:Bind"] == "127.0.0.1";
var httpsPort = int.TryParse(builder.Configuration["Panel:HttpsPort"], out var parsedHttpsPort) ? parsedHttpsPort : 6081;
if (isLinux)
{
    if (httpPort is < 1024 or > 65535 || httpsPort is < 1024 or > 65535 || httpPort == httpsPort)
        throw new InvalidOperationException("Invalid HTTP/HTTPS port configuration.");
    var certificate = panelCertificate;
    _ = certificate.Current();
    builder.WebHost.ConfigureKestrel(kestrel =>
    {
        if (localOnly)
        {
            kestrel.ListenLocalhost(httpPort);
            kestrel.ListenLocalhost(httpsPort, endpoint => endpoint.UseHttps(options => options.ServerCertificateSelector = (_, _) => certificate.Current()));
        }
        else
        {
            kestrel.ListenAnyIP(httpPort);
            kestrel.ListenAnyIP(httpsPort, endpoint => endpoint.UseHttps(options => options.ServerCertificateSelector = (_, _) => certificate.Current()));
        }
    });
}
else
{
    builder.WebHost.UseUrls(builder.Configuration["Panel:Url"] ?? "http://127.0.0.1:6080");
}

builder.Services.AddSingleton(accounts);
builder.Services.AddSingleton(panelCertificate);
builder.Services.AddSingleton<LinuxPamAuthenticator>();
builder.Services.AddSingleton<PrivilegedCommandService>();
builder.Services.AddSingleton<UpdateService>();
builder.Services.AddSingleton(new PanelDataPaths(dataRoot));
builder.Services.AddSingleton<PanelSettingsStore>();
builder.Services.AddSingleton<DockerApiService>();
builder.Services.AddSingleton<FileManagerService>();
builder.Services.AddSingleton<MyFoldersStore>();
builder.Services.AddSingleton<StorageManagementService>();
builder.Services.AddSingleton<StorageDeviceService>();
builder.Services.AddSingleton<FirewallService>();
builder.Services.AddSingleton<DdnsService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DdnsService>());
builder.Services.AddSingleton<ServerInfoService>();
builder.Services.AddSingleton<SambaManagementService>();
builder.Services.AddSingleton<SystemdStatusService>();
builder.Services.AddSingleton<SystemPowerService>();
builder.Services.AddSingleton<ISystemMetricsService>(sp =>
    OperatingSystem.IsLinux()
        ? ActivatorUtilities.CreateInstance<LinuxSystemMetricsService>(sp)
        : ActivatorUtilities.CreateInstance<DemoSystemMetricsService>(sp));
builder.Services.AddSingleton<MetricsPublisher>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<MetricsPublisher>());

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
        options.Cookie.SecurePolicy = isLinux ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Events.OnValidatePrincipal = context =>
        {
            var username = context.Principal?.Identity?.Name;
            var stamp = context.Principal?.FindFirst("yrm:credential-stamp")?.Value;
            if (isLinux)
            {
                var selected = Environment.GetEnvironmentVariable("YRM_PANEL_USER");
                if (username != selected || stamp != "linux-pam-v1") context.RejectPrincipal();
            }
            else if (!string.Equals(username, accounts.Username, StringComparison.Ordinal)
                     || !string.Equals(stamp, accounts.SessionStamp, StringComparison.Ordinal))
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
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 4L * 1024 * 1024 * 1024);
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
        RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 8,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0
            }));
});
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4L * 1024 * 1024 * 1024 + 1024 * 1024);
var app = builder.Build();
if (!app.Environment.IsDevelopment()) app.UseExceptionHandler("/Error");

// No blanket HTTP -> HTTPS redirect. An HTTP visit is still accepted, but
// the Linux login (and therefore every sudo password form) requires HTTPS.
// Self-signed certificates display a trust warning until installed/trusted.
app.Use(async (context, next) =>
{
    if (isLinux && !context.Request.IsHttps &&
        (context.Request.Path.StartsWithSegments("/Account/Login") ||
         (context.Request.Path != "/" && !context.Request.Path.StartsWithSegments("/css")
          && !context.Request.Path.StartsWithSegments("/js")
          && !context.Request.Path.StartsWithSegments("/images"))))
    {
        var host = context.Request.Host.Host;
        context.Response.Redirect($"https://{(host.Contains(':') ? "[" + host + "]" : host)}:{httpsPort}{context.Request.Path}{context.Request.QueryString}");
        return;
    }
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "SAMEORIGIN";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
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
app.MapGet("/api/update/status", (UpdateService updates, ServerInfoService info) =>
    Results.Ok(new { progress = updates.Progress, availability = updates.LastCheck, version = info.Get().PanelVersion.Split('+')[0] }))
    .RequireAuthorization();
app.MapGet("/api/metrics", (MetricsPublisher metrics) => Results.Ok(metrics.Current))
    .RequireAuthorization();

app.MapGet("/api/metrics/stream", async (HttpContext context, MetricsPublisher metrics) =>
{
    context.Response.ContentType = "text/event-stream";
    context.Response.Headers["Cache-Control"] = "no-cache, no-transform";
    context.Response.Headers["X-Accel-Buffering"] = "no";
    var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
    try
    {
        while (!context.RequestAborted.IsCancellationRequested)
        {
            await context.Response.WriteAsync("data: " + JsonSerializer.Serialize(metrics.Current, options)
                                              + "\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
            await Task.Delay(1000, context.RequestAborted);
        }
    }
    catch (OperationCanceledException) { /* Client disconnected. */ }
}).RequireAuthorization();

app.MapGet("/wallpaper", (HttpContext context, PanelSettingsStore settings) =>
{
    // Wallpaper URLs carry a file-timestamp version: cache each immutable version
    // privately to avoid re-downloading large wallpapers on every sign-in.
    var version = settings.WallpaperVersion.ToString(System.Globalization.CultureInfo.InvariantCulture);
    context.Response.Headers["Cache-Control"] =
        context.Request.Query["v"].ToString() == version && version != "0"
            ? "private, max-age=31536000, immutable" : "private, no-cache";
    var wallpaper = settings.GetWallpaper();
    return wallpaper is null ? Results.NotFound()
        : Results.File(wallpaper.Value.path, wallpaper.Value.mime, enableRangeProcessing: true);
}).RequireAuthorization();
app.Run();
