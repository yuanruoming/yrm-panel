using Microsoft.AspNetCore.Mvc.RazorPages;

namespace YrmPanel.Pages;

public sealed class FeaturesModel : PageModel
{
    private static readonly Dictionary<string, (string Title, string Description)> Features = new()
    {
        ["files"] = ("File manager", "Browse, upload, rename and move files in approved directories."),
        ["shares"] = ("SMB shares", "Manage Samba shares using your existing Linux accounts."),
        ["firewall"] = ("Firewall", "Inspect and manage approved UFW rules without exposing the system to arbitrary commands."),
        ["ddns"] = ("DDNS", "Native Cloudflare DNS record updates, schedules and history."),
        ["backup"] = ("Backup", "See scheduled backup status and snapshots.")
    };
    public string FeatureTitle { get; private set; } = "Coming soon";
    public string Description { get; private set; } = "This module is planned for a future version.";
    public void OnGet(string? feature)
    {
        if (feature is not null && Features.TryGetValue(feature, out var value))
        { FeatureTitle = value.Title; Description = value.Description; }
    }
}
