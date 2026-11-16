using System.Diagnostics;
using YrmPanel.Models;

namespace YrmPanel.Services;

public sealed class SystemdStatusService
{
    private static readonly string[] Supported = ["docker.service", "smbd.service", "ssh.service", "ufw.service"];

    public async Task<IReadOnlyList<SystemdServiceState>> ListAsync()
    {
        var states = new List<SystemdServiceState>();
        foreach (var service in Supported)
        {
            if (!OperatingSystem.IsLinux())
            {
                states.Add(new SystemdServiceState(service, "Demo", "Linux only"));
                continue;
            }
            try
            {
                using var process = new Process();
                process.StartInfo = new ProcessStartInfo("/usr/bin/systemctl")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false
                };
                process.StartInfo.ArgumentList.Add("show");
                process.StartInfo.ArgumentList.Add(service);
                process.StartInfo.ArgumentList.Add("--property=LoadState,ActiveState,SubState");
                process.StartInfo.ArgumentList.Add("--no-pager");
                process.Start();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var outputTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                var properties = (await outputTask).Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(x => x.Split('=', 2))
                    .Where(x => x.Length == 2)
                    .ToDictionary(x => x[0], x => x[1], StringComparer.Ordinal);
                var state = properties.GetValueOrDefault("ActiveState", "unknown");
                if (properties.GetValueOrDefault("LoadState") == "not-found") state = "not installed";
                states.Add(new SystemdServiceState(service, state,
                    properties.GetValueOrDefault("SubState", "")));
            }
            catch (Exception ex) when (ex is IOException or System.ComponentModel.Win32Exception or OperationCanceledException or InvalidOperationException)
            {
                states.Add(new SystemdServiceState(service, "unavailable", "Could not query systemd"));
            }
        }
        return states;
    }
}
