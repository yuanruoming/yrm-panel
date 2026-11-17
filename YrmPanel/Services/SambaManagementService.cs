using System.Text.Json;
using System.Text.RegularExpressions;

namespace YrmPanel.Services;

public sealed record SambaShare(string Name, string Path, bool ReadOnly, bool Managed);
public sealed record SambaOverview(bool Available, string Message, string Account,
    bool AccountConfigured, IReadOnlyList<SambaShare> Shares);

/// <summary>Samba state lookup is read-only. All mutations require Linux sudo authentication.</summary>
public sealed class SambaManagementService
{
    private readonly PrivilegedCommandService _commands;
    public SambaManagementService(PrivilegedCommandService commands) => _commands = commands;

    public async Task<SambaOverview> ListAsync(CancellationToken ct)
    {
        var result = await _commands.RunAsync("samba", "list", [], null, null, ct, readonlyOperation: true);
        if (!result.Ok || string.IsNullOrEmpty(result.Json))
            return new(false, result.Message, "", false, []);
        try
        {
            using var doc = JsonDocument.Parse(result.Json);
            var body = doc.RootElement;
            return new(true, "Samba available", body.GetProperty("account").GetString() ?? "",
                body.GetProperty("accountConfigured").GetBoolean(),
                body.GetProperty("shares").EnumerateArray().Select(entry => new SambaShare(
                    entry.GetProperty("name").GetString() ?? "",
                    entry.GetProperty("path").GetString() ?? "",
                    entry.GetProperty("readOnly").GetBoolean(),
                    entry.TryGetProperty("managed", out var managed) && managed.GetBoolean())).ToArray());
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException)
        {
            return new(false, "Unable to parse Samba state.", "", false, []);
        }
    }

    public async Task<string> SaveAsync(string? name, string? path, bool readOnly,
        string? adminPassword, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(path)
            || !Regex.IsMatch(name, @"^[\p{L}\p{N}_-]{1,32}$"))
            return "Error: Enter a valid SMB share name and folder.";
        var r = await _commands.RunAsync("samba", "save", [name, path, readOnly ? "true" : "false"],
            adminPassword, null, ct);
        return r.Ok ? r.Message : "Error: " + r.Message;
    }

    public async Task<string> DeleteAsync(string? name, string? adminPassword, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name) || !Regex.IsMatch(name, @"^[\p{L}\p{N}_-]{1,32}$"))
            return "Error: Invalid SMB share name.";
        var r = await _commands.RunAsync("samba", "delete", [name], adminPassword, null, ct);
        return r.Ok ? r.Message : "Error: " + r.Message;
    }

    public async Task<string> SetPasswordAsync(string? password, string? adminPassword, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 12 || password.Length > 256
            || password.Contains('\n') || password.Contains('\r'))
            return "Error: SMB password must be 12–256 characters and cannot contain newlines.";
        var r = await _commands.RunAsync("samba", "set-password", [], adminPassword,
            password + "\n", ct);
        return r.Ok ? r.Message : "Error: " + r.Message;
    }
}
