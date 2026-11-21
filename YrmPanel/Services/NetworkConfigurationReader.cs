using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace YrmPanel.Services;

/// <summary>
/// Read-only Linux configuration lookup. An assigned address does not reveal whether
/// it came from DHCP, SLAAC or manual configuration. Never modify network settings.
/// </summary>
public static class NetworkConfigurationReader
{
    public sealed record Result(string Ipv4Mode, string Ipv6Mode, string Ipv4Dns, string Ipv6Dns);

    public static Result Read(string interfaceName)
    {
        if (!OperatingSystem.IsLinux() || string.IsNullOrEmpty(interfaceName))
            return new("Unknown", "Unknown", "", "");
        var (v4, v6) = NetworkdModes(interfaceName);
        if (v4 == "Unknown" || v6 == "Unknown")
        {
            var fallback = NetworkManagerModes(interfaceName);
            if (v4 == "Unknown") v4 = fallback.v4;
            if (v6 == "Unknown") v6 = fallback.v6;
        }
        var addresses = ReadCommand("resolvectl", "dns", interfaceName);
        // `resolvectl dns ens2` returns `Link 2 (ens2): IP IP...`.
        var dns = addresses is null ? "" : string.Join(" ", addresses.Split('\n')
            .Select(line => line.Contains(':') ? line[(line.IndexOf(':') + 1)..] : ""));
        var ipList = dns.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(value => IPAddress.TryParse(value, out var ip) ? ip : null)
            .Where(ip => ip is not null).ToArray();
        var dns4 = string.Join(", ", ipList.Where(ip => ip!.AddressFamily == AddressFamily.InterNetwork));
        var dns6 = string.Join(", ", ipList.Where(ip => ip!.AddressFamily == AddressFamily.InterNetworkV6));
        return new(v4, v6, dns4, dns6);
    }

    private static (string v4, string v6) NetworkdModes(string interfaceName)
    {
        var status = ReadCommand("networkctl", "status", interfaceName, "--no-pager");
        var fileLine = status?.Split('\n').Select(line => line.Trim())
            .FirstOrDefault(line => line.StartsWith("Network File:", StringComparison.OrdinalIgnoreCase));
        var configPath = fileLine is null ? null : fileLine[(fileLine.IndexOf(':') + 1)..].Trim();
        if (string.IsNullOrEmpty(configPath) || !Path.IsPathFullyQualified(configPath) ||
            !File.Exists(configPath) || !configPath.EndsWith(".network", StringComparison.Ordinal))
            return ("Unknown", "Unknown");
        try
        {
            string section = "";
            string dhcp = "", acceptRa = "";
            var addresses = new List<string>();
            foreach (var raw in File.ReadLines(configPath))
            {
                var line = raw.Trim();
                if (line.StartsWith('#') || line.StartsWith(';') || line.Length == 0) continue;
                if (line.StartsWith('[') && line.EndsWith(']')) { section = line; continue; }
                var i = line.IndexOf('='); if (i <= 0) continue;
                var key = line[..i].Trim(); var value = line[(i+1)..].Trim();
                if (section == "[Network]")
                {
                    if (key == "DHCP") dhcp = value.ToLowerInvariant();
                    if (key == "IPv6AcceptRA") acceptRa = value.ToLowerInvariant();
                    if (key == "Address") addresses.Add(value);
                }
                if (section == "[Address]" && key == "Address") addresses.Add(value);
            }
            var dhcp4 = dhcp is "yes" or "true" or "ipv4";
            var dhcp6 = dhcp is "yes" or "true" or "ipv6";
            var static4 = addresses.Any(x => IPAddress.TryParse(x.Split('/')[0], out var ip) && ip.AddressFamily == AddressFamily.InterNetwork);
            var static6 = addresses.Any(x => IPAddress.TryParse(x.Split('/')[0], out var ip) && ip.AddressFamily == AddressFamily.InterNetworkV6);
            var v4 = dhcp4 ? "DHCP" : static4 ? "Static" : "Unknown";
            // RA is routinely used together with DHCPv6. Prefer explicitly enabled DHCPv6.
            var v6 = dhcp6 ? "DHCPv6" : acceptRa is "yes" or "true" ? "SLAAC" : static6 ? "Static" : "Unknown";
            return (v4, v6);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ("Unknown", "Unknown"); }
    }

    private static (string v4, string v6) NetworkManagerModes(string interfaceName)
    {
        var conn = ReadCommand("nmcli", "-g", "GENERAL.CONNECTION", "device", "show", interfaceName)?.Trim();
        if (string.IsNullOrWhiteSpace(conn) || conn == "--") return ("Unknown", "Unknown");
        var methods = ReadCommand("nmcli", "-g", "ipv4.method,ipv6.method", "connection", "show", conn)?
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (methods is null || methods.Length < 2) return ("Unknown", "Unknown");
        return (methods[0] switch { "auto" => "DHCP", "manual" => "Static", _ => "Unknown" },
            methods[1] switch { "auto" => "Auto (SLAAC / DHCPv6)", "dhcp" => "DHCPv6", "manual" => "Static", _ => "Unknown" });
    }

    private static string? ReadCommand(string name, params string[] args)
    {
        try
        {
            using var proc = new Process { StartInfo = new ProcessStartInfo(name)
            { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true } };
            foreach (var arg in args) proc.StartInfo.ArgumentList.Add(arg);
            if (!proc.Start()) return null;
            var output = proc.StandardOutput.ReadToEnd();
            if (!proc.WaitForExit(1500)) { proc.Kill(); return null; }
            return proc.ExitCode == 0 ? output : null;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or IOException or InvalidOperationException) { return null; }
    }
}
