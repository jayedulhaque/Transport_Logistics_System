namespace Transport.Api.Options;

public class AppOptions
{
    public const string SectionName = "App";

    /// <summary>Public URL of the web console (used in password-reset links).</summary>
    public string PublicWebUrl { get; set; } = "http://localhost:3000";
}
