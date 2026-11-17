using System.Diagnostics;
using System.Text.Json;

namespace YrmPanel.Services;

public sealed record PrivilegedResult(bool Ok, string Message, string? Json = null);

/// <summary>
/// Fixed allowlisted root helpers only. No shell, arbitrary command or executable
/// path from browser input. Passwords are supplied via stdin and never logged.
/// sudo -k forces fresh authentication for each privileged action.
/// </summary>
public sealed class PrivilegedCommandService
{
    private static readonly IReadOnlyDictionary<string, string> Helpers =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["storage"] = "/usr/local/libexec/yrm-panel-storage",
            ["samba"] = "/usr/local/libexec/yrm-panel-samba",
            ["power"] = "/usr/local/libexec/yrm-panel-power",
            ["update"] = "/usr/local/libexec/yrm-panel-update-trigger"
        };

    public async Task<PrivilegedResult> RunAsync(
        string helper, string action, IEnumerable<string> args,
        string? linuxPassword, string? payload, CancellationToken cancellationToken,
        bool readonlyOperation = false)
    {
        if (!OperatingSystem.IsLinux())
            return new(false, "System management is available on Linux only.");
        if (!Helpers.TryGetValue(helper, out var executable))
            return new(false, "Unsupported system operation.");
        if (!readonlyOperation && (string.IsNullOrEmpty(linuxPassword) || linuxPassword.Contains('\n')
            || linuxPassword.Contains('\r') || linuxPassword.Length > 512))
            return new(false, "Administrator password required.");
        if (args.Any(a => a.Length > 1024 || a.Contains('\0')))
            return new(false, "Invalid operation argument.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(helper == "update" ? 20 : 25));
        var start = new ProcessStartInfo("/usr/bin/sudo")
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        start.ArgumentList.Add(readonlyOperation ? "-n" : "-S");
        if (!readonlyOperation) start.ArgumentList.Add("-k");
        start.ArgumentList.Add("-p");
        start.ArgumentList.Add("");
        start.ArgumentList.Add("--");
        start.ArgumentList.Add(executable);
        start.ArgumentList.Add(action);
        foreach (var value in args) start.ArgumentList.Add(value);

        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start()) return new(false, "Unable to start system helper.");
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var error = process.StandardError.ReadToEndAsync(timeout.Token);
            if (!readonlyOperation) await process.StandardInput.WriteLineAsync(linuxPassword);
            if (payload is not null) await process.StandardInput.WriteAsync(payload);
            process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            var body = await output;
            _ = await error; // Never return sudo prompts or password-bearing stderr to the browser.
            try
            {
                using var json = JsonDocument.Parse(body);
                var root = json.RootElement;
                var message = root.TryGetProperty("message", out var msg)
                    ? msg.GetString() ?? "Operation complete." : "Operation complete.";
                var ok = process.ExitCode == 0 && root.TryGetProperty("ok", out var state)
                         && state.GetBoolean();
                return new(ok, message, body);
            }
            catch (JsonException)
            {
                return new(false, process.ExitCode == 0
                    ? "Helper returned an invalid response."
                    : "Authorization failed or system helper is unavailable.");
            }
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException
                   or OperationCanceledException or System.ComponentModel.Win32Exception)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
            return new(false, ex is OperationCanceledException
                ? "System operation timed out." : "Unable to run system operation.");
        }
    }
}
