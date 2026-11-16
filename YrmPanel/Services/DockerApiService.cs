using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;
using YrmPanel.Models;

namespace YrmPanel.Services;

public sealed class DockerApiService : IDisposable
{
    private readonly HttpClient? _client;
    private readonly IConfiguration _configuration;
    public bool ControlsEnabled => _configuration.GetValue<bool>("Docker:EnableControls");

    public DockerApiService(IConfiguration configuration)
    {
        _configuration = configuration;
        if (!OperatingSystem.IsLinux() || !_configuration.GetValue("Docker:Enabled", true)) return;
        var socketPath = configuration["Docker:SocketPath"] ?? "/var/run/docker.sock";
        var handler = new SocketsHttpHandler
        {
            ConnectCallback = async (_, token) =>
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                try
                {
                    await socket.ConnectAsync(new UnixDomainSocketEndPoint(socketPath), token);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch { socket.Dispose(); throw; }
            }
        };
        _client = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://localhost"),
            Timeout = TimeSpan.FromSeconds(5)
        };
    }

    public async Task<DockerResponse> ListAsync(CancellationToken ct = default)
    {
        if (_client is null)
            return new DockerResponse(false, "Docker integration needs Linux and a reachable Docker socket.", []);
        try
        {
            var apiPrefix = await GetApiPrefixAsync(ct);
            using var response = await _client.GetAsync($"{apiPrefix}/containers/json?all=1", ct);
            if (!response.IsSuccessStatusCode)
                return new DockerResponse(false, $"Docker returned HTTP {(int)response.StatusCode}.", []);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct));
            var result = new List<DockerContainer>();
            foreach (var container in doc.RootElement.EnumerateArray())
            {
                var id = Property(container, "Id");
                var names = container.TryGetProperty("Names", out var n) && n.GetArrayLength() > 0
                    ? n[0].GetString()?.TrimStart('/') ?? id[..Math.Min(12, id.Length)]
                    : id[..Math.Min(12, id.Length)];
                var labels = container.TryGetProperty("Labels", out var l) ? l : default;
                var project = labels.ValueKind == JsonValueKind.Object ? Property(labels, "com.docker.compose.project") : "";
                var service = labels.ValueKind == JsonValueKind.Object ? Property(labels, "com.docker.compose.service") : "";
                result.Add(new DockerContainer(id, names, Property(container, "Image"),
                    Property(container, "State"), Property(container, "Status"), project, service));
            }
            return new DockerResponse(true, null, result.OrderBy(x => x.Project).ThenBy(x => x.Name).ToArray());
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or SocketException or IOException or JsonException)
        {
            return new DockerResponse(false, "Cannot connect to Docker. Check that Docker is running and YRM Panel has socket access.", []);
        }
    }

    private static string Property(JsonElement item, string name) =>
        item.TryGetProperty(name, out var result) && result.ValueKind == JsonValueKind.String
            ? result.GetString() ?? "" : "";

    public async Task<(bool ok, string message)> ControlAsync(string id, string operation, CancellationToken ct)
    {
        if (!ControlsEnabled || _client is null) return (false, "Docker controls are disabled.");
        if (!Regex.IsMatch(id, "^[a-f0-9]{12,64}$", RegexOptions.CultureInvariant))
            return (false, "Invalid container ID.");
        if (operation is not ("start" or "stop" or "restart"))
            return (false, "Unsupported operation.");
        var known = await ListAsync(ct);
        if (!known.Available || !known.Containers.Any(x => x.Id == id))
            return (false, "Container is no longer available.");
        try
        {
            var apiPrefix = await GetApiPrefixAsync(ct);
            using var response = await _client.PostAsync($"{apiPrefix}/containers/{id}/{operation}", null, ct);
            return response.IsSuccessStatusCode ||
                (operation == "start" && response.StatusCode == System.Net.HttpStatusCode.NotModified)
                ? (true, $"{operation} request completed.")
                : (false, $"Docker returned HTTP {(int)response.StatusCode}.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or SocketException or IOException)
        {
            return (false, "Docker connection failed.");
        }
    }

    public async Task<string> LogsAsync(string id, CancellationToken ct)
    {
        if (_client is null || !Regex.IsMatch(id, "^[a-f0-9]{12,64}$", RegexOptions.CultureInvariant))
            return "Docker is unavailable or container ID is invalid.";
        var known = await ListAsync(ct);
        if (!known.Containers.Any(x => x.Id == id)) return "Container not found.";
        try
        {
            var prefix = await GetApiPrefixAsync(ct);
            using var response = await _client.GetAsync($"{prefix}/containers/{id}/logs?stdout=1&stderr=1&tail=150&timestamps=1", ct);
            if (!response.IsSuccessStatusCode) return $"Docker returned HTTP {(int)response.StatusCode}.";
            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            if (bytes.Length > 256 * 1024) return "Log output is too large. Showing the latest lines is recommended.";
            // Docker multiplexes stdout/stderr with an 8-byte frame header on non-TTY containers.
            var output = new System.Text.StringBuilder();
            var pos = 0;
            while (pos + 8 <= bytes.Length && (bytes[pos] == 1 || bytes[pos] == 2) &&
                   bytes[pos + 1] == 0 && bytes[pos + 2] == 0 && bytes[pos + 3] == 0)
            {
                var length = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(pos + 4, 4));
                if (length < 0 || pos + 8L + length > bytes.Length) break;
                output.Append(System.Text.Encoding.UTF8.GetString(bytes, pos + 8, length));
                pos += length + 8;
            }
            if (pos == bytes.Length) return output.ToString();
            // TTY containers emit plain text without Docker framing.
            return System.Text.Encoding.UTF8.GetString(bytes);
        }
        catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException or JsonException)
        { return "Unable to load Docker logs."; }
    }

    private async Task<string> GetApiPrefixAsync(CancellationToken ct)
    {
        if (_client is null) throw new IOException("Docker client unavailable.");
        // Docker requires a versioned API path; /version is the negotiation endpoint.
        using var response = await _client.GetAsync("/version", ct);
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct));
        var version = Property(doc.RootElement, "ApiVersion");
        if (!Regex.IsMatch(version, @"^\d+\.\d+$", RegexOptions.CultureInvariant))
            throw new JsonException("Unrecognized Docker API version.");
        return "/v" + version;
    }

    public void Dispose() => _client?.Dispose();
}
