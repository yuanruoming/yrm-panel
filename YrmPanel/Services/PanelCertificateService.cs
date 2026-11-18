using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace YrmPanel.Services;

public sealed record PanelCertificateInfo(string Subject, string Issuer, string Thumbprint,
    DateTime NotBefore, DateTime NotAfter, bool IsCustom, bool Available);

/// <summary>
/// Self-signed certificate remains the permanent fallback. Uploaded PEM certificate/key
/// are installed as an atomic pointer change, with no full-server restart necessary.
/// </summary>
public sealed class PanelCertificateService
{
    private readonly string _tls;
    private readonly string _pointer;
    private readonly object _lock = new();
    private string _active = "";
    private X509Certificate2? _current;
    public PanelCertificateService(string dataRoot)
    {
        _tls=Path.Combine(dataRoot,"tls");
        _pointer=Path.Combine(_tls,"active-certificate.txt");
    }
    private string SelectFolder()
    {
        if (!File.Exists(_pointer)) return _tls;
        var name=File.ReadAllText(_pointer).Trim();
        if (!name.StartsWith("custom-",StringComparison.Ordinal) ||
            name.Length!=39 || !name[7..].All(Uri.IsHexDigit)) return _tls;
        return Path.Combine(_tls,name);
    }
    public X509Certificate2 Current()
    {
        lock (_lock)
        {
            var folder=SelectFolder();
            if (_current is not null && folder==_active) return _current;
            try
            {
                var value=X509Certificate2.CreateFromPemFile(
                    Path.Combine(folder,"server.crt"),Path.Combine(folder,"server.key"));
                if (!value.HasPrivateKey) throw new InvalidOperationException("Certificate has no private key.");
                _current=value;
                _active=folder;
                return value;
            }
            catch when (_current is not null)
            { return _current; }
        }
    }
    public PanelCertificateInfo Info()
    {
        if (!OperatingSystem.IsLinux())
            return new("Development preview","", "",DateTime.MinValue,DateTime.MinValue,false,false);
        try
        {
            var cert=Current();
            return new(cert.Subject,cert.Issuer,cert.Thumbprint,cert.NotBefore,cert.NotAfter,
                SelectFolder()!=_tls,true);
        }
        catch (Exception ex) when (ex is IOException or CryptographicException or InvalidOperationException)
        { return new("Unavailable","","",DateTime.MinValue,DateTime.MinValue,false,false); }
    }
    public async Task<string> ImportAsync(IFormFile? certificate,IFormFile? key,CancellationToken ct)
    {
        if (!OperatingSystem.IsLinux()) return "Error: Certificate import is Linux-only.";
        if (certificate is null || key is null || certificate.Length is <=0 or >65536 || key.Length is <=0 or >65536)
            return "Error: Choose a PEM certificate and a matching PEM private key (each under 64 KiB).";
        Directory.CreateDirectory(_tls);
        var folder=Path.Combine(_tls,"custom-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            var crt=Path.Combine(folder,"server.crt");
            var pem=Path.Combine(folder,"server.key");
            await using (var stream=new FileStream(crt,FileMode.CreateNew,FileAccess.Write))
                await certificate.CopyToAsync(stream,ct);
            await using (var stream=new FileStream(pem,FileMode.CreateNew,FileAccess.Write))
                await key.CopyToAsync(stream,ct);
            File.SetUnixFileMode(crt,UnixFileMode.UserRead|UnixFileMode.UserWrite);
            File.SetUnixFileMode(pem,UnixFileMode.UserRead|UnixFileMode.UserWrite);
            using (var cert=X509Certificate2.CreateFromPemFile(crt,pem))
            {
                if (!cert.HasPrivateKey || cert.NotAfter.ToUniversalTime()<DateTime.UtcNow)
                    throw new CryptographicException("Certificate and private key do not match or are expired.");
            }
            var tmp=_pointer+".tmp";
            File.WriteAllText(tmp,Path.GetFileName(folder));
            File.SetUnixFileMode(tmp,UnixFileMode.UserRead|UnixFileMode.UserWrite);
            File.Move(tmp,_pointer,true);
            // Next TLS handshake loads the validated certificate via ServerCertificateSelector.
            _=Current();
            return "Custom certificate activated. New HTTPS connections use it immediately.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException or InvalidOperationException)
        {
            try { Directory.Delete(folder,true); } catch { }
            return "Error: "+ex.Message;
        }
    }
    public string RestoreDefault()
    {
        if (!OperatingSystem.IsLinux()) return "Error: Linux only.";
        try
        {
            using (var test=X509Certificate2.CreateFromPemFile(Path.Combine(_tls,"server.crt"),
                       Path.Combine(_tls,"server.key")))
                if (!test.HasPrivateKey) throw new CryptographicException("Default key is missing.");
            if (File.Exists(_pointer)) File.Delete(_pointer);
            _=Current();
            return "Default self-signed certificate restored.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException)
        { return "Error: "+ex.Message; }
    }
}
