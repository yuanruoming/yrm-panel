using System.Diagnostics;
using System.Text.Json;

namespace YrmPanel.Services;

public sealed record SambaShare(string Name, string Path, bool ReadOnly, bool Managed);
public sealed record SambaOverview(bool Available, string Message, string Account, bool AccountConfigured, IReadOnlyList<SambaShare> Shares);

/// <summary>
/// All privileged Samba operations go through a root-owned allowlisted helper.
/// The web process itself never edits smb.conf or invokes a shell.
/// </summary>
public sealed class SambaManagementService
{
    private readonly IConfiguration _config;
    public SambaManagementService(IConfiguration config) => _config = config;
    public async Task<SambaOverview> ListAsync(CancellationToken ct)
    {
        try
        {
            using var result = await CallAsync("list", [], null, ct);
            var root = result.RootElement;
            if (!root.GetProperty("ok").GetBoolean())
                return new SambaOverview(false, root.GetProperty("message").GetString() ?? "Unavailable", "", false, []);
            return new SambaOverview(true, "Managed Samba shares", root.GetProperty("account").GetString() ?? "",
                root.GetProperty("accountConfigured").GetBoolean(),
                root.GetProperty("shares").EnumerateArray().Select(x => new SambaShare(
                    x.GetProperty("name").GetString() ?? "",
                    x.GetProperty("path").GetString() ?? "",
                    x.GetProperty("readOnly").GetBoolean(),
                    x.TryGetProperty("managed", out var m) ? m.GetBoolean() : true)).ToArray());
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or JsonException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            return new SambaOverview(false, ex.Message, "", false, []);
        }
    }

    public async Task<string> SaveAsync(string? name, string? path, bool readOnly, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(path)) return "Enter a share name and folder path.";
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[A-Za-z][A-Za-z0-9_-]{0,31}$"))
            return "Invalid Samba share name.";
        return await ActionAsync("save", [name, path, readOnly ? "true" : "false"], null, ct);
    }

    public async Task<string> DeleteAsync(string? name, CancellationToken ct)
        => string.IsNullOrWhiteSpace(name) ||
           !System.Text.RegularExpressions.Regex.IsMatch(name, "^[A-Za-z][A-Za-z0-9_-]{0,31}$")
           ? "Invalid share name." : await ActionAsync("delete", [name], null, ct);

    public async Task<string> SetPasswordAsync(string? password, CancellationToken ct)
    {
        if (password is null) return "Enter a password.";
        if (password.Length < 12 || password.Length > 256 || password.Contains('\n') || password.Contains('\r'))
            return "Password must be 12–256 characters and cannot contain newlines.";
        return await ActionAsync("set-password", [], password, ct);
    }

    private async Task<string> ActionAsync(string action, string[] args, string? input, CancellationToken ct)
    {
        try
        {
            using var result = await CallAsync(action, args, input, ct);
            var message = result.RootElement.TryGetProperty("message", out var value)
                ? value.GetString() ?? "Completed." : "Completed.";
            return result.RootElement.TryGetProperty("ok", out var ok) && ok.GetBoolean()
                ? message : "Error: " + message;
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or JsonException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        { return "Error: " + ex.Message; }
    }

    private async Task<JsonDocument> CallAsync(string action, string[] args, string? input, CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux()) throw new IOException("Samba integration is available on Ubuntu only.");
        var helper = _config["Samba:HelperPath"] ?? "/usr/local/libexec/yrm-panel-samba";
        // Fixed helper path, no user-supplied executables or arbitrary commands.
        if (helper != "/usr/local/libexec/yrm-panel-samba") throw new IOException("Invalid Samba helper path.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        var start = new ProcessStartInfo("sudo")
        {
            RedirectStandardOutput = true, RedirectStandardError = true,
            RedirectStandardInput = true, UseShellExecute = false
        };
        start.ArgumentList.Add("-n"); start.ArgumentList.Add(helper); start.ArgumentList.Add(action);
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start()) throw new IOException("Unable to start Samba helper.");
            if (input is not null) await process.StandardInput.WriteAsync(input);
            process.StandardInput.Close();
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var error = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var body = await output;
            if (!process.ExitCode.Equals(0))
            {
                using var failure = JsonDocument.Parse(body);
                throw new IOException(failure.RootElement.GetProperty("message").GetString() ?? "Samba operation failed.");
            }
            _ = await error;
            return JsonDocument.Parse(body);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new IOException("Samba operation timed out.");
        }
    }
}
