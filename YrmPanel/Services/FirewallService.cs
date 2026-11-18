using System.Text.Json;

namespace YrmPanel.Services;

public sealed record FirewallRule(string Scope, string Action, int Port, string Protocol, string Source);
public sealed record FirewallOverview(bool Available, string Status, bool DockerSupported,
    IReadOnlyList<FirewallRule> Rules, string Message);

/// <summary>Draft rule editing is entirely browser-side; only Save & Apply invokes sudo.</summary>
public sealed class FirewallService
{
    private readonly PrivilegedCommandService _commands;
    public FirewallService(PrivilegedCommandService commands) => _commands = commands;

    public async Task<FirewallOverview> GetAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux()) return new(false,"Linux firewall unavailable in Windows preview.",false,[],"Preview only.");
        var result = await _commands.RunAsync("firewall", "list", [], null, null, ct, readonlyOperation:true);
        if (!result.Ok || string.IsNullOrWhiteSpace(result.Json))
            return new(false,"Firewall state unavailable.",false,[],result.Message);
        try
        {
            using var json = JsonDocument.Parse(result.Json);
            var root = json.RootElement;
            var rules = new List<FirewallRule>();
            foreach (var item in root.GetProperty("rules").EnumerateArray())
                rules.Add(new FirewallRule(item.GetProperty("scope").GetString() ?? "host",
                    item.GetProperty("action").GetString() ?? "allow", item.GetProperty("port").GetInt32(),
                    item.GetProperty("protocol").GetString() ?? "tcp", item.GetProperty("source").GetString() ?? "any"));
            return new(true, root.GetProperty("status").GetString() ?? "Unknown",
                root.GetProperty("dockerSupported").GetBoolean(), rules, "Firewall state loaded.");
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        { return new(false,"Invalid firewall status.",false,[],"Firewall helper returned invalid data."); }
    }
    public async Task<PrivilegedResult> ApplyAsync(string? json, string? password, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > 16384)
            return new(false,"Invalid firewall draft.");
        try
        {
            using var parsed = JsonDocument.Parse(json);
            if (parsed.RootElement.ValueKind != JsonValueKind.Array || parsed.RootElement.GetArrayLength() > 50)
                return new(false,"Maximum 50 rules.");
        }
        catch (JsonException) { return new(false,"Invalid firewall rules JSON."); }
        return await _commands.RunAsync("firewall", "apply", [], password, json, ct);
    }
}
