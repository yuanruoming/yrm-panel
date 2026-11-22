namespace YrmPanel.Services;

/// <summary>
/// Read-only snapshot for Files navigation. Regular folder changes must not spawn
/// lsblk and the privileged Samba helper on a click. A fresh snapshot (3 seconds)
/// is returned as is; an older one (up to 5 minutes) is returned immediately while
/// ONE background refresh runs. Every Panel-initiated mount or share change calls
/// Invalidate(), and an explicit Refresh bypasses the snapshot, so only changes
/// made outside the Panel can show for one navigation. Storage and Samba
/// management pages still query their authoritative services directly.
/// </summary>
public sealed class FilesNavigationSnapshot
{
    private static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan MaxStale = TimeSpan.FromMinutes(5);

    private readonly StorageDeviceService _devices;
    private readonly SambaManagementService _samba;
    private readonly SemaphoreSlim _refresh = new(1, 1);
    private readonly object _sync = new();
    private (IReadOnlyList<StorageDevice> Devices, SambaOverview Samba, DateTimeOffset Until)? _snapshot;
    private long _generation;
    private int _backgroundRunning;

    public FilesNavigationSnapshot(StorageDeviceService devices, SambaManagementService samba)
    { _devices = devices; _samba = samba; }

    public void Invalidate()
    {
        lock (_sync) { _snapshot = null; _generation++; }
    }

    public Task<(IReadOnlyList<StorageDevice> Devices, SambaOverview Samba)> GetAsync(
        CancellationToken cancellationToken, bool refresh = false)
    {
        if (!refresh)
        {
            (IReadOnlyList<StorageDevice> Devices, SambaOverview Samba, DateTimeOffset Until)? current;
            lock (_sync) current = _snapshot;
            if (current is { } snapshot)
            {
                var now = DateTimeOffset.UtcNow;
                if (snapshot.Until > now)
                    return Task.FromResult((snapshot.Devices, snapshot.Samba));
                if (now - snapshot.Until < MaxStale)
                {
                    StartBackgroundRefresh();
                    return Task.FromResult((snapshot.Devices, snapshot.Samba));
                }
            }
        }
        return LoadAsync(cancellationToken, refresh);
    }

    private void StartBackgroundRefresh()
    {
        if (Interlocked.Exchange(ref _backgroundRunning, 1) == 1) return;
        _ = Task.Run(async () =>
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(40));
                await LoadAsync(timeout.Token, refresh: false);
            }
            catch
            {
                // Keep serving the previous snapshot; the next navigation retries.
            }
            finally { Volatile.Write(ref _backgroundRunning, 0); }
        });
    }

    private async Task<(IReadOnlyList<StorageDevice> Devices, SambaOverview Samba)> LoadAsync(
        CancellationToken cancellationToken, bool refresh)
    {
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
                    _snapshot = (devices, samba, DateTimeOffset.UtcNow.Add(FreshFor));
            return (devices, samba);
        }
        finally { _refresh.Release(); }
    }
}
