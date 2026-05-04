using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Transport.Api.Auth;
using Transport.Api.Contracts;
using Transport.Api.Hubs;
using Transport.Api.Repositories.Interfaces;
using Transport.Api.Services.Interfaces;
using Transport.Domain.Entities;
using Transport.Domain.Enums;

namespace Transport.Api.Services.Implementations;

public class TransportService(ITransportRepository repo, TokenService tokens) : ITransportService
{
    public async Task<IResult> GetPublicBranchesAsync(CancellationToken ct = default)
    {
        var list = await repo.Branches.AsNoTracking()
            .OrderBy(b => b.Code)
            .Select(b => new BranchDto(b.Id, b.BranchName, b.Code, b.Address))
            .ToListAsync(ct);
        return Results.Ok(list);
    }

    public async Task<IResult> GetBranchesAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)) || principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var list = await repo.Branches.AsNoTracking()
                .OrderBy(b => b.Code)
                .Select(b => new BranchDto(b.Id, b.BranchName, b.Code, b.Address))
                .ToListAsync(ct);
            return Results.Ok(list);
        }

        if (principal.IsInRole(nameof(UserRole.Staff)))
        {
            var branchIdResult = TryGetBranchId(principal, "Staff must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var branchId = branchIdResult.branchId!.Value;

            var row = await repo.Branches.AsNoTracking()
                .Where(b => b.Id == branchId)
                .Select(b => new BranchDto(b.Id, b.BranchName, b.Code, b.Address))
                .FirstOrDefaultAsync(ct);
            return row is null ? Results.NotFound() : Results.Ok(new List<BranchDto> { row });
        }

        return Results.Forbid();
    }

    public async Task<IResult> CreateBranchAsync(UpsertBranchRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var name = body.BranchName.Trim();
        var code = body.Code.Trim();
        var address = body.Address.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(code))
            return Results.BadRequest(new { error = "Branch name and code are required." });

        if (await repo.Branches.AnyAsync(b => b.Code == code, ct))
            return Results.Conflict(new { error = "A branch with this code already exists." });

        var branch = new Branch { BranchName = name, Code = code, Address = address };
        await repo.AddAsync(branch, ct);
        await repo.SaveChangesAsync(ct);

        return Results.Created($"/api/branches/{branch.Id}", new BranchDto(branch.Id, branch.BranchName, branch.Code, branch.Address));
    }

    public async Task<IResult> UpdateBranchAsync(int id, UpsertBranchRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var branch = await repo.Branches.FirstOrDefaultAsync(b => b.Id == id, ct);
        if (branch is null) return Results.NotFound();

        var name = body.BranchName.Trim();
        var code = body.Code.Trim();
        var address = body.Address.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(code))
            return Results.BadRequest(new { error = "Branch name and code are required." });

        if (await repo.Branches.AnyAsync(b => b.Code == code && b.Id != id, ct))
            return Results.Conflict(new { error = "A branch with this code already exists." });

        branch.BranchName = name;
        branch.Code = code;
        branch.Address = address;
        await repo.SaveChangesAsync(ct);
        return Results.Ok(new BranchDto(branch.Id, branch.BranchName, branch.Code, branch.Address));
    }

    public async Task<IResult> DeleteBranchAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var branch = await repo.Branches.FirstOrDefaultAsync(b => b.Id == id, ct);
        if (branch is null) return Results.NotFound();

        if (await repo.Users.AnyAsync(u => u.BranchId == id, ct))
            return Results.BadRequest(new { error = "Cannot delete a branch that has users assigned." });
        if (await repo.Products.AnyAsync(p => p.OriginBranchId == id || p.DestinationBranchId == id || p.CurrentBranchId == id, ct))
            return Results.BadRequest(new { error = "Cannot delete a branch referenced by products." });
        if (await repo.Trips.AnyAsync(t => t.OriginBranchId == id || t.DestinationBranchId == id, ct))
            return Results.BadRequest(new { error = "Cannot delete a branch referenced by trips." });

        repo.Remove(branch);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> LoginAsync(LoginRequest body, CancellationToken ct = default)
    {
        var user = await repo.Users
            .Include(u => u.DriverProfile)
            .FirstOrDefaultAsync(u => u.Phone == body.Phone && u.IsActive, ct);
        if (user?.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(body.Password, user.PasswordHash))
            return Results.Unauthorized();

        var token = tokens.CreateToken(user);
        return Results.Ok(new LoginResponse(
            token, user.Id, user.FullName, user.Role.ToString(), user.BranchId, user.DriverProfile?.Id,
            user.DriverProfile?.IsApproved ?? true));
    }

    public async Task<IResult> RegisterDriverAsync(RegisterDriverRequest body, CancellationToken ct = default)
    {
        if (await repo.Users.AnyAsync(u => u.Phone == body.Phone, ct))
            return Results.Conflict(new { error = "Phone already registered." });
        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct))
            return Results.BadRequest(new { error = "Invalid branch." });

        var user = new User
        {
            FullName = body.FullName,
            Phone = body.Phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.Password),
            Role = UserRole.Driver,
            BranchId = body.BranchId,
            IsActive = true
        };
        await repo.AddAsync(user, ct);
        await repo.SaveChangesAsync(ct);

        var profile = new DriverProfile
        {
            UserId = user.Id,
            VehicleNumber = body.VehicleNumber,
            IsApproved = false,
            IsOnline = false,
            CurrentLat = 0,
            CurrentLng = 0
        };
        await repo.AddAsync(profile, ct);
        await repo.SaveChangesAsync(ct);
        return Results.Created($"/api/drivers/{profile.Id}", new { driverProfileId = profile.Id, user.Id });
    }

    public async Task<IResult> GetBranchCollectionsAsync(string? fromDate, string? toDate, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        DateTime? startUtc = null;
        DateTime? endUtcExclusive = null;

        if (!string.IsNullOrWhiteSpace(fromDate))
        {
            if (!DateOnly.TryParse(fromDate, out var from)) return Results.BadRequest(new { error = "Invalid fromDate. Use YYYY-MM-DD." });
            startUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        }
        if (!string.IsNullOrWhiteSpace(toDate))
        {
            if (!DateOnly.TryParse(toDate, out var to)) return Results.BadRequest(new { error = "Invalid toDate. Use YYYY-MM-DD." });
            endUtcExclusive = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        }
        if (startUtc.HasValue && endUtcExclusive.HasValue && startUtc.Value >= endUtcExclusive.Value)
            return Results.BadRequest(new { error = "fromDate must be before or equal to toDate." });

        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            var rows = await (from p in repo.Products.AsNoTracking()
                              where p.Status == ProductStatus.Delivered
                                    && p.DeliveredAt != null
                                    && (!startUtc.HasValue || p.DeliveredAt >= startUtc.Value)
                                    && (!endUtcExclusive.HasValue || p.DeliveredAt < endUtcExclusive.Value)
                              join b in repo.Branches.AsNoTracking() on p.DestinationBranchId equals b.Id
                              group p by new { p.DestinationBranchId, b.BranchName } into g
                              orderby g.Key.BranchName
                              select new BranchCollectionRowDto(g.Key.DestinationBranchId, g.Key.BranchName, g.Sum(x => x.ShippingPrice)))
                .ToListAsync(ct);
            return Results.Ok(rows);
        }

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var branchId = branchIdResult.branchId!.Value;

            var name = await repo.Branches.AsNoTracking().Where(b => b.Id == branchId).Select(b => b.BranchName).FirstOrDefaultAsync(ct);
            if (name is null) return Results.NotFound();

            var total = await repo.Products.AsNoTracking()
                .Where(p => p.Status == ProductStatus.Delivered
                            && p.DestinationBranchId == branchId
                            && p.DeliveredAt != null
                            && (!startUtc.HasValue || p.DeliveredAt >= startUtc.Value)
                            && (!endUtcExclusive.HasValue || p.DeliveredAt < endUtcExclusive.Value))
                .SumAsync(p => (decimal?)p.ShippingPrice, ct) ?? 0m;

            return Results.Ok(new List<BranchCollectionRowDto> { new(branchId, name, total) });
        }

        return Results.Forbid();
    }

    public async Task<IResult> GetPendingDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var list = await repo.DriverProfiles.AsNoTracking()
            .Where(d => !d.IsApproved)
            .Include(d => d.User).ThenInclude(u => u.Branch)
            .Select(d => new PendingDriverDto(d.Id, d.UserId, d.User.FullName, d.User.Phone, d.VehicleNumber, d.User.BranchId, d.User.Branch != null ? d.User.Branch.BranchName : null))
            .ToListAsync(ct);
        return Results.Ok(list);
    }

    public async Task<IResult> GetApprovedDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            var list = await repo.DriverProfiles.AsNoTracking()
                .Where(d => d.IsApproved)
                .Include(d => d.User).ThenInclude(u => u.Branch)
                .OrderBy(d => d.User.FullName)
                .Select(d => new ApprovedDriverDto(d.Id, d.UserId, d.User.FullName, d.User.Phone, d.VehicleNumber, d.User.BranchId, d.User.Branch != null ? d.User.Branch.BranchName : null, d.IsOnline))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;

            var list = await repo.DriverProfiles.AsNoTracking()
                .Where(d => d.IsApproved && d.User.BranchId == bid)
                .Include(d => d.User).ThenInclude(u => u.Branch)
                .OrderBy(d => d.User.FullName)
                .Select(d => new ApprovedDriverDto(d.Id, d.UserId, d.User.FullName, d.User.Phone, d.VehicleNumber, d.User.BranchId, d.User.Branch != null ? d.User.Branch.BranchName : null, d.IsOnline))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        return Results.Forbid();
    }

    public async Task<IResult> UpdateDriverBranchAsync(int id, UpdateDriverBranchRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct)) return Results.BadRequest(new { error = "Invalid branch." });

        var profile = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == id, ct);
        if (profile is null) return Results.NotFound();
        profile.User.BranchId = body.BranchId;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> ApproveDriverAsync(int id, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var profile = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == id, ct);
        if (profile is null) return Results.NotFound();
        profile.IsApproved = true;
        await repo.SaveChangesAsync(ct);
        await hub.Clients.Group($"user-{profile.UserId}").SendAsync("DriverApproved", profile.Id, ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetDriverStatusAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.AsNoTracking().FirstOrDefaultAsync(d => d.UserId == userId, ct);
        return Results.Ok(new DriverStatusResponse(profile?.IsApproved ?? false, profile?.Id));
    }

    public async Task<IResult> UpdateDriverPresenceAsync(PresenceRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null) return Results.NotFound();
        profile.IsOnline = body.IsOnline;
        profile.LastSeenAt = DateTime.UtcNow;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> UpdateDriverLocationAsync(LocationRequest body, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default)
    {
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null) return Results.NotFound();
        profile.CurrentLat = body.Latitude;
        profile.CurrentLng = body.Longitude;
        profile.LastSeenAt = DateTime.UtcNow;
        await repo.SaveChangesAsync(ct);
        await hub.Clients.Group("live-tracking").SendAsync("LocationUpdated", profile.Id, body.Latitude, body.Longitude, ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetDriverLocationsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            var list = await repo.DriverProfiles.AsNoTracking()
                .Where(d => d.IsApproved)
                .Include(d => d.User)
                .OrderBy(d => d.User.FullName)
                .Select(d => new DriverLivePositionDto(d.Id, d.User.FullName, d.VehicleNumber, d.CurrentLat, d.CurrentLng, d.LastSeenAt, d.IsOnline))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        if (principal.IsInRole(nameof(UserRole.Staff)) || principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch users must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var branchId = branchIdResult.branchId!.Value;
            var list = await repo.DriverProfiles.AsNoTracking()
                .Where(d => d.IsApproved && d.User.BranchId == branchId)
                .Include(d => d.User)
                .OrderBy(d => d.User.FullName)
                .Select(d => new DriverLivePositionDto(d.Id, d.User.FullName, d.VehicleNumber, d.CurrentLat, d.CurrentLng, d.LastSeenAt, d.IsOnline))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        return Results.Forbid();
    }

    public async Task<IResult> CreateStaffAsync(CreateStaffRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var fullName = body.FullName.Trim();
        var phone = body.Phone.Trim();
        if (string.IsNullOrWhiteSpace(fullName) || string.IsNullOrWhiteSpace(phone) || string.IsNullOrWhiteSpace(body.Password))
            return Results.BadRequest(new { error = "Name, phone, and password are required." });

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (body.BranchId != branchIdResult.branchId) return Results.Forbid();
        }

        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct)) return Results.BadRequest(new { error = "Invalid branch." });
        if (await repo.Users.AnyAsync(u => u.Phone == phone, ct)) return Results.Conflict(new { error = "Phone is already used by another account." });

        var staff = new User
        {
            FullName = fullName,
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.Password),
            Role = UserRole.Staff,
            BranchId = body.BranchId,
            IsActive = true
        };
        await repo.AddAsync(staff, ct);
        await repo.SaveChangesAsync(ct);
        return Results.Created($"/api/staff/{staff.Id}", new { staff.Id });
    }

    public async Task<IResult> GetStaffAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            var list = await repo.Users.AsNoTracking()
                .Where(u => u.Role == UserRole.Staff)
                .Include(u => u.Branch)
                .OrderBy(u => u.FullName)
                .Select(u => new StaffListItemDto(u.Id, u.FullName, u.Phone, u.BranchId, u.Branch != null ? u.Branch.BranchName : null, u.IsActive))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var branchId = branchIdResult.branchId!.Value;

            var list = await repo.Users.AsNoTracking()
                .Where(u => u.Role == UserRole.Staff && u.BranchId == branchId)
                .Include(u => u.Branch)
                .OrderBy(u => u.FullName)
                .Select(u => new StaffListItemDto(u.Id, u.FullName, u.Phone, u.BranchId, u.Branch != null ? u.Branch.BranchName : null, u.IsActive))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        return Results.Forbid();
    }

    public async Task<IResult> UpdateStaffAsync(int id, UpdateStaffRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var fullName = body.FullName.Trim();
        var phone = body.Phone.Trim();
        if (string.IsNullOrWhiteSpace(fullName) || string.IsNullOrWhiteSpace(phone))
            return Results.BadRequest(new { error = "Name and phone are required." });

        var staff = await repo.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRole.Staff, ct);
        if (staff is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var mgrBranchId = branchIdResult.branchId!.Value;
            if (staff.BranchId != mgrBranchId || body.BranchId != mgrBranchId) return Results.Forbid();
        }

        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct)) return Results.BadRequest(new { error = "Invalid branch." });
        if (await repo.Users.AnyAsync(u => u.Phone == phone && u.Id != id, ct)) return Results.Conflict(new { error = "Phone is already used by another account." });

        staff.FullName = fullName;
        staff.Phone = phone;
        staff.BranchId = body.BranchId;
        staff.IsActive = body.IsActive;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> DeleteStaffAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var staff = await repo.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRole.Staff, ct);
        if (staff is null) return Results.NotFound();
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (staff.BranchId != branchIdResult.branchId) return Results.Forbid();
        }
        repo.Remove(staff);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetBranchManagersAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var list = await repo.Users.AsNoTracking()
            .Where(u => u.Role == UserRole.BranchManager)
            .Include(u => u.Branch)
            .OrderBy(u => u.FullName)
            .Select(u => new StaffListItemDto(u.Id, u.FullName, u.Phone, u.BranchId, u.Branch != null ? u.Branch.BranchName : null, u.IsActive))
            .ToListAsync(ct);
        return Results.Ok(list);
    }

    public async Task<IResult> CreateBranchManagerAsync(CreateBranchManagerRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var fullName = body.FullName.Trim();
        var phone = body.Phone.Trim();
        if (string.IsNullOrWhiteSpace(fullName) || string.IsNullOrWhiteSpace(phone) || string.IsNullOrWhiteSpace(body.Password))
            return Results.BadRequest(new { error = "Name, phone, and password are required." });
        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct)) return Results.BadRequest(new { error = "Invalid branch." });
        if (await repo.Users.AnyAsync(u => u.Phone == phone, ct)) return Results.Conflict(new { error = "Phone is already used by another account." });
        var mgr = new User
        {
            FullName = fullName,
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.Password),
            Role = UserRole.BranchManager,
            BranchId = body.BranchId,
            IsActive = true
        };
        await repo.AddAsync(mgr, ct);
        await repo.SaveChangesAsync(ct);
        return Results.Created($"/api/branch-managers/{mgr.Id}", new { mgr.Id });
    }

    public async Task<IResult> UpdateBranchManagerAsync(int id, UpdateBranchManagerRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var fullName = body.FullName.Trim();
        var phone = body.Phone.Trim();
        if (string.IsNullOrWhiteSpace(fullName) || string.IsNullOrWhiteSpace(phone))
            return Results.BadRequest(new { error = "Name and phone are required." });

        var mgr = await repo.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRole.BranchManager, ct);
        if (mgr is null) return Results.NotFound();
        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct)) return Results.BadRequest(new { error = "Invalid branch." });
        if (await repo.Users.AnyAsync(u => u.Phone == phone && u.Id != id, ct)) return Results.Conflict(new { error = "Phone is already used by another account." });

        mgr.FullName = fullName;
        mgr.Phone = phone;
        mgr.BranchId = body.BranchId;
        mgr.IsActive = body.IsActive;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> DeleteBranchManagerAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var mgr = await repo.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRole.BranchManager, ct);
        if (mgr is null) return Results.NotFound();
        repo.Remove(mgr);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetAvailableDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var branchIdResult = TryGetBranchId(principal, "Branch users must have a branch assigned.");
        if (branchIdResult.error is not null) return branchIdResult.error;
        var branchId = branchIdResult.branchId!.Value;

        var list = await repo.DriverProfiles.AsNoTracking()
            .Where(d => d.IsApproved && d.IsOnline && d.User.BranchId == branchId)
            .Select(d => new AvailableDriverDto(d.Id, d.User.FullName, d.VehicleNumber, d.IsOnline))
            .ToListAsync(ct);
        return Results.Ok(list);
    }

    public async Task<IResult> LookupProductAsync(string tracking, string? mode, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var branchIdResult = TryGetBranchId(principal, "Branch users must have a branch assigned.");
        if (branchIdResult.error is not null) return branchIdResult.error;
        var staffBranchId = branchIdResult.branchId!.Value;

        var product = await repo.Products.AsNoTracking().FirstOrDefaultAsync(p => p.TrackingNumber == tracking, ct);
        if (product is null) return Results.NotFound();

        var isUnload = string.Equals(mode, "unload", StringComparison.OrdinalIgnoreCase);
        if (isUnload)
        {
            if (product.Status != ProductStatus.InTransit) return Results.BadRequest(new { error = "Only in-transit products can be unloaded." });
            if (product.DestinationBranchId != staffBranchId) return Results.BadRequest(new { error = "Product destination does not match your branch." });
        }
        else if (product.CurrentBranchId != staffBranchId) return Results.BadRequest(new { error = "Product is not at your branch." });

        return Results.Ok(new { product.Id, product.TrackingNumber, status = product.Status.ToString() });
    }

    public async Task<IResult> CreateProductAsync(CreateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (body.OriginBranchId != branchIdResult.branchId) return Results.Forbid();
        }
        var originExists = await repo.Branches.AnyAsync(b => b.Id == body.OriginBranchId, ct);
        var destExists = await repo.Branches.AnyAsync(b => b.Id == body.DestinationBranchId, ct);
        if (!originExists || !destExists) return Results.BadRequest(new { error = "Invalid origin or destination branch." });
        if (body.ShippingPrice < 0) return Results.BadRequest(new { error = "Shipping price cannot be negative." });

        var product = new Product
        {
            Id = Guid.NewGuid(),
            TrackingNumber = $"TN-{Guid.NewGuid():N}"[..18],
            Description = body.Description.Trim(),
            SenderName = body.SenderName.Trim(),
            SenderPhone = body.SenderPhone.Trim(),
            SenderAddress = body.SenderAddress.Trim(),
            ReceiverName = body.ReceiverName.Trim(),
            ReceiverPhone = body.ReceiverPhone.Trim(),
            ReceiverAddress = body.ReceiverAddress.Trim(),
            ShippingPrice = body.ShippingPrice,
            OriginBranchId = body.OriginBranchId,
            DestinationBranchId = body.DestinationBranchId,
            CurrentBranchId = body.OriginBranchId,
            Status = ProductStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };
        await repo.AddAsync(product, ct);
        await repo.SaveChangesAsync(ct);
        return Results.Ok(new ProductCreatedResponse(product.Id, product.TrackingNumber, product.ShippingPrice));
    }

    public async Task<IResult> GetProductsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            var list = await (from p in repo.Products.AsNoTracking()
                              join ob in repo.Branches.AsNoTracking() on p.OriginBranchId equals ob.Id
                              join dbDest in repo.Branches.AsNoTracking() on p.DestinationBranchId equals dbDest.Id
                              orderby p.CreatedAt descending
                              select new ProductListItemDto(p.Id, p.TrackingNumber, p.Description, p.SenderName, p.SenderPhone, p.SenderAddress, p.ReceiverName, p.ReceiverPhone, p.ReceiverAddress, p.OriginBranchId, p.DestinationBranchId, ob.BranchName, dbDest.BranchName, p.ShippingPrice, p.Status.ToString(), p.CreatedAt))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;

            var list = await (from p in repo.Products.AsNoTracking()
                              where p.OriginBranchId == bid || p.DestinationBranchId == bid || p.CurrentBranchId == bid
                              join ob in repo.Branches.AsNoTracking() on p.OriginBranchId equals ob.Id
                              join dbDest in repo.Branches.AsNoTracking() on p.DestinationBranchId equals dbDest.Id
                              orderby p.CreatedAt descending
                              select new ProductListItemDto(p.Id, p.TrackingNumber, p.Description, p.SenderName, p.SenderPhone, p.SenderAddress, p.ReceiverName, p.ReceiverPhone, p.ReceiverAddress, p.OriginBranchId, p.DestinationBranchId, ob.BranchName, dbDest.BranchName, p.ShippingPrice, p.Status.ToString(), p.CreatedAt))
                .ToListAsync(ct);
            return Results.Ok(list);
        }
        return Results.Forbid();
    }

    public async Task<IResult> UpdateProductAsync(Guid id, UpdateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var originExists = await repo.Branches.AnyAsync(b => b.Id == body.OriginBranchId, ct);
        var destExists = await repo.Branches.AnyAsync(b => b.Id == body.DestinationBranchId, ct);
        if (!originExists || !destExists) return Results.BadRequest(new { error = "Invalid origin or destination branch." });
        if (body.ShippingPrice < 0) return Results.BadRequest(new { error = "Shipping price cannot be negative." });

        var product = await repo.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;
            if (!ProductTouchesBranch(product, bid)) return Results.Forbid();
            var effectiveCurrent = product.Status == ProductStatus.Pending ? body.OriginBranchId : product.CurrentBranchId;
            var stillTouches = body.OriginBranchId == bid || body.DestinationBranchId == bid || effectiveCurrent == bid;
            if (!stillTouches) return Results.BadRequest(new { error = "Updated shipment must remain associated with your branch." });
        }

        product.Description = body.Description.Trim();
        product.SenderName = body.SenderName.Trim();
        product.SenderPhone = body.SenderPhone.Trim();
        product.SenderAddress = body.SenderAddress.Trim();
        product.ReceiverName = body.ReceiverName.Trim();
        product.ReceiverPhone = body.ReceiverPhone.Trim();
        product.ReceiverAddress = body.ReceiverAddress.Trim();
        product.OriginBranchId = body.OriginBranchId;
        product.DestinationBranchId = body.DestinationBranchId;
        product.ShippingPrice = body.ShippingPrice;
        if (product.Status == ProductStatus.Pending) product.CurrentBranchId = body.OriginBranchId;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> DeleteProductAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var product = await repo.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return Results.NotFound();
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (!ProductTouchesBranch(product, branchIdResult.branchId!.Value)) return Results.Forbid();
        }
        if (await repo.TripProducts.AnyAsync(tp => tp.ProductId == id, ct))
            return Results.BadRequest(new { error = "Cannot delete a product that has been assigned to a trip." });
        repo.Remove(product);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> DeliverProductAsync(Guid id, DeliverProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)) && !principal.IsInRole(nameof(UserRole.Staff)))
            return Results.Forbid();

        var product = await repo.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return Results.NotFound();

        if (!principal.IsInRole(nameof(UserRole.Admin)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch users must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var branchId = branchIdResult.branchId!.Value;
            if (product.CurrentBranchId != branchId) return Results.BadRequest(new { error = "Product must be at your branch to mark delivered." });
            if (principal.IsInRole(nameof(UserRole.BranchManager)) && product.DestinationBranchId != branchId)
                return Results.BadRequest(new { error = "Only the destination branch manager can mark this product delivered." });
        }

        if (product.Status != ProductStatus.Downloaded) return Results.BadRequest(new { error = "Only unloaded products can be marked delivered." });
        var enteredPhone = body.ReceiverPhone.Trim();
        if (!string.Equals(enteredPhone, product.ReceiverPhone, StringComparison.Ordinal))
            return Results.BadRequest(new { error = "Receiver phone does not match this product." });
        if (!body.PaidBySender && !body.PaymentReceivedAtBranch)
            return Results.BadRequest(new { error = "Confirm payment at branch before delivery." });

        product.Status = ProductStatus.Delivered;
        product.DeliveredAt = DateTime.UtcNow;
        if (product.CurrentBranchId is null) product.CurrentBranchId = product.DestinationBranchId;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> LoadTripAsync(TripLoadRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var branchIdResult = TryGetBranchId(principal, "Branch users must have a branch assigned.");
        if (branchIdResult.error is not null) return branchIdResult.error;
        var staffBranchId = branchIdResult.branchId!.Value;

        if (body.ProductIds.Count == 0) return Results.BadRequest(new { error = "No products selected." });
        var driver = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == body.DriverProfileId, ct);
        if (driver is null || !driver.IsApproved || driver.User.BranchId != staffBranchId)
            return Results.BadRequest(new { error = "Invalid driver for this branch." });

        await using var tx = await repo.BeginTransactionAsync(ct);
        var products = await repo.Products.Where(p => body.ProductIds.Contains(p.Id)).ToListAsync(ct);
        if (products.Count != body.ProductIds.Count) return Results.BadRequest(new { error = "One or more products were not found." });
        foreach (var p in products)
        {
            if (p.CurrentBranchId != staffBranchId) return Results.BadRequest(new { error = $"Product {p.Id} is not at your branch." });
            if (p.Status != ProductStatus.Pending) return Results.BadRequest(new { error = $"Product {p.TrackingNumber} is not pending." });
        }
        var destId = products[0].DestinationBranchId;
        if (products.Any(p => p.DestinationBranchId != destId))
            return Results.BadRequest(new { error = "All products in a load must share the same destination branch." });

        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            DriverProfileId = driver.Id,
            OriginBranchId = staffBranchId,
            DestinationBranchId = destId,
            LoadTime = DateTime.UtcNow,
            Status = TripStatus.Active
        };
        await repo.AddAsync(trip, ct);
        foreach (var p in products)
        {
            await repo.AddAsync(new TripProduct { TripId = trip.Id, ProductId = p.Id }, ct);
            p.Status = ProductStatus.InTransit;
            p.CurrentBranchId = null;
        }
        await repo.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new TripLoadResponse(trip.Id));
    }

    public async Task<IResult> UnloadTripAsync(TripUnloadRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var branchIdResult = TryGetBranchId(principal, "Branch users must have a branch assigned.");
        if (branchIdResult.error is not null) return branchIdResult.error;
        var staffBranchId = branchIdResult.branchId!.Value;

        if (body.ProductIds.Count == 0) return Results.BadRequest(new { error = "No products selected." });
        var products = await repo.Products.Where(p => body.ProductIds.Contains(p.Id)).ToListAsync(ct);
        if (products.Count != body.ProductIds.Count) return Results.BadRequest(new { error = "One or more products were not found." });

        foreach (var p in products)
        {
            if (p.Status != ProductStatus.InTransit) return Results.BadRequest(new { error = $"Product {p.TrackingNumber} is not in transit." });
            if (p.DestinationBranchId != staffBranchId) return Results.BadRequest(new { error = $"Product {p.TrackingNumber} is not destined for your branch." });
        }

        foreach (var p in products)
        {
            p.CurrentBranchId = staffBranchId;
            p.Status = ProductStatus.Downloaded;
        }
        await repo.SaveChangesAsync(ct);
        return Results.Ok(new { unloadedCount = products.Count });
    }

    private static bool ProductTouchesBranch(Product p, int bid) =>
        p.OriginBranchId == bid || p.DestinationBranchId == bid || p.CurrentBranchId == bid;

    private static (int? branchId, IResult? error) TryGetBranchId(ClaimsPrincipal principal, string message)
    {
        var branchClaim = principal.FindFirst(JwtClaims.BranchId)?.Value;
        if (string.IsNullOrEmpty(branchClaim) || !int.TryParse(branchClaim, out var branchId))
            return (null, Results.BadRequest(new { error = message }));
        return (branchId, null);
    }

    private static int GetUserId(ClaimsPrincipal principal)
    {
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier)
                 ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
        if (string.IsNullOrEmpty(id) || !int.TryParse(id, out var userId))
            throw new InvalidOperationException("Invalid user id claim.");
        return userId;
    }
}
