using Microsoft.EntityFrameworkCore;
using Transport.Domain.Entities;
using Transport.Domain.Enums;

namespace Transport.Infrastructure.Data;

public static class DatabaseSeed
{
    public static async Task SeedAsync(TransportDbContext db, CancellationToken ct = default)
    {
        if (await db.Branches.AnyAsync(ct))
            return;

        var dhaka = new Branch
        {
            BranchName = "Dhaka Central",
            Code = "DHAKA-01",
            Address = "Dhaka, Bangladesh"
        };
        db.Branches.Add(dhaka);
        await db.SaveChangesAsync(ct);

        var admin = new User
        {
            FullName = "System Admin",
            Phone = "admin",
            Role = UserRole.Admin,
            IsActive = true,
            BranchId = null,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin123!")
        };
        db.Users.Add(admin);

        var staff = new User
        {
            FullName = "Branch Staff",
            Phone = "staff",
            Role = UserRole.Staff,
            IsActive = true,
            BranchId = dhaka.Id,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Staff123!")
        };
        db.Users.Add(staff);

        await db.SaveChangesAsync(ct);
    }
}
