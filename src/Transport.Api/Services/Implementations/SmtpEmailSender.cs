using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;
using Transport.Api.Options;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Services.Implementations;

public class SmtpEmailSender(IOptions<SmtpOptions> smtpOptions, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public async Task SendPasswordResetAsync(string toEmail, string fullName, string resetLink, CancellationToken ct = default)
    {
        var smtp = smtpOptions.Value;
        var subject = "Reset your Transport Logistics password";
        var body = $"""
            <p>Hello {System.Net.WebUtility.HtmlEncode(fullName)},</p>
            <p>We received a request to reset your admin password. Click the link below to choose a new password. This link expires in 1 hour.</p>
            <p><a href="{resetLink}">Reset password</a></p>
            <p>If you did not request this, you can ignore this email.</p>
            """;

        if (!smtp.IsConfigured)
        {
            logger.LogWarning(
                "SMTP is not configured (Smtp:Host is empty). Password reset link for {Email}: {ResetLink}",
                toEmail,
                resetLink);
            return;
        }

        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(smtp.FromName, smtp.FromEmail));
            message.To.Add(MailboxAddress.Parse(toEmail));
            message.Subject = subject;
            message.Body = new TextPart("html") { Text = body };

            var socketOptions = smtp.Port switch
            {
                465 => SecureSocketOptions.SslOnConnect,
                587 => SecureSocketOptions.StartTls,
                _ => smtp.UseSsl ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto,
            };

            using var client = new SmtpClient();
            await client.ConnectAsync(smtp.Host, smtp.Port, socketOptions, ct);
            if (!string.IsNullOrWhiteSpace(smtp.Username))
                await client.AuthenticateAsync(smtp.Username, smtp.Password, ct);
            await client.SendAsync(message, ct);
            await client.DisconnectAsync(true, ct);

            logger.LogInformation("Password reset email sent to {Email} via {Host}:{Port}", toEmail, smtp.Host, smtp.Port);
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Failed to send password reset email to {Email} via {Host}:{Port}. Dev fallback link: {ResetLink}",
                toEmail,
                smtp.Host,
                smtp.Port,
                resetLink);
            throw;
        }
    }
}
