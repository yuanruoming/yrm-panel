using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace YrmPanel.Services;

public sealed record DdnsProfile(
    string Id, string Name, string Hostname, string RecordType, string UrlTemplate,
    string HttpMethod, string HeaderName, string Token, string BodyTemplate,
    string SuccessContains, int IntervalMinutes, bool Enabled,
    string LastIp = "", string LastStatus = "Never updated", DateTimeOffset? LastRun = null);
public sealed record DdnsProfileView(string Id, string Name, string Hostname, string RecordType,
    string UrlTemplate, string HttpMethod, string HeaderName, string BodyTemplate,
    string SuccessContains, int IntervalMinutes, bool Enabled, string LastIp,
    string LastStatus, DateTimeOffset? LastRun);

/// <summary>
/// Configurable HTTPS DDNS templates. No arbitrary shell, no redirect following,
/// no requests to local/private/reserved IPs, and no access tokens in UI responses.
/// </summary>
public sealed class DdnsService : BackgroundService
{
    private readonly string _path;
    private readonly ILogger<DdnsService> _logger;
    private readonly SemaphoreSlim _gate = new(1,1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly HttpClient _client;

    public DdnsService(PanelDataPaths paths, ILogger<DdnsService> logger)
    {
        _path = Path.Combine(paths.Root,"ddns-profiles.json");
        _logger = logger;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectTimeout = TimeSpan.FromSeconds(8),
            ConnectCallback = async (context, ct) =>
            {
                // Pin a validated public address for the real connection to prevent DNS rebinding.
                var candidates = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
                foreach (var ip in candidates.Where(IsPublic))
                {
                    var socket = new Socket(ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                    try
                    {
                        await socket.ConnectAsync(new IPEndPoint(ip, context.DnsEndPoint.Port), ct);
                        return new NetworkStream(socket, ownsSocket: true);
                    }
                    catch (Exception ex) when (ex is SocketException or IOException or OperationCanceledException)
                    { socket.Dispose(); }
                }
                throw new IOException("DDNS endpoint did not resolve to a reachable public IP.");
            }
        };
        _client = new HttpClient(handler) { Timeout=TimeSpan.FromSeconds(15) };
        _client.DefaultRequestHeaders.UserAgent.ParseAdd("YRM-Panel-DDNS/1.0");
    }

    private static bool IsPublic(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip) || ip.IsIPv6Multicast || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal)
            return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        var b = ip.GetAddressBytes();
        if (b.Length == 16) return (b[0] & 0xfe) != 0xfc && ip != IPAddress.IPv6None && ip != IPAddress.IPv6Any;
        return b.Length == 4 && b[0] is not (0 or 10 or 127) && b[0] < 224 &&
            !(b[0] == 100 && b[1] is >= 64 and <= 127) &&
            !(b[0] == 169 && b[1] == 254) &&
            !(b[0] == 172 && b[1] is >= 16 and <= 31) &&
            !(b[0] == 192 && b[1] == 168) &&
            !(b[0] == 198 && b[1] is 18 or 19);
    }
    private List<DdnsProfile> ReadUnsafe()
    {
        try { return File.Exists(_path) ? JsonSerializer.Deserialize<List<DdnsProfile>>(File.ReadAllText(_path), Json) ?? [] : []; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        { _logger.LogWarning(ex,"Invalid DDNS profile store"); return []; }
    }
    private void WriteUnsafe(List<DdnsProfile> profiles)
    {
        var temp = _path + ".tmp";
        try
        {
            File.WriteAllText(temp,JsonSerializer.Serialize(profiles,Json));
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            File.Move(temp,_path,true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public async Task<IReadOnlyList<DdnsProfileView>> ListAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try { return ReadUnsafe().Select(p => new DdnsProfileView(p.Id,p.Name,p.Hostname,p.RecordType,
            p.UrlTemplate,p.HttpMethod,p.HeaderName,p.BodyTemplate,p.SuccessContains,p.IntervalMinutes,
            p.Enabled,p.LastIp,p.LastStatus,p.LastRun)).ToArray(); }
        finally { _gate.Release(); }
    }
    public async Task<string> AddAsync(string name,string hostname,string recordType,string url,
        string method,string header,string token,string body,string success,int interval,CancellationToken ct)
    {
        name=(name??"").Trim();hostname=(hostname??"").Trim();url=(url??"").Trim();
        if (name.Length is < 1 or > 50 || !Regex.IsMatch(hostname,@"^[A-Za-z0-9.-]{3,253}$") ||
            recordType is not ("A" or "AAAA") || method is not ("GET" or "POST" or "PUT" or "PATCH") ||
            interval is < 5 or > 1440 || token?.Length > 2048 || header?.Length > 80 || body?.Length > 8000 ||
            success?.Length > 200 || url.Contains("{token}",StringComparison.OrdinalIgnoreCase) ||
            !Uri.TryCreate(url,UriKind.Absolute,out var endpoint) ||
            endpoint.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(endpoint.UserInfo) ||
            endpoint.IsLoopback || !Regex.IsMatch(endpoint.IdnHost,@"^[A-Za-z0-9.-]+$"))
            return "Error: Invalid DDNS profile. Use an HTTPS public API endpoint.";
        if (!string.IsNullOrWhiteSpace(header) && !Regex.IsMatch(header,@"^[A-Za-z0-9-]{1,80}$"))
            return "Error: Invalid HTTP header name.";
        await _gate.WaitAsync(ct);
        try
        {
            var profiles=ReadUnsafe();
            if (profiles.Count>=12) return "Error: Maximum 12 profiles.";
            profiles.Add(new DdnsProfile(Guid.NewGuid().ToString("N"),name,hostname,recordType,url,
                method,header??"Authorization",token??"",body??"",success??"",interval,true));
            WriteUnsafe(profiles);
            return "DDNS profile saved. Test it to verify your provider's API response.";
        }
        finally { _gate.Release(); }
    }
    public async Task<string> RemoveAsync(string id,CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var profiles=ReadUnsafe();
            if (profiles.RemoveAll(p=>p.Id==id)==0) return "Error: Profile not found.";
            WriteUnsafe(profiles); return "DDNS profile deleted.";
        }
        finally { _gate.Release(); }
    }
    public async Task<string> UpdateAsync(string id,bool force,CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var profiles=ReadUnsafe();
            var index=profiles.FindIndex(p=>p.Id==id);
            if (index<0) return "Error: DDNS profile not found.";
            var profile=profiles[index];
            if (!force && (!profile.Enabled || (profile.LastRun is { } last &&
                DateTimeOffset.UtcNow-last<TimeSpan.FromMinutes(profile.IntervalMinutes)))) return "Not due.";
            string status, ip="";
            try
            {
                var lookup=profile.RecordType=="AAAA"?"https://api6.ipify.org":"https://api.ipify.org";
                ip=(await _client.GetStringAsync(lookup,ct)).Trim();
                if (!IPAddress.TryParse(ip,out var parsed) || !IsPublic(parsed) ||
                    (profile.RecordType=="A" && parsed.AddressFamily!=AddressFamily.InterNetwork) ||
                    (profile.RecordType=="AAAA" && parsed.AddressFamily!=AddressFamily.InterNetworkV6))
                    throw new IOException("Public IP detection returned an invalid address.");
                if (!force && ip==profile.LastIp && profile.LastStatus=="Updated")
                {
                    profiles[index]=profile with {LastRun=DateTimeOffset.UtcNow};
                    WriteUnsafe(profiles);
                    return "IP unchanged.";
                }
                string Render(string text) => (text??"").Replace("{ipv4}",profile.RecordType=="A"?ip:"")
                    .Replace("{ipv6}",profile.RecordType=="AAAA"?ip:"")
                    .Replace("{ip}",ip).Replace("{hostname}",profile.Hostname).Replace("{token}",profile.Token);
                var url=Render(profile.UrlTemplate);
                if (!Uri.TryCreate(url,UriKind.Absolute,out var endpoint) || endpoint.Scheme!="https" ||
                    endpoint.IsLoopback || endpoint.HostNameType==UriHostNameType.IPv4 ||
                    endpoint.HostNameType==UriHostNameType.IPv6)
                    throw new IOException("Invalid DDNS API URL.");
                using var request=new HttpRequestMessage(new HttpMethod(profile.HttpMethod),endpoint);
                if (!string.IsNullOrWhiteSpace(profile.HeaderName))
                    request.Headers.TryAddWithoutValidation(profile.HeaderName,Render(profile.Token));
                if (!string.IsNullOrWhiteSpace(profile.BodyTemplate))
                    request.Content=new StringContent(Render(profile.BodyTemplate),Encoding.UTF8,"application/json");
                using var response=await _client.SendAsync(request,ct);
                var text=(await response.Content.ReadAsStringAsync(ct));
                if (!response.IsSuccessStatusCode || (!string.IsNullOrWhiteSpace(profile.SuccessContains) &&
                    !text.Contains(Render(profile.SuccessContains),StringComparison.Ordinal)))
                    throw new IOException($"Provider rejected update (HTTP {(int)response.StatusCode}).");
                status="Updated";
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException or SocketException or InvalidOperationException or ArgumentException)
            { status="Failed: "+ex.Message[..Math.Min(ex.Message.Length,160)]; _logger.LogWarning("DDNS update failed: {Name}",profile.Name); }
            profiles[index]=profile with {LastIp=status=="Updated"?ip:profile.LastIp,LastStatus=status,LastRun=DateTimeOffset.UtcNow};
            WriteUnsafe(profiles);
            return status;
        }
        finally { _gate.Release(); }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30),stoppingToken);
            using var timer=new PeriodicTimer(TimeSpan.FromMinutes(1));
            do
            {
                var profiles=await ListAsync(stoppingToken);
                foreach (var profile in profiles.Where(p=>p.Enabled))
                    await UpdateAsync(profile.Id,false,stoppingToken);
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
