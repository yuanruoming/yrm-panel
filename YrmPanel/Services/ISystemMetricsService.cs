using YrmPanel.Models;

namespace YrmPanel.Services;

public interface ISystemMetricsService
{
    SystemSnapshot GetSnapshot();
}
