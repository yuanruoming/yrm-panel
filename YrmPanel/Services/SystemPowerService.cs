using System.Diagnostics;

namespace YrmPanel.Services;

/// <summary>Invokes only the two specifically permitted host power operations.</summary>
public sealed class SystemPowerService
{
    public async Task<(bool Success, string Message)> RequestAsync(string action, CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux() || action is not ("reboot" or "shutdown"))
            return (false, "This power operation is unavailable.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        var start = new ProcessStartInfo("/usr/bin/sudo")
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true
        };
        start.ArgumentList.Add("-n");
        start.ArgumentList.Add("/usr/local/libexec/yrm-panel-power");
        start.ArgumentList.Add(action);
        try
        {
            using var process = Process.Start(start);
            if (process is null) return (false, "Power helper could not start.");
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            _ = await output;
            _ = await errors;
            return process.ExitCode == 0
                ? (true, action == "reboot" ? "Server restart scheduled." : "Server shutdown scheduled.")
                : (false, "Power request was rejected by the server.");
        }
        catch (OperationCanceledException) { return (false, "Power operation timed out."); }
        catch (System.ComponentModel.Win32Exception) { return (false, "Power helper is not installed."); }
        catch (IOException) { return (false, "Power helper failed."); }
    }
}
