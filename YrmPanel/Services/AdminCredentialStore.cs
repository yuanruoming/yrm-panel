using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace YrmPanel.Services;

/// <summary>
/// A single local administrator. Backward-compatible with v0.1 admin.json,
/// which did not contain a Username property.
/// </summary>
public sealed class AdminCredentialStore
{
    private readonly string _path;
    private sealed record Credential(int Iterations, string Salt, string Hash, string? Username = null);
    private static readonly Regex UserPattern = new("^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public AdminCredentialStore(string dataRoot) => _path = Path.Combine(dataRoot, "admin.json");
    public bool IsConfigured => File.Exists(_path);

    private Credential? Read()
    {
        try
        {
            return JsonSerializer.Deserialize<Credential>(File.ReadAllText(_path));
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public string Username => Read() is { } entry && !string.IsNullOrWhiteSpace(entry.Username)
        ? entry.Username : "admin";

    // Invalidates all existing cookie sessions when credentials are reconfigured.
    public string SessionStamp
    {
        get
        {
            var entry = Read();
            if (entry is null) return "";
            var content = $"{entry.Username ?? "admin"}:{entry.Salt}:{entry.Hash}";
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
        }
    }

    public bool Verify(string username, string password)
    {
        var entry = Read();
        if (entry is null || entry.Iterations < 100_000 || entry.Iterations > 2_000_000) return false;
        if (!string.Equals(username, string.IsNullOrWhiteSpace(entry.Username) ? "admin" : entry.Username,
                StringComparison.OrdinalIgnoreCase)) return false;
        try
        {
            var salt = Convert.FromBase64String(entry.Salt);
            var expected = Convert.FromBase64String(entry.Hash);
            if (salt.Length != 16 || expected.Length != 32) return false;
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, entry.Iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (Exception e) when (e is FormatException or ArgumentException)
        {
            return false;
        }
    }

    public async Task ConfigureFromConsoleAsync()
    {
        if (Console.IsInputRedirected)
        {
            Console.Error.WriteLine("Admin setup requires an interactive terminal. Never pass passwords as command arguments.");
            Environment.ExitCode = 2;
            return;
        }
        Console.WriteLine("YRM Panel account setup");
        Console.Write("Username (3-32 letters/numbers/._-): ");
        var username = (Console.ReadLine() ?? "").Trim();
        if (!UserPattern.IsMatch(username))
        {
            Console.Error.WriteLine("Invalid username. Use 3-32 letters, numbers, dots, underscores or dashes; start with a letter or number.");
            Environment.ExitCode = 2;
            return;
        }
        var password = ReadSecret("Password (minimum 12 chars): ");
        var repeat = ReadSecret("Confirm password           : ");
        if (password.Length < 12 || password != repeat)
        {
            Console.Error.WriteLine("Passwords do not match, or password is too short.");
            Environment.ExitCode = 2;
            return;
        }
        var salt = RandomNumberGenerator.GetBytes(16);
        const int iterations = 210_000;
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, 32);
        var credential = new Credential(iterations, Convert.ToBase64String(salt), Convert.ToBase64String(hash), username);
        var temp = _path + ".tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(credential));
        if (OperatingSystem.IsLinux()) File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(temp, _path, true);
        Console.WriteLine($"Account configured. Username: {username}");
    }

    private static string ReadSecret(string prompt)
    {
        Console.Write(prompt);
        var result = new System.Text.StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return result.ToString(); }
            if (key.Key == ConsoleKey.Backspace) { if (result.Length > 0) result.Length--; continue; }
            if (!char.IsControl(key.KeyChar) && result.Length < 256) result.Append(key.KeyChar);
        }
    }
}
