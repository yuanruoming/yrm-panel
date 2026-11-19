using System.Net;
using System.Net.Http.Headers;
using System.Net.NetworkInformation;
using System.Diagnostics;
using System.Threading.Channels;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace YrmPanel.Services;

// New optional fields must remain optional: existing BETA4 JSON profiles are kept intact.
public sealed record DdnsProfile(
    string Id, string Name, string Hostname, string RecordType, string UrlTemplate,
    string HttpMethod, string HeaderName, string Token, string BodyTemplate,
    string SuccessContains, int IntervalMinutes, bool Enabled,
    string LastIp = "", string LastStatus = "Never updated", DateTimeOffset? LastRun = null,
    string DetectionUrl = "", string AuthType = "header", string Username = "",
    string ResponseMode = "legacy", string SuccessCodes = "", string UnchangedCodes = "",
    string ErrorCodes = "", string JsonProperty = "", string JsonExpected = "true",
    bool VerifyDns = true, string LastDnsIp = "", string Verification = "Not checked",
    DateTimeOffset? NextAttemptAt = null, int ConsecutiveFailures = 0,
    string Provider = "custom", string IpSource = "public", string ManualIp = "", string InterfaceName = "");

public sealed record DdnsProfileView(
    string Id, string Name, string Hostname, string RecordType, string UrlTemplate,
    string HttpMethod, string HeaderName, string BodyTemplate, string SuccessContains,
    int IntervalMinutes, bool Enabled, string LastIp, string LastStatus,
    DateTimeOffset? LastRun, string DetectionUrl, string AuthType,
    string ResponseMode, string SuccessCodes, string UnchangedCodes,
    string ErrorCodes, string JsonProperty, string JsonExpected,
    bool VerifyDns, string LastDnsIp, string Verification, DateTimeOffset? NextAttemptAt,
    string Provider, string Username, string IpSource, string ManualIp, string InterfaceName);

public sealed record DdnsProfileOptions(
    string DetectionUrl = "", string AuthType = "header", string Username = "",
    string ResponseMode = "codes", string SuccessCodes = "good",
    string UnchangedCodes = "nochg", string ErrorCodes = "badauth,nohost,notfqdn,unknown,servererror,911",
    string JsonProperty = "success", string JsonExpected = "true", bool VerifyDns = true,
    string Provider = "custom");

/// <summary>
/// Single-request DDNS client with explicit response rules, IP detection and DNS checks.
/// Every outbound HTTPS connection pins a public DNS result: do not use this for LAN endpoints.
/// </summary>
public sealed class DdnsService : BackgroundService
{
    private readonly string _path;
    private readonly ILogger<DdnsService> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly Regex HostPattern = new(@"^(?=.{3,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])$", RegexOptions.CultureInvariant);
    private readonly HttpClient _client;
    private readonly CloudflareDdnsClient _cloudflare;
    private readonly Channel<bool> _wake = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    { SingleReader = true, SingleWriter = false, FullMode = BoundedChannelFullMode.DropOldest });

    public DdnsService(PanelDataPaths paths, ILogger<DdnsService> logger)
    {
        _path = Path.Combine(paths.Root, "ddns-profiles.json");
        _logger = logger;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectTimeout = TimeSpan.FromSeconds(8),
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            ConnectCallback = async (context, ct) =>
            {
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
                    {
                        socket.Dispose();
                        if (ct.IsCancellationRequested) throw;
                    }
                }
                throw new IOException("HTTPS endpoint does not resolve to a reachable public IP.");
            }
        };
        _client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
        _client.DefaultRequestHeaders.UserAgent.ParseAdd("YRM-Panel-DDNS/1.0");
        _cloudflare = new CloudflareDdnsClient(_client);
    }

    private static bool IsPublic(IPAddress value)
    {
        if (IPAddress.IsLoopback(value) || value.Equals(IPAddress.Any) || value.Equals(IPAddress.None)
            || value.Equals(IPAddress.IPv6Any) || value.Equals(IPAddress.IPv6None)
            || value.IsIPv6Multicast || value.IsIPv6LinkLocal || value.IsIPv6SiteLocal)
            return false;
        if (value.IsIPv4MappedToIPv6) value = value.MapToIPv4();
        var b = value.GetAddressBytes();
        if (b.Length == 16)
            return (b[0] & 0xfe) != 0xfc && b[0] != 0xff && !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8);
        if (b.Length != 4 || b[0] is 0 or 10 or 127 || b[0] >= 224) return false;
        if (b[0] == 100 && b[1] is >= 64 and <= 127) return false;
        if (b[0] == 169 && b[1] == 254) return false;
        if (b[0] == 172 && b[1] is >= 16 and <= 31) return false;
        if (b[0] == 192 && (b[1] == 168 || (b[1] == 0 && b[2] == 0) || (b[1] == 0 && b[2] == 2))) return false;
        if (b[0] == 198 && (b[1] is 18 or 19 || (b[1] == 51 && b[2] == 100))) return false;
        if (b[0] == 203 && b[1] == 0 && b[2] == 113) return false;
        return true;
    }

    private static bool ValidPublicHttps(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
               && uri.Scheme == Uri.UriSchemeHttps && uri.Port is >= 1 and <= 65535
               && !uri.IsLoopback && uri.HostNameType == UriHostNameType.Dns
               && string.IsNullOrEmpty(uri.UserInfo) && HostPattern.IsMatch(uri.IdnHost)
               && !value.Contains("{token}", StringComparison.OrdinalIgnoreCase)
               && !value.Contains('#');
    }

    private List<DdnsProfile> ReadUnsafe()
    {
        try { return File.Exists(_path) ? JsonSerializer.Deserialize<List<DdnsProfile>>(File.ReadAllText(_path), Json) ?? [] : []; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        { _logger.LogWarning(ex, "Invalid DDNS profile store"); return []; }
    }

    private void WriteUnsafe(List<DdnsProfile> profiles)
    {
        var temp = _path + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(profiles, Json));
            if (OperatingSystem.IsLinux())
                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            File.Move(temp, _path, true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    public async Task<IReadOnlyList<DdnsProfileView>> ListAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return ReadUnsafe().Select(p => new DdnsProfileView(
                p.Id, p.Name, p.Hostname, p.RecordType, p.UrlTemplate, p.HttpMethod,
                p.HeaderName, p.BodyTemplate, p.SuccessContains, p.IntervalMinutes,
                p.Enabled, p.LastIp, p.LastStatus, p.LastRun, p.DetectionUrl, p.AuthType,
                p.ResponseMode, p.SuccessCodes, p.UnchangedCodes, p.ErrorCodes,
                p.JsonProperty, p.JsonExpected, p.VerifyDns, p.LastDnsIp,
                p.Verification, p.NextAttemptAt, p.Provider, p.Username, p.IpSource, p.ManualIp, p.InterfaceName)).ToArray();
        }
        finally { _gate.Release(); }
    }

    public async Task<string> AddAsync(string name, string hostname, string recordType, string url,
        string method, string header, string token, string body, string success,
        int interval, CancellationToken ct, DdnsProfileOptions? options = null)
    {
        options ??= new DdnsProfileOptions();
        name = (name ?? "").Trim(); hostname = (hostname ?? "").Trim(); url = (url ?? "").Trim();
        var provider = (options.Provider ?? "custom").Trim().ToLowerInvariant();
        var detect = (options.DetectionUrl ?? "").Trim();
        var auth = (options.AuthType ?? "header").ToLowerInvariant();
        var mode = (options.ResponseMode ?? "codes").ToLowerInvariant();
        if (name.Length is < 1 or > 50) return "Error: Enter a profile name (maximum 50 characters).";
        if (!HostPattern.IsMatch(hostname) || !hostname.Contains('.'))
            return "Error: Enter a complete DNS hostname, such as nas.example.com.";
        if (recordType is not ("A" or "AAAA")) return "Error: Choose IPv4 (A) or IPv6 (AAAA).";
        if (interval is < 5 or > 1440) return "Error: The interval must be between 5 and 1440 minutes.";
        if (detect.Length != 0 && !ValidPublicHttps(detect))
            return "Error: Custom IP detection needs a public HTTPS URL.";
        if (provider is not ("dynu" or "cloudflare" or "custom"))
            return "Error: Unsupported DDNS provider type.";
        if ((token?.Length ?? 0) > 2048 || (body?.Length ?? 0) > 8000 || (success?.Length ?? 0) > 200)
            return "Error: DDNS credential or request body is too long.";
        if (provider == "cloudflare")
        {
            if (string.IsNullOrWhiteSpace(token)) return "Error: Enter a Cloudflare API Token.";
            url = "https://api.cloudflare.com/client/v4/zones";
            method = "PATCH"; auth = "bearer"; mode = "json";
            header = "Authorization"; body = "";
        }
        else
        {
            if (method is not ("GET" or "POST" or "PUT" or "PATCH")) return "Error: Unsupported HTTP method.";
            if (!ValidPublicHttps(url)) return "Error: Provider API URL must be a valid public HTTPS address.";
            if (auth is not ("none" or "header" or "basic" or "bearer")) return "Error: Choose an authentication type.";
            if (auth == "basic" && string.IsNullOrWhiteSpace(options.Username))
                return "Error: Username is required for HTTP Basic authentication.";
            if (auth != "none" && string.IsNullOrWhiteSpace(token))
                return "Error: Enter the DDNS password or API token.";
            if ((header?.Length ?? 0) > 80 || !Regex.IsMatch(header ?? "Authorization", @"^[A-Za-z0-9-]{1,80}$"))
                return "Error: Invalid HTTP header name.";
            if (mode is not ("codes" or "json" or "http") || !ValidResponseOptions(options))
                return "Error: Check the success/unchanged response rules in Advanced settings.";
        }
        if ((options.Username?.Length ?? 0) > 120) return "Error: DDNS username is too long.";
        await _gate.WaitAsync(ct);
        try
        {
            var profiles = ReadUnsafe();
            if (profiles.Count >= 12) return "Error: Maximum 12 profiles.";
            profiles.Add(new DdnsProfile(Guid.NewGuid().ToString("N"), name, hostname, recordType,
                url, method, header ?? "Authorization", token ?? "", body ?? "", success ?? "",
                interval, true, DetectionUrl: detect, AuthType: auth,
                Username: options.Username ?? "", ResponseMode: mode,
                SuccessCodes: options.SuccessCodes ?? "", UnchangedCodes: options.UnchangedCodes ?? "",
                ErrorCodes: options.ErrorCodes ?? "", JsonProperty: options.JsonProperty ?? "",
                JsonExpected: options.JsonExpected ?? "true", VerifyDns: options.VerifyDns,
                Provider: provider));
            WriteUnsafe(profiles);
            return "DDNS profile saved. Use Detect IP, then Update Now to verify the provider.";
        }
        finally { _gate.Release(); }
    }

    private static bool ValidResponseOptions(DdnsProfileOptions options)
    {
        static bool Codes(string? values) => values is not null && values.Length <= 400
            && values.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .All(c => Regex.IsMatch(c, @"^[A-Za-z0-9_-]{1,32}$"));
        return Codes(options.SuccessCodes) && Codes(options.UnchangedCodes)
            && Codes(options.ErrorCodes)
            && (options.ResponseMode != "codes" || !string.IsNullOrWhiteSpace(options.SuccessCodes))
            && (options.JsonProperty?.Length ?? 0) <= 120
            && (options.JsonExpected?.Length ?? 0) <= 120
            && (options.ResponseMode != "json" ||
                (Regex.IsMatch(options.JsonProperty ?? "", @"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,3}$")
                && !string.IsNullOrWhiteSpace(options.JsonExpected)));
    }

    public async Task<string> EditAsync(string id, string name, string hostname,
        string username, string newToken, string ipSource, string manualIp, string interfaceName,
        int interval, bool enabled, CancellationToken ct,
        string? apiUrl = null, string? method = null, string? authType = null,
        string? header = null, string? body = null, string? responseMode = null,
        string? successCodes = null, string? unchangedCodes = null,
        string? errorCodes = null, string? jsonProperty = null, string? jsonExpected = null)
    {
        name = (name ?? "").Trim(); hostname = (hostname ?? "").Trim().ToLowerInvariant();
        username = (username ?? "").Trim(); newToken ??= "";
        ipSource = (ipSource ?? "public").Trim().ToLowerInvariant();
        manualIp = (manualIp ?? "").Trim(); interfaceName = (interfaceName ?? "").Trim();
        if (name.Length is < 1 or > 50) return "Error: Profile name must contain 1–50 characters.";
        if (!HostPattern.IsMatch(hostname) || !hostname.Contains('.')) return "Error: Enter a valid complete DNS hostname.";
        if (interval is < 5 or > 1440) return "Error: DDNS check interval must be 5–1440 minutes.";
        if (username.Length > 120 || newToken.Length > 2048) return "Error: DDNS credential is too long.";
        if (ipSource is not ("public" or "manual" or "interface" or "disabled"))
            return "Error: Invalid address source.";
        await _gate.WaitAsync(ct);
        try
        {
            var profiles = ReadUnsafe();
            var index = profiles.FindIndex(x => x.Id == id);
            if (index < 0) return "Error: DDNS profile no longer exists.";
            var old = profiles[index];
            if (old.Provider == "dynu" && string.IsNullOrWhiteSpace(username))
                return "Error: Dynu username is required.";
            if (ipSource == "manual")
            {
                if (!IPAddress.TryParse(manualIp, out var manual) ||
                    manual.AddressFamily != (old.RecordType == "AAAA" ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork))
                    return "Error: Enter a valid manual IP address for this record type.";
            }
            if (ipSource == "interface")
            {
                if (interfaceName.Length == 0 || interfaceName.Length > 90 ||
                    !NetworkInterface.GetAllNetworkInterfaces().Any(n => n.Name == interfaceName))
                    return "Error: Select an available network interface.";
            }
            if (old.Provider == "custom")
            {
                var url = (apiUrl ?? "").Trim();
                var requestMethod = (method ?? "").Trim().ToUpperInvariant();
                var auth = (authType ?? "").Trim().ToLowerInvariant();
                var mode = (responseMode ?? "").Trim().ToLowerInvariant();
                var opts = new DdnsProfileOptions(ResponseMode: mode,
                    SuccessCodes: successCodes ?? "", UnchangedCodes: unchangedCodes ?? "",
                    ErrorCodes: errorCodes ?? "", JsonProperty: jsonProperty ?? "",
                    JsonExpected: jsonExpected ?? "");
                if (!ValidPublicHttps(url) || requestMethod is not ("GET" or "POST" or "PUT" or "PATCH")
                    || auth is not ("none" or "header" or "basic" or "bearer")
                    || mode is not ("codes" or "json" or "http") || !ValidResponseOptions(opts)
                    || (header?.Length ?? 0) > 80 || !Regex.IsMatch(header ?? "Authorization", @"^[A-Za-z0-9-]{1,80}$")
                    || (body?.Length ?? 0) > 8000)
                    return "Error: Invalid Custom HTTPS API settings.";
                if (auth == "basic" && string.IsNullOrWhiteSpace(username))
                    return "Error: HTTP Basic needs a username.";
                if (auth != "none" && string.IsNullOrEmpty(newToken) && string.IsNullOrEmpty(old.Token))
                    return "Error: Enter a Custom API credential.";
                // Settings below are stored with the profile and do not change the selected provider.
                profiles[index] = old with {
                    UrlTemplate = url, HttpMethod = requestMethod, AuthType = auth,
                    HeaderName = header ?? "Authorization", BodyTemplate = body ?? "",
                    ResponseMode = mode, SuccessCodes = successCodes ?? "",
                    UnchangedCodes = unchangedCodes ?? "", ErrorCodes = errorCodes ?? "",
                    JsonProperty = jsonProperty ?? "", JsonExpected = jsonExpected ?? ""
                };
            }
            var changed = !old.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase)
                || old.IpSource != ipSource || old.ManualIp != manualIp || old.InterfaceName != interfaceName
                || newToken.Length > 0 || old.Username != username
                || (old.Provider == "custom" && (old.UrlTemplate != apiUrl || old.HttpMethod != method
                    || old.AuthType != authType || old.HeaderName != header || old.BodyTemplate != body
                    || old.ResponseMode != responseMode || old.SuccessCodes != successCodes
                    || old.UnchangedCodes != unchangedCodes || old.ErrorCodes != errorCodes));
            profiles[index] = profiles[index] with
            {
                Name = name, Hostname = hostname, Username = old.Provider == "cloudflare" ? old.Username : username,
                Token = newToken.Length > 0 ? newToken : old.Token,
                IntervalMinutes = interval, Enabled = enabled,
                IpSource = ipSource, ManualIp = ipSource == "manual" ? manualIp : "",
                InterfaceName = ipSource == "interface" ? interfaceName : "",
                LastIp = changed ? "" : old.LastIp,
                LastDnsIp = changed ? "" : old.LastDnsIp,
                LastStatus = changed ? "Never updated" : old.LastStatus,
                Verification = changed ? "Not checked" : old.Verification,
                LastRun = changed ? null : old.LastRun,
                ConsecutiveFailures = changed ? 0 : old.ConsecutiveFailures,
                NextAttemptAt = changed ? null : old.NextAttemptAt
            };
            WriteUnsafe(profiles);
            return "DDNS settings saved.";
        }
        finally { _gate.Release(); }
    }

    public async Task<string> TestConnectionAsync(string id, CancellationToken ct)
    {
        DdnsProfile? profile;
        await _gate.WaitAsync(ct);
        try { profile = ReadUnsafe().FirstOrDefault(p => p.Id == id); }
        finally { _gate.Release(); }
        if (profile is null) return "Error: DDNS profile was not found.";
        if (profile.Provider != "cloudflare")
            return await UpdateAsync(id, true, ct); // Dynu/Custom: an authenticated test may update the record.
        try
        {
            var record = await _cloudflare.ReadRecordAsync(profile, ct);
            return $"Cloudflare connection verified. {record.Type} record exists (read-only test).";
        }
        catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException
            or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            if (ct.IsCancellationRequested) throw;
            return "Error: Cloudflare connection test failed. " + ex.Message[..Math.Min(ex.Message.Length, 120)];
        }
    }

    public async Task<string> ToggleAsync(string id, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var profiles = ReadUnsafe();
            var index = profiles.FindIndex(p => p.Id == id);
            if (index < 0) return "Error: Profile not found.";
            var profile = profiles[index];
            profiles[index] = profile with { Enabled = !profile.Enabled };
            WriteUnsafe(profiles);
            return profile.Enabled ? "DDNS profile paused." : "DDNS profile resumed.";
        }
        finally { _gate.Release(); }
    }

    public async Task<string> RemoveAsync(string id, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var profiles = ReadUnsafe();
            if (profiles.RemoveAll(p => p.Id == id) == 0) return "Error: Profile not found.";
            WriteUnsafe(profiles);
            return "DDNS profile deleted.";
        }
        finally { _gate.Release(); }
    }

    private static string Render(string template, DdnsProfile profile, string ip, bool isUrl)
    {
        var value = isUrl ? Uri.EscapeDataString(ip) : ip;
        var hostname = isUrl ? Uri.EscapeDataString(profile.Hostname) : profile.Hostname;
        return (template ?? "").Replace("{ip}", value, StringComparison.OrdinalIgnoreCase)
            .Replace("{ipv4}", profile.RecordType == "A" ? value : "", StringComparison.OrdinalIgnoreCase)
            .Replace("{ipv6}", profile.RecordType == "AAAA" ? value : "", StringComparison.OrdinalIgnoreCase)
            .Replace("{hostname}", hostname, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string> ReadLimitedAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.Content.Headers.ContentLength > 8192)
            throw new IOException("DDNS response is too large.");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var bytes = new byte[1024];
        while (true)
        {
            var count = await stream.ReadAsync(bytes.AsMemory(0, bytes.Length), ct);
            if (count == 0) break;
            if (buffer.Length + count > 8192) throw new IOException("DDNS response is too large.");
            buffer.Write(bytes, 0, count);
        }
        return Encoding.UTF8.GetString(buffer.ToArray()).Trim();
    }

    private async Task<string> FetchTextAsync(string url, CancellationToken ct)
    {
        if (!ValidPublicHttps(url)) throw new IOException("Only public HTTPS addresses are accepted.");
        using var response = await _client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new IOException($"IP detection returned HTTP {(int)response.StatusCode}.");
        return await ReadLimitedAsync(response, ct);
    }

    private async Task<string> DetectIpAsync(DdnsProfile profile, CancellationToken ct)
    {
        if (profile.IpSource == "disabled")
            throw new IOException("Address family disabled for this profile.");
        if (profile.IpSource == "manual")
        {
            if (!IPAddress.TryParse(profile.ManualIp, out var manual) ||
                manual.AddressFamily != (profile.RecordType == "AAAA" ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork))
                throw new IOException("Manual address is not valid for the selected DNS record type.");
            return manual.ToString();
        }
        if (profile.IpSource == "interface")
        {
            var adapter = NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(n =>
                n.Name.Equals(profile.InterfaceName, StringComparison.Ordinal));
            if (adapter is null) throw new IOException("Selected network interface is unavailable.");
            var family = profile.RecordType == "AAAA" ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork;
            var candidates = adapter.GetIPProperties().UnicastAddresses.Select(a => a.Address)
                .Where(a => a.AddressFamily == family && !IPAddress.IsLoopback(a)
                    && !a.IsIPv6LinkLocal && !a.IsIPv6Multicast).ToArray();
            if (candidates.Length != 1) throw new IOException("Network interface must have exactly one eligible address for this record type.");
            return candidates[0].ToString();
        }
        var urls = !string.IsNullOrWhiteSpace(profile.DetectionUrl)
            ? new[] { profile.DetectionUrl }
            : profile.RecordType == "AAAA"
                ? new[] { "https://api6.ipify.org", "https://ipv6.icanhazip.com" }
                : new[] { "https://api.ipify.org", "https://ipv4.icanhazip.com" };
        foreach (var url in urls)
        {
            try
            {
                var raw = await FetchTextAsync(url, ct);
                if (IPAddress.TryParse(raw, out var parsed) && IsPublic(parsed)
                    && parsed.AddressFamily == (profile.RecordType == "AAAA"
                        ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork))
                    return parsed.ToString();
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException
                or SocketException or ArgumentException)
            {
                if (ct.IsCancellationRequested) throw;
                _logger.LogDebug("DDNS IP detection source unavailable: {Type}", ex.GetType().Name);
            }
        }
        throw new IOException("Could not detect a valid public " + (profile.RecordType == "AAAA" ? "IPv6" : "IPv4") + ". Check your server's actual internet exit.");
    }

    public async Task<string> DetectAsync(string id, CancellationToken ct)
    {
        DdnsProfile? profile;
        await _gate.WaitAsync(ct);
        try { profile = ReadUnsafe().FirstOrDefault(p => p.Id == id); }
        finally { _gate.Release(); }
        if (profile is null) return "Error: Profile not found.";
        try
        {
            var ip = await DetectIpAsync(profile, ct);
            return $"Detected public {profile.RecordType}: {ip} (provider was not updated).";
        }
        catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException or SocketException)
        { return "Error: " + ex.Message; }
    }

    private async Task<(string ip, string status)> VerifyDnsAsync(DdnsProfile profile, string expected, CancellationToken ct)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            var addresses = await Dns.GetHostAddressesAsync(profile.Hostname, timeout.Token);
            var match = addresses.Where(a => a.AddressFamily == (profile.RecordType == "AAAA"
                ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork))
                .Select(a => a.ToString()).Distinct().ToArray();
            if (match.Length == 0) return ("", "No matching DNS record yet");
            return (string.Join(", ", match.Take(4)), match.Contains(expected, StringComparer.OrdinalIgnoreCase)
                ? "Verified" : "Waiting for DNS / proxy resolution");
        }
        catch (Exception ex) when (ex is SocketException or TaskCanceledException or ArgumentException)
        {
            if (ct.IsCancellationRequested) throw;
            return ("", "DNS lookup unavailable");
        }
    }

    public async Task<string> VerifyAsync(string id, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var profiles = ReadUnsafe();
            var index = profiles.FindIndex(p => p.Id == id);
            if (index < 0) return "Error: Profile not found.";
            var profile = profiles[index];
            if (string.IsNullOrWhiteSpace(profile.LastIp)) return "Detect and update an IP first.";
            try
            {
                var result = await VerifyProfileAsync(profile, profile.LastIp, ct);
                profiles[index] = profile with { LastDnsIp = result.ip, Verification = result.status };
                WriteUnsafe(profiles);
                return result.status + (result.ip.Length > 0 ? " · DNS: " + result.ip : "");
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException
                or JsonException or InvalidOperationException or KeyNotFoundException)
            { return "Error: " + ex.Message; }
        }
        finally { _gate.Release(); }
    }

    private static bool CodeMatch(string codes, string responseCode) =>
        codes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(s => s.Equals(responseCode, StringComparison.OrdinalIgnoreCase));

    private static string Classify(DdnsProfile profile, string text, bool httpSuccess, string expectedIp)
    {
        if (!httpSuccess) return "Failed";
        if (profile.ResponseMode == "http") return "Updated";
        if (profile.ResponseMode == "json")
        {
            try
            {
                using var doc = JsonDocument.Parse(text);
                var token = doc.RootElement;
                foreach (var part in profile.JsonProperty.Split('.', StringSplitOptions.RemoveEmptyEntries))
                {
                    if (token.ValueKind != JsonValueKind.Object || !token.TryGetProperty(part, out var next)) return "Failed";
                    token = next;
                }
                return token.ToString().Equals(profile.JsonExpected, StringComparison.OrdinalIgnoreCase) ? "Updated" : "Failed";
            }
            catch (JsonException) { return "Failed"; }
        }
        if (profile.ResponseMode == "legacy")
            return !string.IsNullOrWhiteSpace(profile.SuccessContains)
                && text.Contains(profile.SuccessContains, StringComparison.Ordinal) ? "Updated" : "Failed";
        // Explicit, first-token matching, not a substring that might accept "notgood".
        var words = text.Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries);
        var code = words.FirstOrDefault() ?? "";
        if (CodeMatch(profile.ErrorCodes, code)) return "Failed";
        var success = CodeMatch(profile.SuccessCodes, code);
        var unchanged = CodeMatch(profile.UnchangedCodes, code);
        if (!success && !unchanged) return "Failed";
        // Some DynDNS providers append the IP they accepted; reject a different one.
        if (words.Length > 1 && IPAddress.TryParse(words[1].Trim(), out var returned)
            && !returned.ToString().Equals(expectedIp, StringComparison.OrdinalIgnoreCase))
            return "Failed";
        return unchanged ? "Unchanged" : "Updated";
    }

    public async Task<string> UpdateAsync(string id, bool force, CancellationToken ct, bool networkTriggered = false)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var profiles = ReadUnsafe();
            var index = profiles.FindIndex(p => p.Id == id);
            if (index < 0) return "Error: DDNS profile not found.";
            var profile = profiles[index];
            if (force && profile.NextAttemptAt is { } cooldown && DateTimeOffset.UtcNow < cooldown
                && profile.LastStatus.Contains("911", StringComparison.Ordinal))
                return "Provider requested a temporary cooldown; retry later.";
            if (profile.IpSource == "disabled") return "IP family disabled.";
            if (!force && (!profile.Enabled
                || (profile.NextAttemptAt is { } next && DateTimeOffset.UtcNow < next)
                || (!networkTriggered && profile.LastRun is { } last &&
                    DateTimeOffset.UtcNow - last < TimeSpan.FromMinutes(profile.IntervalMinutes))))
                return "Not due.";
            var now = DateTimeOffset.UtcNow;
            var status = "Failed"; var ip = ""; var dnsIp = profile.LastDnsIp;
            var verification = profile.Verification; var responseCode = "";
            try
            {
                ip = await DetectIpAsync(profile, ct);
                if (profile.Provider == "cloudflare")
                {
                    // Query the actual Cloudflare record even if our last observed IP
                    // has not changed: remote DNS edits should also be corrected.
                    var record = await _cloudflare.ReadRecordAsync(profile, ct);
                    status = await _cloudflare.UpdateRecordAsync(profile, record, ip, ct);
                }
                else if (ip == profile.LastIp && (profile.LastStatus is "Updated" or "Unchanged" or "IP unchanged"))
                {
                    status = "IP unchanged";
                }
                else
                {
                    var endpointText = Render(profile.UrlTemplate, profile, ip, isUrl: true);
                    if (!ValidPublicHttps(endpointText)) throw new IOException("Invalid DDNS API endpoint.");
                    using var request = new HttpRequestMessage(new HttpMethod(profile.HttpMethod), endpointText);
                    if (profile.AuthType == "basic")
                    {
                        var credential = Convert.ToBase64String(Encoding.UTF8.GetBytes(profile.Username + ":" + profile.Token));
                        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credential);
                    }
                    else if (profile.AuthType == "bearer")
                    {
                        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", profile.Token);
                    }
                    else if (profile.AuthType == "header" && !string.IsNullOrWhiteSpace(profile.HeaderName))
                    {
                        if (!request.Headers.TryAddWithoutValidation(profile.HeaderName, profile.Token))
                            throw new IOException("Invalid authentication header.");
                    }
                    if (!string.IsNullOrWhiteSpace(profile.BodyTemplate))
                        request.Content = new StringContent(Render(profile.BodyTemplate, profile, ip, isUrl: false), Encoding.UTF8, "application/json");
                    using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                    var responseText = await ReadLimitedAsync(response, ct);
                    status = Classify(profile, responseText, response.IsSuccessStatusCode, ip);
                    responseCode = responseText.Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
                    if (status == "Failed")
                    {
                        var safeCode = Regex.IsMatch(responseCode, @"^[A-Za-z0-9_-]{1,32}$") ? responseCode : "unknown";
                        throw new IOException($"Provider rejected the update: {safeCode} (HTTP {(int)response.StatusCode}).");
                    }
                }
                if (profile.VerifyDns)
                {
                    var dns = await VerifyProfileAsync(profile, ip, ct);
                    dnsIp = dns.ip; verification = dns.status;
                }
                else verification = "Disabled";
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException
                or SocketException or InvalidOperationException or ArgumentException or JsonException
                or KeyNotFoundException)
            {
                if (ct.IsCancellationRequested) throw;
                status = "Failed: " + ex.Message[..Math.Min(ex.Message.Length, 140)];
                _logger.LogWarning("DDNS update failed: {Name}", profile.Name);
            }
            var succeeded = status is "Updated" or "Unchanged" or "IP unchanged";
            var failures = succeeded ? 0 : Math.Min(profile.ConsecutiveFailures + 1, 8);
            // Service errors must not be retried in a rapid loop. Dynu 911 asks for a longer wait.
            var retry = responseCode.Equals("911", StringComparison.OrdinalIgnoreCase)
                ? TimeSpan.FromMinutes(30)
                : TimeSpan.FromMinutes(Math.Min(120, profile.IntervalMinutes * (1 << Math.Min(failures, 4))));
            profiles[index] = profile with
            {
                LastIp = succeeded ? ip : profile.LastIp,
                LastStatus = status, LastRun = now,
                LastDnsIp = dnsIp, Verification = verification,
                ConsecutiveFailures = failures,
                NextAttemptAt = succeeded ? null : now + retry
            };
            WriteUnsafe(profiles);
            return status + (succeeded && profile.VerifyDns ? " · DNS: " + verification : "");
        }
        finally { _gate.Release(); }
    }

    private async Task<(string ip, string status)> VerifyProfileAsync(
        DdnsProfile profile, string expected, CancellationToken ct)
    {
        if (profile.Provider != "cloudflare")
            return await VerifyDnsAsync(profile, expected, ct);
        // Proxied Cloudflare A/AAAA records resolve to Cloudflare edge IPs.
        // The API's source record content is the authoritative verification.
        var record = await _cloudflare.ReadRecordAsync(profile, ct);
        return (record.Content, record.Content.Equals(expected, StringComparison.OrdinalIgnoreCase)
            ? "Verified (Cloudflare API)" : "DNS record differs from detected IP");
    }

    private void SignalNetworkChange()
    {
        // Bounded capacity coalesces Netlink bursts (Docker, VPN, DHCP).
        _wake.Writer.TryWrite(true);
    }

    private static string? IpTool()
    {
        if (File.Exists("/usr/sbin/ip")) return "/usr/sbin/ip";
        if (File.Exists("/usr/bin/ip")) return "/usr/bin/ip";
        if (File.Exists("/sbin/ip")) return "/sbin/ip";
        return null;
    }

    private async Task MonitorRoutesAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux() || IpTool() is not { } binary) return;
        // ip monitor is a read-only rtnetlink subscriber; never needs root.
        // It complements .NET address/availability events with route changes.
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var process = new Process
                {
                    StartInfo = new ProcessStartInfo(binary)
                    {
                        RedirectStandardOutput = true, RedirectStandardError = false,
                        UseShellExecute = false, CreateNoWindow = true
                    }
                };
                process.StartInfo.ArgumentList.Add("monitor");
                process.StartInfo.ArgumentList.Add("address");
                process.StartInfo.ArgumentList.Add("route");
                process.StartInfo.ArgumentList.Add("link");
                if (!process.Start()) throw new IOException("Cannot start ip route monitor.");
                try
                {
                    while (!ct.IsCancellationRequested)
                    {
                        var line = await process.StandardOutput.ReadLineAsync(ct);
                        if (line is null) break;
                        SignalNetworkChange();
                    }
                }
                finally
                {
                    try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
                    catch (InvalidOperationException) { /* Process already exited. */ }
                    await process.WaitForExitAsync(CancellationToken.None);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception ex) when (ex is IOException or InvalidOperationException
                or System.ComponentModel.Win32Exception)
            { _logger.LogWarning(ex, "DDNS route monitor unavailable; timer remains active"); }
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
        }
    }

    private async Task TickAsync(bool networkTriggered, CancellationToken ct)
    {
        var profiles = await ListAsync(ct);
        foreach (var profile in profiles.Where(p => p.Enabled))
        {
            try { await UpdateAsync(profile.Id, false, ct, networkTriggered); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) { _logger.LogWarning(ex, "DDNS profile check failed"); }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Address changes and IP route changes wake up the same update engine;
        // a periodic timer remains mandatory for NAT/WAN IP changes that do not
        // generate local network events.
        void OnAddressChanged(object? sender, EventArgs args) => SignalNetworkChange();
        void OnAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs args) => SignalNetworkChange();
        if (OperatingSystem.IsLinux())
        {
            NetworkChange.NetworkAddressChanged += OnAddressChanged;
            NetworkChange.NetworkAvailabilityChanged += OnAvailabilityChanged;
        }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        var periodic = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                _wake.Writer.TryWrite(true); // Startup check bypasses normal interval, no sudo.
                while (await timer.WaitForNextTickAsync(stoppingToken))
                    _wake.Writer.TryWrite(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        }, stoppingToken);
        var routeMonitor = MonitorRoutesAsync(stoppingToken);
        var lastEvent = DateTimeOffset.MinValue;
        try
        {
            await foreach (var isNetworkEvent in _wake.Reader.ReadAllAsync(stoppingToken))
            {
                var trigger = isNetworkEvent;
                if (trigger)
                {
                    // Coalesce bursts and avoid repeated checks on noisy Docker links.
                    var elapsed = DateTimeOffset.UtcNow - lastEvent;
                    if (elapsed < TimeSpan.FromSeconds(45)) continue;
                    await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                    while (_wake.Reader.TryRead(out var pending)) trigger |= pending;
                    lastEvent = DateTimeOffset.UtcNow;
                }
                await TickAsync(trigger, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            if (OperatingSystem.IsLinux())
            {
                NetworkChange.NetworkAddressChanged -= OnAddressChanged;
                NetworkChange.NetworkAvailabilityChanged -= OnAvailabilityChanged;
            }
            _wake.Writer.TryComplete();
            try { await Task.WhenAll(periodic, routeMonitor); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        }
    }
}
