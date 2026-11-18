using System.Text.Json;

namespace YrmPanel.Services;

public sealed record FirewallRule(string Scope, string Action, string Port, string Protocol, string Source);
public sealed record FirewallOverview(bool Available, string Status, bool DockerSupported,
    IReadOnlyList<FirewallRule> Rules, string Message, bool Active = false,
    string PendingConfirmation = "");

/// <summary>All firewall edits remain a browser draft until Save & Apply.</summary>
public sealed class FirewallService
{
    private readonly PrivilegedCommandService _commands;
    public FirewallService(PrivilegedCommandService commands) => _commands = commands;

    public async Task<FirewallOverview> GetAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux())
            return new(false, "Linux firewall unavailable in Windows preview.", false, [], "Preview only.");
        var result = await _commands.RunAsync("firewall", "list", [], null, null, ct, readonlyOperation:true);
        if (!result.Ok || string.IsNullOrWhiteSpace(result.Json))
            return new(false, "Firewall status unavailable.", false, [], result.Message);
        try
        {
            using var json = JsonDocument.Parse(result.Json);
            var root = json.RootElement;
            var available = root.TryGetProperty("available", out var avail) && avail.GetBoolean();
            var active = root.TryGetProperty("active", out var state) && state.GetBoolean();
            var pending = root.TryGetProperty("pendingConfirmation", out var value) ? value.GetString() ?? "" : "";
            var rules = new List<FirewallRule>();
            foreach (var item in root.GetProperty("rules").EnumerateArray())
                rules.Add(new FirewallRule(item.GetProperty("scope").GetString() ?? "host",
                    item.GetProperty("action").GetString() ?? "allow", item.GetProperty("port").ToString(),
                    item.GetProperty("protocol").GetString() ?? "tcp", item.GetProperty("source").GetString() ?? "any"));
            return new(available, root.GetProperty("status").GetString() ?? "Unknown",
                root.GetProperty("dockerSupported").GetBoolean(), rules,
                available ? "Firewall status loaded." : "UFW is not installed or status is unavailable.", active, pending);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return new(false, "Invalid firewall status.", false, [], "Invalid firewall helper response.");
        }
    }

    public async Task<PrivilegedResult> ApplyAsync(string? rulesJson, bool? enabled, string? password, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rulesJson) || rulesJson.Length > 14000)
            return new(false, "Invalid firewall draft.");
        try
        {
            using var parsed = JsonDocument.Parse(rulesJson);
            if (parsed.RootElement.ValueKind != JsonValueKind.Array || parsed.RootElement.GetArrayLength() > 50)
                return new(false, "Maximum 50 rules.");
        }
        catch (JsonException) { return new(false, "Invalid firewall JSON."); }
        // A stale BETA4 form has no status field: preserve the current UFW state.
        var payload = enabled.HasValue
            ? JsonSerializer.Serialize(new { enabled = enabled.Value, rules = JsonSerializer.Deserialize<JsonElement>(rulesJson) })
            : rulesJson;
        return await _commands.RunAsync("firewall", "apply", [], password, payload, ct);
    }

    public Task<PrivilegedResult> ConfirmAsync(string nonce, CancellationToken ct)
    {
        if (nonce.Length != 48 || !nonce.All(c => char.IsAsciiHexDigit(c)))
            return Task.FromResult(new PrivilegedResult(false, "Invalid confirmation token."));
        // The root helper checks the random pending token. No second sudo password.
        return _commands.RunAsync("firewall", "confirm", [nonce], null, null, ct, readonlyOperation:true);
    }
}
