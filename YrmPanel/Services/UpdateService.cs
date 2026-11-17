using System.Runtime.InteropServices;
using System.Text.Json;

namespace YrmPanel.Services;

public sealed record UpdateAvailability(bool Available, bool HasUpdate, string Message,
    string CurrentHash, string LatestHash, string Channel);

public sealed record UpdateProgress(string State, string Message, string? At = null);

public sealed class UpdateService
{
    private const string InstalledHash = "/var/lib/yrm-panel/installed.sha256";
    private const string StatusFile = "/var/lib/yrm-panel/update-status.json";
    private readonly PrivilegedCommandService _commands;
    private readonly ILogger<UpdateService> _logger;
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(12)
    };
    static UpdateService() => Client.DefaultRequestHeaders.UserAgent.ParseAdd("YRM-Panel/RC4");

    public UpdateService(PrivilegedCommandService commands, ILogger<UpdateService> logger)
    {
        _commands = commands;
        _logger = logger;
    }

    public UpdateProgress Progress
    {
        get
        {
            try
            {
                return JsonSerializer.Deserialize<UpdateProgress>(File.ReadAllText(StatusFile),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new("unknown", "Update status unavailable.");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            {
                return new("idle", "No update has been started.");
            }
        }
    }

    public async Task<UpdateAvailability> CheckAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux())
            return new(false, false, "Linux release checks are unavailable in Windows preview.", "", "", "dev");
        var channel = "dev";
        var arch = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "linux-arm64" : "linux-x64";
        var url = $"https://github.com/yuanruoming/yrm-panel/releases/download/{channel}/yrm-panel-{arch}.tar.gz.sha256";
        try
        {
            using var response = await Client.GetAsync(url, ct);
            response.EnsureSuccessStatusCode();
            var value = (await response.Content.ReadAsStringAsync(ct)).Split(' ', '\t', '\n', '\r')[0].Trim();
            if (value.Length != 64 || !value.All(Uri.IsHexDigit))
                throw new IOException("Release checksum is invalid.");
            var current = File.Exists(InstalledHash) ? File.ReadAllText(InstalledHash).Trim() : "";
            return new(true, !string.Equals(current, value, StringComparison.OrdinalIgnoreCase),
                current.Length == 0 ? "Installed checksum unknown; release can be installed."
                  : current.Equals(value, StringComparison.OrdinalIgnoreCase)
                    ? "Current development build is up to date." : "An updated development build is available.",
                current, value, channel);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            _logger.LogWarning(ex, "Update check failed");
            return new(false, false, "Could not reach GitHub Release checksums.", "", "", channel);
        }
    }

    public Task<PrivilegedResult> StartAsync(string? administratorPassword, CancellationToken ct) =>
        _commands.RunAsync("update", "start", [], administratorPassword, null, ct);
}
