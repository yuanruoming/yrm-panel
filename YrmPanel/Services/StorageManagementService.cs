using System.Diagnostics;
using System.Text.Json;

namespace YrmPanel.Services;

public sealed class StorageManagementService
{
    private const string Helper = "/usr/local/libexec/yrm-panel-storage";
    public async Task<string> RunAsync(string action, string value, CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsLinux()) return "Error: Storage management requires Linux.";
        if (action is not ("create-root" or "grant")) return "Error: Unsupported action.";
        if (value.Length > 1024 || value.Contains('\0')) return "Error: Invalid path.";
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            var psi = new ProcessStartInfo("sudo")
            { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add("-n");
            psi.ArgumentList.Add(Helper);
            psi.ArgumentList.Add(action);
            psi.ArgumentList.Add(value);
            using var process = Process.Start(psi) ?? throw new IOException("Storage helper could not start.");
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var result = await output;
            _ = await stderr;
            using var json = JsonDocument.Parse(result);
            var message = json.RootElement.GetProperty("message").GetString() ?? "Storage operation failed.";
            return process.ExitCode == 0 && json.RootElement.GetProperty("ok").GetBoolean() ? message : "Error: " + message;
        }
        catch (OperationCanceledException) { return "Error: Storage operation timed out or was cancelled."; }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or JsonException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        { return "Error: Storage helper failed: " + ex.Message; }
    }
}
