using Microsoft.AspNetCore.Mvc.RazorPages;
using YrmPanel.Models;
using YrmPanel.Services;

namespace YrmPanel.Pages;

public sealed class ServicesModel : PageModel
{
    private readonly SystemdStatusService _service;
    public ServicesModel(SystemdStatusService service) => _service = service;
    public IReadOnlyList<SystemdServiceState> Items { get; private set; } = [];
    public async Task OnGetAsync() => Items = await _service.ListAsync();
}
