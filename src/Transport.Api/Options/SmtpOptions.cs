namespace Transport.Api.Options;

public class SmtpOptions
{
    public const string SectionName = "Smtp";

    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public bool UseSsl { get; set; } = true;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string FromEmail { get; set; } = "noreply@transport.local";
    public string FromName { get; set; } = "Transport Logistics";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Host);
}
