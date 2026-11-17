namespace YrmPanel.Services;

public sealed class SystemPowerService
{
    private readonly PrivilegedCommandService _commands;
    public SystemPowerService(PrivilegedCommandService commands) => _commands = commands;

    public async Task<(bool Success, string Message)> RequestAsync(
        string action, string? adminPassword, CancellationToken ct)
    {
        if (action is not ("reboot" or "shutdown"))
            return (false, "Unsupported power operation.");
        var response = await _commands.RunAsync("power", action, [], adminPassword, null, ct);
        return (response.Ok, response.Ok
            ? (action == "reboot" ? "Server reboot requested." : "Server shutdown requested.")
            : response.Message);
    }
}
