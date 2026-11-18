using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace YrmPanel.Services;

/// <summary>
/// Cloudflare DNS adapter. Never changes proxy/TTL/settings, creates records, or
/// places credentials in URLs. Only one existing exact A/AAAA record may be edited.
/// </summary>
public sealed class CloudflareDdnsClient
{
    private static readonly Regex IdPattern = new("^[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private const string Api = "https://api.cloudflare.com/client/v4/";
    private readonly HttpClient _http;

    public CloudflareDdnsClient(HttpClient http) => _http = http;

    private static string Text(JsonElement element, string field) =>
        element.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? "" : "";

    private async Task<JsonDocument> RequestAsync(DdnsProfile profile, HttpMethod method, string path,
        object? body, CancellationToken ct)
    {
        // `path` is constructed solely from validated IDs and escaped hostnames.
        using var request = new HttpRequestMessage(method, Api + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", profile.Token);
        if (body is not null)
            request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (response.Content.Headers.ContentLength > 65536)
            throw new IOException("Cloudflare API returned an unexpectedly large response.");
        var text = await response.Content.ReadAsStringAsync(ct);
        if (text.Length > 65536)
            throw new IOException("Cloudflare API response exceeded the size limit.");
        if (!response.IsSuccessStatusCode)
            throw new IOException($"Cloudflare API returned HTTP {(int)response.StatusCode}. Check the token and Zone/DNS permissions.");
        JsonDocument json;
        try { json = JsonDocument.Parse(text); }
        catch (JsonException) { throw new IOException("Cloudflare returned invalid JSON."); }
        if (!json.RootElement.TryGetProperty("success", out var success) || success.ValueKind != JsonValueKind.True)
        {
            json.Dispose();
            throw new IOException("Cloudflare rejected the request. Check DNS record permissions and the domain.");
        }
        return json;
    }

    public sealed record ExistingRecord(string ZoneId, string RecordId, string Hostname,
        string Type, string Content, bool Proxied);

    public async Task<ExistingRecord> ReadRecordAsync(DdnsProfile profile, CancellationToken ct)
    {
        if (profile.Provider != "cloudflare" || profile.AuthType != "bearer" ||
            string.IsNullOrWhiteSpace(profile.Token))
            throw new IOException("A Cloudflare API token is required.");
        var parts = profile.Hostname.Split('.', StringSplitOptions.RemoveEmptyEntries);
        string zoneId = "";
        // Supports delegated subzones: try the most specific valid zone first.
        for (var start = 0; start <= parts.Length - 2; start++)
        {
            var zone = string.Join('.', parts.Skip(start));
            using var result = await RequestAsync(profile, HttpMethod.Get,
                "zones?name=" + Uri.EscapeDataString(zone) + "&per_page=5", null, ct);
            var array = result.RootElement.GetProperty("result");
            if (array.ValueKind != JsonValueKind.Array) throw new IOException("Invalid Cloudflare zone list.");
            foreach (var entry in array.EnumerateArray())
            {
                var id = Text(entry, "id");
                if (IdPattern.IsMatch(id) && Text(entry, "name").Equals(zone, StringComparison.OrdinalIgnoreCase))
                {
                    zoneId = id;
                    break;
                }
            }
            if (zoneId.Length > 0) break;
        }
        if (zoneId.Length == 0)
            throw new IOException("Cloudflare Zone not found. Grant Zone Read for the domain in the API token.");

        using var records = await RequestAsync(profile, HttpMethod.Get,
            $"zones/{zoneId}/dns_records?type={profile.RecordType}&name.exact={Uri.EscapeDataString(profile.Hostname)}&per_page=100",
            null, ct);
        var list = records.RootElement.GetProperty("result");
        if (list.ValueKind != JsonValueKind.Array) throw new IOException("Invalid Cloudflare DNS record list.");
        var matches = list.EnumerateArray()
            .Where(record => Text(record, "name").Equals(profile.Hostname, StringComparison.OrdinalIgnoreCase)
                  && Text(record, "type").Equals(profile.RecordType, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (matches.Length == 0)
            throw new IOException($"Cloudflare {profile.RecordType} record not found. Create it once in the Cloudflare dashboard.");
        if (matches.Length != 1)
            throw new IOException("Multiple matching Cloudflare records found. Select one unique DNS record first.");
        var match = matches[0];
        var recordId = Text(match, "id");
        if (!IdPattern.IsMatch(recordId)) throw new IOException("Invalid Cloudflare DNS record ID.");
        var proxy = match.TryGetProperty("proxied", out var p) && p.ValueKind == JsonValueKind.True;
        return new ExistingRecord(zoneId, recordId, profile.Hostname, profile.RecordType,
            Text(match, "content"), proxy);
    }

    public async Task<string> UpdateRecordAsync(DdnsProfile profile, ExistingRecord record,
        string newIp, CancellationToken ct)
    {
        if (!IPAddress.TryParse(newIp, out var parsed) ||
            parsed.AddressFamily != (profile.RecordType == "AAAA" ?
                System.Net.Sockets.AddressFamily.InterNetworkV6 : System.Net.Sockets.AddressFamily.InterNetwork))
            throw new IOException("Detected IP does not match the DNS record type.");
        if (record.Content.Equals(newIp, StringComparison.OrdinalIgnoreCase)) return "Unchanged";

        // PATCH only changes the requested record content. Keep Proxied, TTL,
        // comment, tags and all other Cloudflare record properties untouched.
        using var result = await RequestAsync(profile, HttpMethod.Patch,
            $"zones/{record.ZoneId}/dns_records/{record.RecordId}",
            new { type = record.Type, name = record.Hostname, content = newIp }, ct);
        var updated = result.RootElement.GetProperty("result");
        if (!Text(updated, "content").Equals(newIp, StringComparison.OrdinalIgnoreCase))
            throw new IOException("Cloudflare did not confirm the expected DNS record content.");
        return "Updated";
    }
}
