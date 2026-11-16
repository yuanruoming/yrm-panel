using System.Net;
using System.Net.NetworkInformation;
using System.Reflection;

namespace YrmPanel.Services;

public sealed record NetworkAdapterInfo(string Name, string State, string[] Ipv4, string[] Ipv6);
public sealed record ServerOverview(string Hostname, string OperatingSystem, string CpuModel,
    long MemoryBytes, int Processors, string PanelVersion, string Endpoint, IReadOnlyList<NetworkAdapterInfo> Adapters);

/// <summary>Read-only operating system information. No network changes are made.</summary>
public sealed class ServerInfoService
{
    private readonly IConfiguration _configuration;
    public ServerInfoService(IConfiguration configuration) => _configuration = configuration;

    public ServerOverview Get()
    {
        string os = System.Runtime.InteropServices.RuntimeInformation.OSDescription;
        string cpu = "Unknown CPU";
        if (OperatingSystem.IsLinux())
        {
            try
            {
                var line = File.ReadLines("/etc/os-release").FirstOrDefault(x => x.StartsWith("PRETTY_NAME="));
                if (line != null) os = line.Split('=', 2)[1].Trim('"');
                cpu = File.ReadLines("/proc/cpuinfo").FirstOrDefault(x => x.StartsWith("model name"))?.Split(':', 2).Last().Trim() ?? cpu;
            }
            catch (IOException) { /* Leave available OS details. */ }
        }
        var network = new List<NetworkAdapterInfo>();
        try
        {
            foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces()
                .Where(x => x.NetworkInterfaceType != NetworkInterfaceType.Loopback))
            {
                var addresses = adapter.GetIPProperties().UnicastAddresses.Select(x => x.Address).ToArray();
                network.Add(new NetworkAdapterInfo(adapter.Name, adapter.OperationalStatus.ToString(),
                    addresses.Where(x => x.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                        .Select(x => x.ToString()).ToArray(),
                    addresses.Where(x => x.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
                        .Select(x => x.ToString()).ToArray()));
            }
        }
        catch (NetworkInformationException) { /* No adapter data available. */ }
        long memory = 0;
        if (OperatingSystem.IsLinux())
        {
            try
            {
                var line = File.ReadLines("/proc/meminfo").First(x => x.StartsWith("MemTotal:"));
                memory = long.Parse(line.Split(' ', StringSplitOptions.RemoveEmptyEntries)[1]) * 1024;
            }
            catch (Exception ex) when (ex is IOException or FormatException or InvalidOperationException) { }
        }
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "Development";
        return new ServerOverview(Environment.MachineName, os, cpu, memory,
            Environment.ProcessorCount, version, _configuration["Panel:Url"] ?? "http://127.0.0.1:6080", network);
    }
}
