namespace YrmPanel.Services;

/// <summary>
/// Short-lived, read-only snapshot for Files navigation. Regular folder changes must
/// not spawn lsblk and the privileged Samba helper on every click. Storage and
/// Samba management pages continue to query their authoritative services directly.
/// </summary>
public sealed class FilesNavigationSnapshot
{
    private readonly StorageDeviceService _devices;
    private readonly SambaManagementService _samba;
    private readonly SemaphoreSlim _refresh = new(1, 1);
    private readonly object _sync = new();
    private (IReadOnlyList<StorageDevice> Devices, SambaOverview Samba, DateTimeOffset Until)? _snapshot;
    private long _generation;

    public FilesNavigationSnapshot(StorageDeviceService devices, SambaManagementService samba)
    { _devices = devices; _samba = samba; }

    public void Invalidate()
    {
        lock (_sync) { _snapshot = null; _generation++; }
    }

    public async Task<(IReadOnlyList<StorageDevice> Devices, SambaOverview Samba)> GetAsync(
        CancellationToken cancellationToken, bool refresh = false)
    {
        lock (_sync)
        {
            if (!refresh && _snapshot is { } snapshot && snapshot.Until > DateTimeOffset.UtcNow)
                return (snapshot.Devices, snapshot.Samba);
        }
        await _refresh.WaitAsync(cancellationToken);
        try
        {
            lock (_sync)
            {
                if (!refresh && _snapshot is { } snapshot && snapshot.Until > DateTimeOffset.UtcNow)
                    return (snapshot.Devices, snapshot.Samba);
            }
            // A successful mount/share mutation may invalidate us while discovery
            // is running; never publish that older result as a new cached snapshot.
            long generation;
            lock (_sync) generation = _generation;
            // Concurrent discovery avoids stacking two unrelated subprocess waits.
            var devicesTask = _devices.ListAsync(cancellationToken);
            var sambaTask = _samba.ListAsync(cancellationToken);
            await Task.WhenAll(devicesTask, sambaTask);
            var devices = await devicesTask;
            var samba = await sambaTask;
            lock (_sync)
                if (_generation == generation)
                    _snapshot = (devices, samba, DateTimeOffset.UtcNow.AddSeconds(3));
            return (devices, samba);
        }
        finally { _refresh.Release(); }
    }
}
