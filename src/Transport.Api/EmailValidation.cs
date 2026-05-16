using System.Net.Mail;

namespace Transport.Api;

public static class EmailValidation
{
    public static string? Normalize(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        return email.Trim().ToLowerInvariant();
    }

    public static bool IsValid(string? email)
    {
        var normalized = Normalize(email);
        if (normalized is null) return false;
        try
        {
            _ = new MailAddress(normalized);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
