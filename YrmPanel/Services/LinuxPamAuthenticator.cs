using System.Diagnostics;

namespace YrmPanel.Services;

/// <summary>
/// Verifies only the Linux account selected by the installer. PAM authentication
/// does NOT change the identity of the ASP.NET process. Multi-user sessions
/// require a future per-UID file-operation broker.
/// </summary>
public sealed class LinuxPamAuthenticator
{
    public string Account { get; } = Environment.GetEnvironmentVariable("YRM_PANEL_USER") ?? "";

    public async Task<bool> VerifyAsync(string? username, string? password, CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsLinux() || string.IsNullOrEmpty(Account)
            || !string.Equals(username, Account, StringComparison.Ordinal)
            || string.IsNullOrEmpty(password) || password.Length > 512
            || password.Contains('\r') || password.Contains('\n')) return false;

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo("/usr/bin/pamtester")
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            }
        };
        process.StartInfo.ArgumentList.Add("yrm-panel");
        process.StartInfo.ArgumentList.Add(Account);
        process.StartInfo.ArgumentList.Add("authenticate");
        process.StartInfo.ArgumentList.Add("acct_mgmt");
        try
        {
            if (!process.Start()) return false;
            var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.StandardInput.WriteLineAsync(password);
            process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            await Task.WhenAll(stdout, stderr);
            return process.ExitCode == 0;
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException
                   or OperationCanceledException or System.ComponentModel.Win32Exception)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
            return false;
        }
    }
}
