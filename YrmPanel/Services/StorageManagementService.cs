namespace YrmPanel.Services;

public sealed class StorageManagementService
{
    private readonly PrivilegedCommandService _commands;
    public StorageManagementService(PrivilegedCommandService commands) => _commands = commands;

    public async Task<string> RunAsync(string action, string value, string? adminPassword, CancellationToken ct)
    {
        if (action is not ("create-root" or "grant") || value.Length > 1024 || value.Contains('\0'))
            return "Error: Unsupported storage operation.";
        var result = await _commands.RunAsync("storage", action, [value], adminPassword, null, ct);
        return result.Ok ? result.Message : "Error: " + result.Message;
    }
}
