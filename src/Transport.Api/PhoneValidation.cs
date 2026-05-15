namespace Transport.Api;

public static class PhoneValidation
{
    public static string NormalizeMobile(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return string.Empty;
        var chars = input.Trim().Where(char.IsDigit).ToArray();
        return new string(chars);
    }

    public static bool TryValidateMobile(string? input, out string normalized, out string error)
    {
        normalized = NormalizeMobile(input);
        if (normalized.Length < 9 || normalized.Length > 15)
        {
            error = "Enter a valid mobile number (9–15 digits).";
            return false;
        }

        error = string.Empty;
        return true;
    }

    /// <summary>Login lookup: normalized mobile when valid; otherwise trimmed login id (e.g. admin).</summary>
    public static string PhoneForLoginLookup(string? input)
    {
        var trimmed = input?.Trim() ?? string.Empty;
        if (TryValidateMobile(trimmed, out var normalized, out _))
            return normalized;
        return trimmed;
    }
}
