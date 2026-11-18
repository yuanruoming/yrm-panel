using System.Runtime.InteropServices;
using System.Text.Json;

namespace YrmPanel.Services;

public sealed record UpdateAvailability(bool Available, bool HasUpdate, string Message,
    string CurrentHash, string LatestHash, string Channel, string Tag = "dev");
public sealed record UpdateProgress(string State, string Message, string? At = null,
    string? Phase = null, int? Percent = null);

/// <summary>Stable uses GitHub latest tagged release; Dev uses the rolling dev build.</summary>
public sealed class UpdateService
{
    private const string InstalledHash = "/var/lib/yrm-panel/installed.sha256";
    private const string StatusFile = "/var/lib/yrm-panel/update-status.json";
    private const string CheckFile = "/var/lib/yrm-panel/update-check.json";
    private readonly PrivilegedCommandService _commands;
    private readonly ILogger<UpdateService> _logger;
    private static readonly HttpClient Client = new() { Timeout=TimeSpan.FromSeconds(15) };
    static UpdateService() => Client.DefaultRequestHeaders.UserAgent.ParseAdd("YRM-Panel/1.0");
    public UpdateService(PrivilegedCommandService commands,ILogger<UpdateService> logger)
    { _commands=commands;_logger=logger; }

    public string Channel => Environment.GetEnvironmentVariable("YRM_PANEL_CHANNEL") == "stable" ? "stable" : "dev";
    public UpdateProgress Progress
    {
        get
        {
            try { return JsonSerializer.Deserialize<UpdateProgress>(File.ReadAllText(StatusFile),
                new JsonSerializerOptions {PropertyNameCaseInsensitive=true}) ?? new("idle","No update started."); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            { return new("idle","No update started."); }
        }
    }
    public UpdateAvailability? LastCheck
    {
        get
        {
            try
            {
                var value=JsonSerializer.Deserialize<UpdateAvailability>(File.ReadAllText(CheckFile));
                if (value is null || value.Channel!=Channel) return null;
                var installed=File.Exists(InstalledHash) ? File.ReadAllText(InstalledHash).Trim() : "";
                if (installed.Length==64 && installed.Equals(value.LatestHash,StringComparison.OrdinalIgnoreCase))
                    return value with {HasUpdate=false,Message="Current release is up to date.",CurrentHash=installed};
                return value;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            { return null; }
        }
    }
    public async Task<UpdateAvailability> CheckAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux())
            return new(false,false,"Release checks require Linux.","","",Channel);
        var arch=RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "linux-arm64" : "linux-x64";
        var tag="dev";
        try
        {
            if (Channel=="stable")
            {
                using var response=await Client.GetAsync(
                    "https://api.github.com/repos/yuanruoming/yrm-panel/releases/latest",ct);
                response.EnsureSuccessStatusCode();
                using var data=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                tag=data.RootElement.GetProperty("tag_name").GetString() ?? "";
                if (!System.Text.RegularExpressions.Regex.IsMatch(tag,@"^v\d+\.\d+\.\d+$"))
                    throw new IOException("No valid stable version tag was found.");
            }
            var url=$"https://github.com/yuanruoming/yrm-panel/releases/download/{tag}/yrm-panel-{arch}.tar.gz.sha256";
            using var checksum=await Client.GetAsync(url,ct);
            checksum.EnsureSuccessStatusCode();
            var raw=await checksum.Content.ReadAsStringAsync(ct);
            var value=raw.Split(' ','\t','\n','\r')[0].Trim();
            if (value.Length!=64 || !value.All(Uri.IsHexDigit))
                throw new IOException("Release checksum is invalid.");
            var current=File.Exists(InstalledHash) ? File.ReadAllText(InstalledHash).Trim() : "";
            var update=!current.Equals(value,StringComparison.OrdinalIgnoreCase);
            var result=new UpdateAvailability(true,update,
                update?$"New {Channel} build available ({tag}).":$"You're up to date ({tag}).",
                current,value,Channel,tag);
            File.WriteAllText(CheckFile,JsonSerializer.Serialize(result));
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(CheckFile,UnixFileMode.UserRead|UnixFileMode.UserWrite);
            return result;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or JsonException)
        {
            _logger.LogWarning(ex,"Update check failed");
            return new(false,false,"Cannot check release assets. Verify GitHub access.","","",Channel,tag);
        }
    }
    public Task<PrivilegedResult> StartAsync(string? administratorPassword,CancellationToken ct) =>
        LastCheck?.HasUpdate != true
            ? Task.FromResult(new PrivilegedResult(false,"Check for an available update before installing."))
            : _commands.RunAsync("update","start",[],administratorPassword,null,ct);
}
