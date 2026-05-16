using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class User
{
    public int Id { get; set; }
    public int? BranchId { get; set; }
    public string FullName { get; set; } = string.Empty;
    /// <summary>Unique login identifier (mobile or username).</summary>
    public string Phone { get; set; } = string.Empty;
    /// <summary>Optional email (used for admin password recovery).</summary>
    public string? Email { get; set; }
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public string? PasswordHash { get; set; }

    public Branch? Branch { get; set; }
    public DriverProfile? DriverProfile { get; set; }
}
