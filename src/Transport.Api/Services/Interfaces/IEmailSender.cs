namespace Transport.Api.Services.Interfaces;

public interface IEmailSender
{
    Task SendPasswordResetAsync(string toEmail, string fullName, string resetLink, CancellationToken ct = default);
}
