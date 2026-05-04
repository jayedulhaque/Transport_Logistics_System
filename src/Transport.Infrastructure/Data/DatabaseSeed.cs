using Microsoft.EntityFrameworkCore;
using Transport.Domain.Entities;
using Transport.Domain.Enums;

namespace Transport.Infrastructure.Data;

public static class DatabaseSeed
{
    public static async Task SeedAsync(TransportDbContext db, CancellationToken ct = default)
    {
        Branch? branch;
        if (!await db.Branches.AnyAsync(ct))
        {
            branch = new Branch
            {
                BranchName = "Dhaka Central",
                Code = "DHAKA-01",
                Address = "Dhaka, Bangladesh"
            };
            db.Branches.Add(branch);
            await db.SaveChangesAsync(ct);
        }
        else
        {
            branch = await db.Branches.OrderBy(b => b.Id).FirstAsync(ct);
        }

        await EnsureUserAsync(
            db,
            phone: "admin",
            fullName: "System Admin",
            role: UserRole.Admin,
            branchId: null,
            password: "Admin123!",
            ct);

        await EnsureUserAsync(
            db,
            phone: "staff",
            fullName: "Branch Staff",
            role: UserRole.Staff,
            branchId: branch.Id,
            password: "Staff123!",
            ct);

        await EnsureUserAsync(
            db,
            phone: "branchmanager",
            fullName: "Branch Manager",
            role: UserRole.BranchManager,
            branchId: branch.Id,
            password: "Manager123!",
            ct);
    }

    private static async Task EnsureUserAsync(
        TransportDbContext db,
        string phone,
        string fullName,
        UserRole role,
        int? branchId,
        string password,
        CancellationToken ct)
    {
        var existing = await db.Users.FirstOrDefaultAsync(u => u.Phone == phone, ct);
        if (existing is not null)
            return;

        db.Users.Add(new User
        {
            FullName = fullName,
            Phone = phone,
            Role = role,
            IsActive = true,
            BranchId = branchId,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password)
        });
        await db.SaveChangesAsync(ct);
    }
}
