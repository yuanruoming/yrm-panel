using System.Net;
using System.Net.Http.Headers;
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
    DateTimeOffset? NextAttemptAt = null, int ConsecutiveFailures = 0);

public sealed record DdnsProfileView(
    string Id, string Name, string Hostname, string RecordType, string UrlTemplate,
    string HttpMethod, string HeaderName, string BodyTemplate, string SuccessContains,
    int IntervalMinutes, bool Enabled, string LastIp, string LastStatus,
    DateTimeOffset? LastRun, string DetectionUrl, string AuthType,
    string ResponseMode, string SuccessCodes, string UnchangedCodes,
    string ErrorCodes, string JsonProperty, string JsonExpected,
    bool VerifyDns, string LastDnsIp, string Verification, DateTimeOffset? NextAttemptAt);

public sealed record DdnsProfileOptions(
    string DetectionUrl = "", string AuthType = "header", string Username = "",
    string ResponseMode = "codes", string SuccessCodes = "good",
    string UnchangedCodes = "nochg", string ErrorCodes = "badauth,nohost,notfqdn,unknown,servererror,911",
    string JsonProperty = "success", string JsonExpected = "true", bool VerifyDns = true);

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
                p.Verification, p.NextAttemptAt)).ToArray();
        }
        finally { _gate.Release(); }
    }

    public async Task<string> AddAsync(string name, string hostname, string recordType, string url,
        string method, string header, string token, string body, string success,
        int interval, CancellationToken ct, DdnsProfileOptions? options = null)
    {
        options ??= new DdnsProfileOptions();
        name = (name ?? "").Trim(); hostname = (hostname ?? "").Trim(); url = (url ?? "").Trim();
        var detect = (options.DetectionUrl ?? "").Trim();
        var auth = (options.AuthType ?? "header").ToLowerInvariant();
        var mode = (options.ResponseMode ?? "codes").ToLowerInvariant();
        if (name.Length is < 1 or > 50 || !HostPattern.IsMatch(hostname)
            || recordType is not ("A" or "AAAA") || method is not ("GET" or "POST" or "PUT" or "PATCH")
            || interval is < 5 or > 1440 || (token?.Length ?? 0) > 2048
            || (header?.Length ?? 0) > 80 || (body?.Length ?? 0) > 8000
            || (success?.Length ?? 0) > 200 || !ValidPublicHttps(url)
            || (detect.Length != 0 && !ValidPublicHttps(detect))
            || auth is not ("none" or "header" or "basic" or "bearer")
            || mode is not ("codes" or "json" or "http")
            || (options.Username?.Length ?? 0) > 120
            || !Regex.IsMatch(header ?? "Authorization", @"^[A-Za-z0-9-]{1,80}$")
            || (auth == "basic" && string.IsNullOrWhiteSpace(options.Username))
            || (auth != "none" && string.IsNullOrWhiteSpace(token))
            || !ValidResponseOptions(options))
            return "Error: Invalid DDNS configuration. Check HTTPS URLs, authentication and response rules.";
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
                JsonExpected: options.JsonExpected ?? "true", VerifyDns: options.VerifyDns));
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
            var result = await VerifyDnsAsync(profile, profile.LastIp, ct);
            profiles[index] = profile with { LastDnsIp = result.ip, Verification = result.status };
            WriteUnsafe(profiles);
            return result.status + (result.ip.Length > 0 ? " · DNS: " + result.ip : "");
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

    public async Task<string> UpdateAsync(string id, bool force, CancellationToken ct)
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
            if (!force && (!profile.Enabled
                || (profile.NextAttemptAt is { } next && DateTimeOffset.UtcNow < next)
                || (profile.LastRun is { } last && DateTimeOffset.UtcNow - last < TimeSpan.FromMinutes(profile.IntervalMinutes))))
                return "Not due.";
            var now = DateTimeOffset.UtcNow;
            var status = "Failed"; var ip = ""; var dnsIp = profile.LastDnsIp;
            var verification = profile.Verification; var responseCode = "";
            try
            {
                ip = await DetectIpAsync(profile, ct);
                if (ip == profile.LastIp && (profile.LastStatus is "Updated" or "Unchanged" or "IP unchanged"))
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
                    var dns = await VerifyDnsAsync(profile, ip, ct);
                    dnsIp = dns.ip; verification = dns.status;
                }
                else verification = "Disabled";
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException
                or SocketException or InvalidOperationException or ArgumentException)
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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
            do
            {
                var profiles = await ListAsync(stoppingToken);
                foreach (var profile in profiles.Where(p => p.Enabled))
                    await UpdateAsync(profile.Id, false, stoppingToken);
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
