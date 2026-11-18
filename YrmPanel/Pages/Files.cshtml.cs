using Microsoft.AspNetCore.Mvc;
using System.Xml.Linq;
using YrmPanel.Services;
using static System.Net.WebRequestMethods;

{
    try
    {
        var createdPath = FileManagerService.Absolute(
            rootParent ? name : normalizedParent + "/" + name);
        _folders.Add(createdPath);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                  or ArgumentException)
    { Notice += " Could not pin it automatically: " + ex.Message; }
}
return Back();
    }

    public async Task<IActionResult> OnPostEnableAsync(string? adminPassword)
{
    Notice = await _storage.RunAsync("grant", FileManagerService.Absolute(CurrentRelative), adminPassword, HttpContext.RequestAborted);
    return Back();
}

public async Task<IActionResult> OnPostEnableFolderAsync(string name, string? adminPassword)
{
    var current = _files.Browse("system", CurrentRelative, true);
    if (!current.Available || !current.Items.Any(x => x.Name == name && x.IsDirectory))
    { Notice = "Error: Selected folder not found."; return Back(); }
    var full = FileManagerService.Absolute(string.IsNullOrEmpty(CurrentRelative) ? name : CurrentRelative.Trim('/') + "/" + name);
    if (!_files.CanEnable(full))
    { Notice = "Error: This folder cannot be managed with administrator permissions."; return Back(); }
    Notice = await _storage.RunAsync("grant", full, adminPassword, HttpContext.RequestAborted);
    return Back();
}

public IActionResult OnPostRename(string name, string newName)
{ Notice = Act(() => _files.Rename("system", CurrentRelative, name, newName), "Renamed."); return Back(); }

public IActionResult OnPostDelete(string name)
{ Notice = Act(() => _files.Delete("system", CurrentRelative, name), "Removed."); return Back(); }

public IActionResult OnPostMove(string name, string destination)
{ Notice = Act(() => _files.Move("system", CurrentRelative, name, destination), "Moved."); return Back(); }

public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload)
{
    if (upload is null) { Notice = "Error: Select a file."; return Back(); }
    try { await _files.UploadAsync("system", CurrentRelative, upload, HttpContext.RequestAborted); Notice = "File uploaded."; }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                               or ArgumentException or NotSupportedException)
    { Notice = "Error: " + FileManagerService.SafeError(ex); }
    return Back();
}

public async Task<IActionResult> OnPostShareAsync(
    string folder, string? shareName, bool readOnly, string? smbPassword,
    string? adminPassword, string? absoluteFolder)
{
    string full;
    try
    {
        if (!string.IsNullOrWhiteSpace(absoluteFolder))
        {
            full = MyFoldersStore.Normalize(absoluteFolder);
            if (!_folders.List().Contains(full, StringComparer.Ordinal))
                throw new UnauthorizedAccessException("Add the folder to My Folders before sharing it.");
        }
        else
        {
            var view = _files.Browse("system", CurrentRelative, true);
            if (!view.Available || !view.Items.Any(item => item.IsDirectory && item.Name == folder))
                throw new IOException("Folder not found.");
            var target = string.IsNullOrEmpty(Path) ? folder : Path.Trim('/') + "/" + folder;
            full = FileManagerService.Absolute(target);
        }
        if (!_files.IsManaged(full))
            throw new UnauthorizedAccessException("Your Linux user cannot manage this folder.");
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                  or ArgumentException or NotSupportedException)
    { Notice = "Error: " + FileManagerService.SafeError(ex); return Back(); }

    var state = await _samba.ListAsync(HttpContext.RequestAborted);
    if (!state.Available) { Notice = "Error: " + state.Message; return Back(); }
    if (!state.AccountConfigured)
    {
        if (string.IsNullOrEmpty(smbPassword))
        { Notice = "Error: Set your SMB password when sharing for the first time."; return Back(); }
        Notice = await _samba.SetPasswordAsync(smbPassword, adminPassword, HttpContext.RequestAborted);
        if (Notice.StartsWith("Error:", StringComparison.Ordinal)) return Back();
    }
    var name = string.IsNullOrWhiteSpace(shareName) ? folder : shareName.Trim();
    Notice = await _samba.SaveAsync(name, full, readOnly, adminPassword, HttpContext.RequestAborted);
    return Back();
}

public async Task<IActionResult> OnPostUnshareAsync(string name, string? adminPassword)
{ Notice = await _samba.DeleteAsync(name, adminPassword, HttpContext.RequestAborted); return Back(); }

private IActionResult Back() => RedirectToPage(new
{
    path = IsMyFolders ? FolderHome : (string.IsNullOrEmpty(Path) ? "/" : Path),
    hidden = Hidden
});

private static string Act(Action action, string success)
{
    try { action(); return success; }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                               or ArgumentException or NotSupportedException)
    { return "Error: " + FileManagerService.SafeError(ex); }
}
}
        {
    try
    {
        var createdPath = FileManagerService.Absolute(
            rootParent ? name : normalizedParent + "/" + name);
        _folders.Add(createdPath);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                  or ArgumentException)
    { Notice += " Could not pin it automatically: " + ex.Message; }
}
return Back();
    }

    public async Task<IActionResult> OnPostEnableAsync(string? adminPassword)
{
    Notice = await _storage.RunAsync("grant", FileManagerService.Absolute(CurrentRelative), adminPassword, HttpContext.RequestAborted);
    return Back();
}

public async Task<IActionResult> OnPostEnableFolderAsync(string name, string? adminPassword)
{
    var current = _files.Browse("system", CurrentRelative, true);
    if (!current.Available || !current.Items.Any(x => x.Name == name && x.IsDirectory))
    { Notice = "Error: Selected folder not found."; return Back(); }
    var full = FileManagerService.Absolute(string.IsNullOrEmpty(CurrentRelative) ? name : CurrentRelative.Trim('/') + "/" + name);
    if (!_files.CanEnable(full))
    { Notice = "Error: This folder cannot be managed with administrator permissions."; return Back(); }
    Notice = await _storage.RunAsync("grant", full, adminPassword, HttpContext.RequestAborted);
    return Back();
}

public IActionResult OnPostRename(string name, string newName)
{ Notice = Act(() => _files.Rename("system", CurrentRelative, name, newName), "Renamed."); return Back(); }

public IActionResult OnPostDelete(string name)
{ Notice = Act(() => _files.Delete("system", CurrentRelative, name), "Removed."); return Back(); }

public IActionResult OnPostMove(string name, string destination)
{ Notice = Act(() => _files.Move("system", CurrentRelative, name, destination), "Moved."); return Back(); }

public async Task<IActionResult> OnPostUploadAsync(IFormFile? upload)
{
    if (upload is null) { Notice = "Error: Select a file."; return Back(); }
    try { await _files.UploadAsync("system", CurrentRelative, upload, HttpContext.RequestAborted); Notice = "File uploaded."; }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                               or ArgumentException or NotSupportedException)
    { Notice = "Error: " + FileManagerService.SafeError(ex); }
    return Back();
}

public async Task<IActionResult> OnPostShareAsync(
    string folder, string? shareName, bool readOnly, string? smbPassword,
    string? adminPassword, string? absoluteFolder)
{
    string full;
    try
    {
        if (!string.IsNullOrWhiteSpace(absoluteFolder))
        {
            full = MyFoldersStore.Normalize(absoluteFolder);
            if (!_folders.List().Contains(full, StringComparer.Ordinal))
                throw new UnauthorizedAccessException("Add the folder to My Folders before sharing it.");
        }
        else
        {
            var view = _files.Browse("system", CurrentRelative, true);
            if (!view.Available || !view.Items.Any(item => item.IsDirectory && item.Name == folder))
                throw new IOException("Folder not found.");
            var target = string.IsNullOrEmpty(Path) ? folder : Path.Trim('/') + "/" + folder;
            full = FileManagerService.Absolute(target);
        }
        if (!_files.IsManaged(full))
            throw new UnauthorizedAccessException("Your Linux user cannot manage this folder.");
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                  or ArgumentException or NotSupportedException)
    { Notice = "Error: " + FileManagerService.SafeError(ex); return Back(); }

    var state = await _samba.ListAsync(HttpContext.RequestAborted);
    if (!state.Available) { Notice = "Error: " + state.Message; return Back(); }
    if (!state.AccountConfigured)
    {
        if (string.IsNullOrEmpty(smbPassword))
        { Notice = "Error: Set your SMB password when sharing for the first time."; return Back(); }
        Notice = await _samba.SetPasswordAsync(smbPassword, adminPassword, HttpContext.RequestAborted);
        if (Notice.StartsWith("Error:", StringComparison.Ordinal)) return Back();
    }
    var name = string.IsNullOrWhiteSpace(shareName) ? folder : shareName.Trim();
    Notice = await _samba.SaveAsync(name, full, readOnly, adminPassword, HttpContext.RequestAborted);
    return Back();
}

public async Task<IActionResult> OnPostUnshareAsync(string name, string? adminPassword)
{ Notice = await _samba.DeleteAsync(name, adminPassword, HttpContext.RequestAborted); return Back(); }

private IActionResult Back() => RedirectToPage(new
{
    path = IsMyFolders ? FolderHome : (string.IsNullOrEmpty(Path) ? "/" : Path),
    hidden = Hidden
});

private static string Act(Action action, string success)
{
    try { action(); return success; }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                               or ArgumentException or NotSupportedException)
    { return "Error: " + FileManagerService.SafeError(ex); }
}
}
