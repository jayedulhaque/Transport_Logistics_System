using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Transport.Api.Auth;
using Transport.Api.Contracts;
using Transport.Api.Hubs;
using Transport.Api.Options;
using Transport.Api.Repositories.Interfaces;
using Transport.Api.Services;
using Transport.Api.Services.Interfaces;
using Transport.Domain.Entities;
using Transport.Domain.Enums;

namespace Transport.Api.Services.Implementations;

public class TransportService(
    ITransportRepository repo,
    TokenService tokens,
    IEmailSender emailSender,
    IOptions<AppOptions> appOptions) : ITransportService
{
    public async Task<IResult> GetPublicBranchesAsync(CancellationToken ct = default)
    {
        var list = await repo.Branches.AsNoTracking()
            .OrderBy(b => b.Code)
            .Select(b => new BranchDto(
                b.Id, b.BranchName, b.Code, b.Address, b.SettlementType.ToString(), b.CommissionPercent,
                null, null, null))
            .ToListAsync(ct);
        return Results.Ok(list);
    }

    public async Task<IResult> GetBranchesAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)) || principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var list = await repo.Branches.AsNoTracking()
                .OrderBy(b => b.Code)
                .Select(b => new BranchDto(
                    b.Id, b.BranchName, b.Code, b.Address, b.SettlementType.ToString(), b.CommissionPercent,
                    b.BKashNumber, b.BankAccountNumber, b.BankRoutingNumber))
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
                .Select(b => new BranchDto(
                    b.Id, b.BranchName, b.Code, b.Address, b.SettlementType.ToString(), b.CommissionPercent,
                    b.BKashNumber, b.BankAccountNumber, b.BankRoutingNumber))
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

        if (!TryParseSettlementType(body.SettlementType, out var settlementType, out var settlementError))
            return Results.BadRequest(new { error = settlementError });

        if (!TryValidateCommission(settlementType, body.CommissionPercent, out var commissionPercent, out var commissionError))
            return Results.BadRequest(new { error = commissionError });

        if (await repo.Branches.AnyAsync(b => b.Code == code, ct))
            return Results.Conflict(new { error = "A branch with this code already exists." });

        var payoutResult = NormalizeBranchPayoutFields(body.BKashNumber, body.BankAccountNumber, body.BankRoutingNumber, out var bKash, out var bankAcct, out var bankRouting, out var payoutError);
        if (payoutResult is not null) return payoutResult;

        var branch = new Branch
        {
            BranchName = name,
            Code = code,
            Address = address,
            SettlementType = settlementType,
            CommissionPercent = commissionPercent,
            BKashNumber = bKash,
            BankAccountNumber = bankAcct,
            BankRoutingNumber = bankRouting
        };
        await repo.AddAsync(branch, ct);
        await repo.SaveChangesAsync(ct);

        return Results.Created($"/api/branches/{branch.Id}", ToBranchDto(branch));
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

        if (!TryParseSettlementType(body.SettlementType, out var settlementType, out var settlementError))
            return Results.BadRequest(new { error = settlementError });

        if (!TryValidateCommission(settlementType, body.CommissionPercent, out var commissionPercent, out var commissionError))
            return Results.BadRequest(new { error = commissionError });

        if (await repo.Branches.AnyAsync(b => b.Code == code && b.Id != id, ct))
            return Results.Conflict(new { error = "A branch with this code already exists." });

        var payoutResult = NormalizeBranchPayoutFields(body.BKashNumber, body.BankAccountNumber, body.BankRoutingNumber, out var bKash, out var bankAcct, out var bankRouting, out var payoutError);
        if (payoutResult is not null) return payoutResult;

        branch.BranchName = name;
        branch.Code = code;
        branch.Address = address;
        branch.SettlementType = settlementType;
        branch.CommissionPercent = commissionPercent;
        branch.BKashNumber = bKash;
        branch.BankAccountNumber = bankAcct;
        branch.BankRoutingNumber = bankRouting;
        await repo.SaveChangesAsync(ct);
        return Results.Ok(ToBranchDto(branch));
    }

    public async Task<IResult> GetBranchSettlementAsync(int branchId, string? fromDate, string? toDate, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (branchIdResult.branchId!.Value != branchId)
                return Results.Forbid();
        }

        var (startUtc, endUtcExclusive, rangeError) = TryParseReportDateRange(fromDate, toDate);
        if (rangeError is not null) return rangeError;

        var branch = await repo.Branches.AsNoTracking().FirstOrDefaultAsync(b => b.Id == branchId, ct);
        if (branch is null) return Results.NotFound();

        var delivered = repo.Products.AsNoTracking()
            .Where(p => p.Status == ProductStatus.Delivered
                        && p.DeliveredAt != null
                        && (!startUtc.HasValue || p.DeliveredAt >= startUtc.Value)
                        && (!endUtcExclusive.HasValue || p.DeliveredAt < endUtcExclusive.Value));

        var collectedAsOrigin = await delivered
            .Where(p => p.OriginBranchId == branchId)
            .SumAsync(p => (decimal?)p.AmountReceivedAtOrigin, ct) ?? 0m;

        var collectedAsDestination = await delivered
            .Where(p => p.DestinationBranchId == branchId)
            .SumAsync(p => (decimal?)p.AmountReceivedAtDestination, ct) ?? 0m;

        var destinationShippingTotal = await delivered
            .Where(p => p.DestinationBranchId == branchId)
            .SumAsync(p => (decimal?)p.ShippingPrice, ct) ?? 0m;

        var (origin, dest, shipping, commissionEarned, netSettlement) = BranchSettlementCalculator.Compute(
            branch.SettlementType,
            branch.CommissionPercent,
            collectedAsOrigin,
            collectedAsDestination,
            destinationShippingTotal);

        var paidToAdmin = await SumApprovedPaymentsAsync(branchId, BranchSettlementDirection.ToAdmin, ct);
        var paidFromAdmin = await SumApprovedPaymentsAsync(branchId, BranchSettlementDirection.FromAdmin, ct);
        var pendingToAdmin = await SumPendingPaymentsAsync(branchId, BranchSettlementDirection.ToAdmin, ct);

        var (dueToAdmin, dueFromAdmin) = BranchSettlementCalculator.ComputeBalances(netSettlement, paidToAdmin, paidFromAdmin);

        var recentPayments = await repo.BranchSettlementPayments.AsNoTracking()
            .Where(p => p.BranchId == branchId)
            .OrderByDescending(p => p.CreatedAt)
            .Take(20)
            .Select(p => new BranchSettlementPaymentDto(
                p.Id,
                p.Amount,
                p.Direction.ToString(),
                p.Note,
                p.CreatedAt,
                p.RecordedBy.FullName,
                p.Status.ToString(),
                p.PaymentMethod.ToString()))
            .ToListAsync(ct);

        return Results.Ok(new BranchSettlementDto(
            branch.Id,
            branch.BranchName,
            branch.SettlementType.ToString(),
            branch.CommissionPercent,
            branch.BKashNumber,
            branch.BankAccountNumber,
            branch.BankRoutingNumber,
            origin,
            dest,
            shipping,
            commissionEarned,
            netSettlement,
            paidToAdmin,
            paidFromAdmin,
            pendingToAdmin,
            dueToAdmin,
            dueFromAdmin,
            recentPayments));
    }

    public async Task<IResult> RecordBranchSettlementPaymentAsync(
        int branchId,
        RecordBranchSettlementPaymentRequest body,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (branchIdResult.branchId!.Value != branchId)
                return Results.Forbid();
        }

        if (body.Amount <= 0)
            return Results.BadRequest(new { error = "Payment amount must be greater than zero." });

        if (!TryParsePaymentMethod(body.PaymentMethod, out var paymentMethod, out var paymentMethodError))
            return Results.BadRequest(new { error = paymentMethodError });

        if (!Enum.TryParse<BranchSettlementDirection>(body.Direction?.Trim(), true, out var direction)
            || direction is not (BranchSettlementDirection.ToAdmin or BranchSettlementDirection.FromAdmin))
            return Results.BadRequest(new { error = "Direction must be ToAdmin or FromAdmin." });

        if (principal.IsInRole(nameof(UserRole.BranchManager)) && direction != BranchSettlementDirection.ToAdmin)
            return Results.Forbid();

        var branch = await repo.Branches.AsNoTracking().FirstOrDefaultAsync(b => b.Id == branchId, ct);
        if (branch is null) return Results.NotFound();

        var delivered = repo.Products.AsNoTracking()
            .Where(p => p.Status == ProductStatus.Delivered && p.DeliveredAt != null);

        var collectedAsOrigin = await delivered.Where(p => p.OriginBranchId == branchId)
            .SumAsync(p => (decimal?)p.AmountReceivedAtOrigin, ct) ?? 0m;
        var collectedAsDestination = await delivered.Where(p => p.DestinationBranchId == branchId)
            .SumAsync(p => (decimal?)p.AmountReceivedAtDestination, ct) ?? 0m;
        var destinationShippingTotal = await delivered.Where(p => p.DestinationBranchId == branchId)
            .SumAsync(p => (decimal?)p.ShippingPrice, ct) ?? 0m;

        var (_, _, _, _, netSettlement) = BranchSettlementCalculator.Compute(
            branch.SettlementType,
            branch.CommissionPercent,
            collectedAsOrigin,
            collectedAsDestination,
            destinationShippingTotal);

        var paidToAdmin = await SumApprovedPaymentsAsync(branchId, BranchSettlementDirection.ToAdmin, ct);
        var paidFromAdmin = await SumApprovedPaymentsAsync(branchId, BranchSettlementDirection.FromAdmin, ct);
        var pendingToAdmin = await SumPendingPaymentsAsync(branchId, BranchSettlementDirection.ToAdmin, ct);

        var (dueToAdmin, dueFromAdmin) = BranchSettlementCalculator.ComputeBalances(netSettlement, paidToAdmin, paidFromAdmin);

        if (direction == BranchSettlementDirection.ToAdmin)
        {
            var availableToPay = dueToAdmin - pendingToAdmin;
            if (body.Amount > availableToPay + 0.01m)
                return Results.BadRequest(new { error = "Payment exceeds amount due to admin (including pending payments)." });
        }
        else if (body.Amount > dueFromAdmin + 0.01m)
            return Results.BadRequest(new { error = "Payment exceeds amount due from admin." });

        var isAdmin = principal.IsInRole(nameof(UserRole.Admin));
        var now = DateTime.UtcNow;
        var userId = GetUserId(principal);
        var payment = new BranchSettlementPayment
        {
            BranchId = branchId,
            Amount = Math.Round(body.Amount, 2, MidpointRounding.AwayFromZero),
            Direction = direction,
            Note = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim(),
            CreatedAt = now,
            RecordedByUserId = userId,
            PaymentMethod = paymentMethod,
            Status = isAdmin ? BranchSettlementPaymentStatus.Approved : BranchSettlementPaymentStatus.Pending
        };

        if (isAdmin)
        {
            payment.ApprovedByUserId = userId;
            payment.ApprovedAt = now;
        }

        await repo.AddAsync(payment, ct);
        await repo.SaveChangesAsync(ct);

        return await GetBranchSettlementAsync(branchId, null, null, principal, ct);
    }

    public async Task<IResult> GetPendingBranchSettlementPaymentsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var pending = await repo.BranchSettlementPayments.AsNoTracking()
            .Where(p => p.Status == BranchSettlementPaymentStatus.Pending)
            .OrderBy(p => p.CreatedAt)
            .Select(p => new BranchSettlementPaymentDto(
                p.Id,
                p.Amount,
                p.Direction.ToString(),
                p.Note,
                p.CreatedAt,
                p.RecordedBy.FullName,
                p.Status.ToString(),
                p.PaymentMethod.ToString(),
                p.Branch.BranchName))
            .ToListAsync(ct);

        return Results.Ok(pending);
    }

    public async Task<IResult> ApproveBranchSettlementPaymentAsync(int paymentId, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var payment = await repo.BranchSettlementPayments
            .FirstOrDefaultAsync(p => p.Id == paymentId, ct);
        if (payment is null) return Results.NotFound();
        if (payment.Status != BranchSettlementPaymentStatus.Pending)
            return Results.BadRequest(new { error = "Only pending payments can be approved." });

        var validation = await ValidateSettlementPaymentApprovalAsync(payment, ct);
        if (validation is not null) return validation;

        var now = DateTime.UtcNow;
        payment.Status = BranchSettlementPaymentStatus.Approved;
        payment.ApprovedByUserId = GetUserId(principal);
        payment.ApprovedAt = now;
        await repo.SaveChangesAsync(ct);

        return await GetBranchSettlementAsync(payment.BranchId, null, null, principal, ct);
    }

    public async Task<IResult> RejectBranchSettlementPaymentAsync(int paymentId, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var payment = await repo.BranchSettlementPayments
            .FirstOrDefaultAsync(p => p.Id == paymentId, ct);
        if (payment is null) return Results.NotFound();
        if (payment.Status != BranchSettlementPaymentStatus.Pending)
            return Results.BadRequest(new { error = "Only pending payments can be rejected." });

        payment.Status = BranchSettlementPaymentStatus.Rejected;
        payment.ApprovedByUserId = GetUserId(principal);
        payment.ApprovedAt = DateTime.UtcNow;
        await repo.SaveChangesAsync(ct);

        return await GetBranchSettlementAsync(payment.BranchId, null, null, principal, ct);
    }

    private async Task<decimal> SumApprovedPaymentsAsync(int branchId, BranchSettlementDirection direction, CancellationToken ct) =>
        await repo.BranchSettlementPayments.AsNoTracking()
            .Where(p => p.BranchId == branchId
                        && p.Direction == direction
                        && p.Status == BranchSettlementPaymentStatus.Approved)
            .SumAsync(p => (decimal?)p.Amount, ct) ?? 0m;

    private async Task<decimal> SumPendingPaymentsAsync(int branchId, BranchSettlementDirection direction, CancellationToken ct) =>
        await repo.BranchSettlementPayments.AsNoTracking()
            .Where(p => p.BranchId == branchId
                        && p.Direction == direction
                        && p.Status == BranchSettlementPaymentStatus.Pending)
            .SumAsync(p => (decimal?)p.Amount, ct) ?? 0m;

    private async Task<IResult?> ValidateSettlementPaymentApprovalAsync(BranchSettlementPayment payment, CancellationToken ct)
    {
        var branch = await repo.Branches.AsNoTracking().FirstOrDefaultAsync(b => b.Id == payment.BranchId, ct);
        if (branch is null) return Results.NotFound();

        var delivered = repo.Products.AsNoTracking()
            .Where(p => p.Status == ProductStatus.Delivered && p.DeliveredAt != null);

        var collectedAsOrigin = await delivered.Where(p => p.OriginBranchId == payment.BranchId)
            .SumAsync(p => (decimal?)p.AmountReceivedAtOrigin, ct) ?? 0m;
        var collectedAsDestination = await delivered.Where(p => p.DestinationBranchId == payment.BranchId)
            .SumAsync(p => (decimal?)p.AmountReceivedAtDestination, ct) ?? 0m;
        var destinationShippingTotal = await delivered.Where(p => p.DestinationBranchId == payment.BranchId)
            .SumAsync(p => (decimal?)p.ShippingPrice, ct) ?? 0m;

        var (_, _, _, _, netSettlement) = BranchSettlementCalculator.Compute(
            branch.SettlementType,
            branch.CommissionPercent,
            collectedAsOrigin,
            collectedAsDestination,
            destinationShippingTotal);

        var paidToAdmin = await SumApprovedPaymentsAsync(payment.BranchId, BranchSettlementDirection.ToAdmin, ct);
        var paidFromAdmin = await SumApprovedPaymentsAsync(payment.BranchId, BranchSettlementDirection.FromAdmin, ct);
        var pendingToAdmin = await SumPendingPaymentsAsync(payment.BranchId, BranchSettlementDirection.ToAdmin, ct);

        var (dueToAdmin, dueFromAdmin) = BranchSettlementCalculator.ComputeBalances(netSettlement, paidToAdmin, paidFromAdmin);

        if (payment.Direction == BranchSettlementDirection.ToAdmin)
        {
            var otherPending = pendingToAdmin - payment.Amount;
            var available = dueToAdmin - otherPending;
            if (payment.Amount > available + 0.01m)
                return Results.BadRequest(new { error = "Approving this payment would exceed the amount due to admin." });
        }
        else if (payment.Amount > dueFromAdmin + 0.01m)
            return Results.BadRequest(new { error = "Approving this payment would exceed the amount due from admin." });

        return null;
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
        if (await repo.Trips.AnyAsync(t => t.OriginBranchId == id, ct))
            return Results.BadRequest(new { error = "Cannot delete a branch referenced as a trip origin." });
        if (await repo.Trips.AnyAsync(t => t.Destinations.Any(d => d.BranchId == id), ct))
            return Results.BadRequest(new { error = "Cannot delete a branch referenced as a trip destination." });

        repo.Remove(branch);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> LoginAsync(LoginRequest body, CancellationToken ct = default)
    {
        var loginPhone = PhoneValidation.PhoneForLoginLookup(body.Phone);
        var user = await repo.Users
            .Include(u => u.DriverProfile)
            .FirstOrDefaultAsync(u => u.Phone == loginPhone && u.IsActive, ct);
        if (user?.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(body.Password, user.PasswordHash))
            return Results.Unauthorized();

        var token = tokens.CreateToken(user);
        return Results.Ok(new LoginResponse(
            token, user.Id, user.FullName, user.Role.ToString(), user.BranchId, user.DriverProfile?.Id,
            user.DriverProfile?.IsApproved ?? true));
    }

    public async Task<IResult> ChangeMyPasswordAsync(
        ChangePasswordRequest body,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(body.CurrentPassword))
            return Results.BadRequest(new { error = "Current password is required." });
        if (string.IsNullOrWhiteSpace(body.NewPassword) || body.NewPassword.Length < 6)
            return Results.BadRequest(new { error = "New password must be at least 6 characters." });
        if (body.CurrentPassword == body.NewPassword)
            return Results.BadRequest(new { error = "New password must be different from the current password." });

        var userId = GetUserId(principal);
        var user = await repo.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
        if (user is null) return Results.NotFound();
        if (user.PasswordHash is null)
            return Results.BadRequest(new { error = "This account cannot change password." });

        if (!BCrypt.Net.BCrypt.Verify(body.CurrentPassword, user.PasswordHash))
            return Results.BadRequest(new { error = "Current password is incorrect." });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.NewPassword);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetMyAdminAccountAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        var userId = GetUserId(principal);
        var user = await repo.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
        if (user is null) return Results.NotFound();
        return Results.Ok(new AdminAccountDto(user.Id, user.FullName, user.Phone, user.Email));
    }

    public async Task<IResult> UpdateMyAdminAccountAsync(
        UpdateAdminAccountRequest body,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var phone = body.Phone.Trim();
        if (string.IsNullOrWhiteSpace(phone))
            return Results.BadRequest(new { error = "Mobile number or login ID is required." });

        var email = EmailValidation.Normalize(body.Email);
        if (email is not null && !EmailValidation.IsValid(email))
            return Results.BadRequest(new { error = "Enter a valid email address." });

        var userId = GetUserId(principal);
        var user = await repo.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
        if (user is null) return Results.NotFound();

        var loginPhone = PhoneValidation.PhoneForLoginLookup(phone);
        if (await repo.Users.AnyAsync(u => u.Phone == loginPhone && u.Id != userId, ct))
            return Results.BadRequest(new { error = "Another account already uses this mobile or login ID." });

        if (email is not null && await repo.Users.AnyAsync(u => u.Email == email && u.Id != userId, ct))
            return Results.BadRequest(new { error = "Another account already uses this email." });

        user.Phone = loginPhone;
        user.Email = email;
        await repo.SaveChangesAsync(ct);
        return Results.Ok(new AdminAccountDto(user.Id, user.FullName, user.Phone, user.Email));
    }

    public async Task<IResult> ForgotPasswordAsync(ForgotPasswordRequest body, CancellationToken ct = default)
    {
        const string okMessage = "If an account exists for that email, a password reset link has been sent.";

        var email = EmailValidation.Normalize(body.Email);
        if (!EmailValidation.IsValid(email))
            return Results.BadRequest(new { error = "Enter a valid email address." });

        var user = await repo.Users.FirstOrDefaultAsync(
            u => u.Email == email && u.IsActive && u.Role == UserRole.Admin,
            ct);

        if (user is null || string.IsNullOrEmpty(user.Email))
            return Results.Ok(new { message = okMessage });

        var now = DateTime.UtcNow;
        var activeTokens = await repo.PasswordResetTokens
            .Where(t => t.UserId == user.Id && t.UsedAtUtc == null && t.ExpiresAtUtc > now)
            .ToListAsync(ct);
        foreach (var t in activeTokens)
            t.UsedAtUtc = now;

        var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        await repo.AddAsync(new PasswordResetToken
        {
            UserId = user.Id,
            TokenHash = HashResetToken(rawToken),
            ExpiresAtUtc = now.AddHours(1),
            CreatedAtUtc = now,
        }, ct);
        await repo.SaveChangesAsync(ct);

        var webUrl = appOptions.Value.PublicWebUrl.TrimEnd('/');
        var resetLink = $"{webUrl}/reset-password?token={Uri.EscapeDataString(rawToken)}";
        try
        {
            await emailSender.SendPasswordResetAsync(user.Email, user.FullName, resetLink, ct);
        }
        catch (Exception)
        {
            return Results.Json(
                new { error = "Could not send the reset email. Check SMTP settings (Gmail needs an App Password) and restart the API container after changing .env." },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new { message = okMessage });
    }

    public async Task<IResult> ResetPasswordWithTokenAsync(ResetPasswordWithTokenRequest body, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(body.Token))
            return Results.BadRequest(new { error = "Reset token is required." });
        if (string.IsNullOrWhiteSpace(body.NewPassword) || body.NewPassword.Length < 6)
            return Results.BadRequest(new { error = "New password must be at least 6 characters." });

        var hash = HashResetToken(body.Token.Trim());
        var now = DateTime.UtcNow;
        var tokenRow = await repo.PasswordResetTokens
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == hash && t.UsedAtUtc == null && t.ExpiresAtUtc > now, ct);

        if (tokenRow?.User is null || !tokenRow.User.IsActive)
            return Results.BadRequest(new { error = "This reset link is invalid or has expired." });

        tokenRow.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.NewPassword);
        tokenRow.UsedAtUtc = now;

        var otherActive = await repo.PasswordResetTokens
            .Where(t => t.UserId == tokenRow.UserId && t.Id != tokenRow.Id && t.UsedAtUtc == null)
            .ToListAsync(ct);
        foreach (var t in otherActive)
            t.UsedAtUtc = now;

        await repo.SaveChangesAsync(ct);
        return Results.Ok(new { message = "Password updated. You can sign in with your new password." });
    }

    public async Task<IResult> ResetStaffPasswordAsync(
        int id,
        ResetPasswordRequest body,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
    {
        var err = ValidateNewPassword(body.NewPassword);
        if (err is not null) return err;

        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        var staff = await repo.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRole.Staff, ct);
        if (staff is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var (branchId, branchErr) = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchErr is not null) return branchErr;
            if (staff.BranchId != branchId) return Results.Forbid();
        }

        staff.PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.NewPassword);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> ResetBranchManagerPasswordAsync(
        int id,
        ResetPasswordRequest body,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();

        var err = ValidateNewPassword(body.NewPassword);
        if (err is not null) return err;

        var mgr = await repo.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRole.BranchManager, ct);
        if (mgr is null) return Results.NotFound();

        mgr.PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.NewPassword);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> ResetDriverPasswordAsync(
        int driverProfileId,
        ResetPasswordRequest body,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
    {
        var err = ValidateNewPassword(body.NewPassword);
        if (err is not null) return err;

        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        var profile = await repo.DriverProfiles
            .Include(d => d.User)
            .FirstOrDefaultAsync(d => d.Id == driverProfileId, ct);
        if (profile?.User is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var (branchId, branchErr) = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchErr is not null) return branchErr;
            if (profile.User.BranchId != branchId) return Results.Forbid();
        }

        profile.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.NewPassword);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> RegisterDriverAsync(RegisterDriverRequest body, CancellationToken ct = default)
    {
        var fullName = body.FullName.Trim();
        if (string.IsNullOrWhiteSpace(fullName))
            return Results.BadRequest(new { error = "Full name is required." });
        if (!PhoneValidation.TryValidateMobile(body.Phone, out var phone, out var phoneError))
            return Results.BadRequest(new { error = phoneError });
        var vehicle = body.VehicleNumber.Trim();
        if (string.IsNullOrWhiteSpace(vehicle))
            return Results.BadRequest(new { error = "Vehicle number is required." });
        if (string.IsNullOrWhiteSpace(body.Password) || body.Password.Length < 6)
            return Results.BadRequest(new { error = "Password must be at least 6 characters." });
        if (await repo.Users.AnyAsync(u => u.Phone == phone, ct))
            return Results.Conflict(new { error = "Mobile number already registered." });
        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct))
            return Results.BadRequest(new { error = "Invalid branch." });

        var user = new User
        {
            FullName = fullName,
            Phone = phone,
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
            VehicleNumber = vehicle,
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
            var delivered = repo.Products.AsNoTracking()
                .Where(p => p.Status == ProductStatus.Delivered
                            && p.DeliveredAt != null
                            && (!startUtc.HasValue || p.DeliveredAt >= startUtc.Value)
                            && (!endUtcExclusive.HasValue || p.DeliveredAt < endUtcExclusive.Value));

            var originSums = await delivered
                .GroupBy(p => p.OriginBranchId)
                .Select(g => new { BranchId = g.Key, Amount = g.Sum(x => x.AmountReceivedAtOrigin) })
                .ToListAsync(ct);

            var destSums = await delivered
                .GroupBy(p => p.DestinationBranchId)
                .Select(g => new { BranchId = g.Key, Amount = g.Sum(x => x.AmountReceivedAtDestination) })
                .ToListAsync(ct);

            var originDict = originSums.ToDictionary(x => x.BranchId, x => x.Amount);
            var destDict = destSums.ToDictionary(x => x.BranchId, x => x.Amount);
            var branchIds = originDict.Keys.Union(destDict.Keys).Distinct().ToList();

            var names = await repo.Branches.AsNoTracking()
                .Where(b => branchIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.BranchName, ct);

            var rows = branchIds
                .Select(id =>
                {
                    var o = originDict.GetValueOrDefault(id);
                    var d = destDict.GetValueOrDefault(id);
                    var label = names.TryGetValue(id, out var bn) ? bn : $"Branch #{id}";
                    return new BranchCollectionRowDto(id, label, o, d, o + d);
                })
                .OrderBy(r => r.BranchName)
                .ToList();

            return Results.Ok(rows);
        }

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var branchId = branchIdResult.branchId!.Value;

            var name = await repo.Branches.AsNoTracking().Where(b => b.Id == branchId).Select(b => b.BranchName).FirstOrDefaultAsync(ct);
            if (name is null) return Results.NotFound();

            var asOrigin = await repo.Products.AsNoTracking()
                .Where(p => p.Status == ProductStatus.Delivered
                            && p.OriginBranchId == branchId
                            && p.DeliveredAt != null
                            && (!startUtc.HasValue || p.DeliveredAt >= startUtc.Value)
                            && (!endUtcExclusive.HasValue || p.DeliveredAt < endUtcExclusive.Value))
                .SumAsync(p => (decimal?)p.AmountReceivedAtOrigin, ct) ?? 0m;

            var asDestination = await repo.Products.AsNoTracking()
                .Where(p => p.Status == ProductStatus.Delivered
                            && p.DestinationBranchId == branchId
                            && p.DeliveredAt != null
                            && (!startUtc.HasValue || p.DeliveredAt >= startUtc.Value)
                            && (!endUtcExclusive.HasValue || p.DeliveredAt < endUtcExclusive.Value))
                .SumAsync(p => (decimal?)p.AmountReceivedAtDestination, ct) ?? 0m;

            return Results.Ok(new List<BranchCollectionRowDto>
            {
                new(branchId, name, asOrigin, asDestination, asOrigin + asDestination),
            });
        }

        return Results.Forbid();
    }

    public async Task<IResult> GetBookingsByDestinationAsync(
        string? fromDate,
        string? toDate,
        int? originBranchId,
        ClaimsPrincipal principal,
        CancellationToken ct = default)
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

        int originId;
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            originId = branchIdResult.branchId!.Value;
        }
        else if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            if (!originBranchId.HasValue || originBranchId.Value <= 0)
                return Results.BadRequest(new { error = "originBranchId is required for admin users." });
            originId = originBranchId.Value;
            if (!await repo.Branches.AnyAsync(b => b.Id == originId, ct))
                return Results.BadRequest(new { error = "Invalid originBranchId." });
        }
        else return Results.Forbid();

        var originName = await repo.Branches.AsNoTracking().Where(b => b.Id == originId).Select(b => b.BranchName).FirstOrDefaultAsync(ct);
        if (originName is null) return Results.NotFound();

        var filtered = repo.Products.AsNoTracking()
            .Where(p => p.OriginBranchId == originId
                        && p.Status == ProductStatus.Pending
                        && (!startUtc.HasValue || p.CreatedAt >= startUtc.Value)
                        && (!endUtcExclusive.HasValue || p.CreatedAt < endUtcExclusive.Value));

        // Sum in CLR after materializing rows so totals stay exact decimal currency (avoids DB/provider aggregate quirks).
        var rows = await (from p in filtered
                          join d in repo.Branches.AsNoTracking() on p.DestinationBranchId equals d.Id
                          select new { p.DestinationBranchId, DestinationBranchName = d.BranchName, p.ShippingPrice })
            .ToListAsync(ct);

        var ordered = rows
            .GroupBy(x => (x.DestinationBranchId, x.DestinationBranchName))
            .Select(g => new BookingsByDestinationRowDto(
                g.Key.DestinationBranchId,
                g.Key.DestinationBranchName,
                g.Count(),
                RoundMoney(g.Sum(x => x.ShippingPrice))))
            .OrderByDescending(r => r.ProductCount)
            .ThenBy(r => r.DestinationBranchName)
            .ToList();

        return Results.Ok(new BookingsByDestinationReportDto(originId, originName, ordered));
    }

    public async Task<IResult> GetPendingDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            var list = await repo.DriverProfiles.AsNoTracking()
                .Where(d => !d.IsApproved)
                .Include(d => d.User).ThenInclude(u => u.Branch)
                .OrderBy(d => d.User.FullName)
                .Select(d => new PendingDriverDto(d.Id, d.UserId, d.User.FullName, d.User.Phone, d.VehicleNumber, d.User.BranchId, d.User.Branch != null ? d.User.Branch.BranchName : null))
                .ToListAsync(ct);
            return Results.Ok(list);
        }

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;

            var list = await repo.DriverProfiles.AsNoTracking()
                .Where(d => !d.IsApproved && d.User.BranchId == bid)
                .Include(d => d.User).ThenInclude(u => u.Branch)
                .OrderBy(d => d.User.FullName)
                .Select(d => new PendingDriverDto(d.Id, d.UserId, d.User.FullName, d.User.Phone, d.VehicleNumber, d.User.BranchId, d.User.Branch != null ? d.User.Branch.BranchName : null))
                .ToListAsync(ct);
            return Results.Ok(list);
        }

        return Results.Forbid();
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

    public async Task<IResult> UpdateDriverAsync(int id, UpdateDriverRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        var profile = await repo.DriverProfiles.Include(d => d.User).ThenInclude(u => u.Branch)
            .FirstOrDefaultAsync(d => d.Id == id, ct);
        if (profile is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (profile.User.BranchId != branchIdResult.branchId)
                return Results.Forbid();
        }

        var updateResult = await ApplyDriverProfileUpdateAsync(profile, body, ct);
        if (updateResult is not null) return updateResult;

        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetMyDriverProfileAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Driver))) return Results.Forbid();
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.AsNoTracking()
            .Include(d => d.User).ThenInclude(u => u.Branch)
            .FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null) return Results.NotFound();
        return Results.Ok(ToDriverProfileDto(profile));
    }

    public async Task<IResult> UpdateMyDriverProfileAsync(UpdateDriverRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Driver))) return Results.Forbid();
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null) return Results.NotFound();

        var updateResult = await ApplyDriverProfileUpdateAsync(profile, body, ct);
        if (updateResult is not null) return updateResult;

        await repo.SaveChangesAsync(ct);
        var updated = await repo.DriverProfiles.AsNoTracking()
            .Include(d => d.User).ThenInclude(u => u.Branch)
            .FirstAsync(d => d.Id == profile.Id, ct);
        return Results.Ok(ToDriverProfileDto(updated));
    }

    static DriverProfileDto ToDriverProfileDto(DriverProfile profile) =>
        new(
            profile.Id,
            profile.UserId,
            profile.User.FullName,
            profile.User.Phone,
            profile.VehicleNumber,
            profile.User.BranchId,
            profile.User.Branch?.BranchName,
            profile.IsApproved,
            profile.PreferredPaymentMethod?.ToString(),
            profile.BKashNumber,
            profile.BankAccountNumber,
            profile.BankRoutingNumber);

    async Task<IResult?> ApplyDriverProfileUpdateAsync(DriverProfile profile, UpdateDriverRequest body, CancellationToken ct)
    {
        if (!PhoneValidation.TryValidateMobile(body.Phone, out var phone, out var phoneError))
            return Results.BadRequest(new { error = phoneError });
        var vehicle = body.VehicleNumber.Trim();
        if (string.IsNullOrWhiteSpace(vehicle))
            return Results.BadRequest(new { error = "Vehicle number is required." });
        if (!await repo.Branches.AnyAsync(b => b.Id == body.BranchId, ct))
            return Results.BadRequest(new { error = "Invalid branch." });

        if (profile.User.Phone != phone &&
            await repo.Users.AnyAsync(u => u.Phone == phone && u.Id != profile.UserId, ct))
            return Results.Conflict(new { error = "Mobile number already registered." });

        profile.User.Phone = phone;
        profile.VehicleNumber = vehicle;
        profile.User.BranchId = body.BranchId;

        var payoutFieldsProvided = body.BKashNumber is not null
            || body.BankAccountNumber is not null
            || body.BankRoutingNumber is not null;

        if (body.PreferredPaymentMethod is not null)
        {
            if (string.IsNullOrWhiteSpace(body.PreferredPaymentMethod))
                profile.PreferredPaymentMethod = null;
            else if (!TryParsePaymentMethod(body.PreferredPaymentMethod, out var preferred, out var preferredError))
                return Results.BadRequest(new { error = preferredError });
            else
                profile.PreferredPaymentMethod = preferred;
        }

        if (body.PreferredPaymentMethod is not null || payoutFieldsProvided)
        {
            var payoutResult = NormalizeBranchPayoutFields(
                body.BKashNumber, body.BankAccountNumber, body.BankRoutingNumber,
                out var bKash, out var bankAcct, out var bankRouting, out var payoutError);
            if (payoutResult is not null) return payoutResult;

            var payoutApplyResult = ApplyDriverPayoutDetails(profile, bKash, bankAcct, bankRouting);
            if (payoutApplyResult is not null) return payoutApplyResult;
        }

        return null;
    }

    private static IResult? ApplyDriverPayoutDetails(
        DriverProfile profile,
        string? bKash,
        string? bankAcct,
        string? bankRouting)
    {
        switch (profile.PreferredPaymentMethod)
        {
            case PaymentMethod.BKash:
                if (string.IsNullOrEmpty(bKash))
                    return Results.BadRequest(new { error = "bKash number is required when bKash is your payout method." });
                profile.BKashNumber = bKash;
                profile.BankAccountNumber = null;
                profile.BankRoutingNumber = null;
                break;
            case PaymentMethod.BankAccount:
                if (string.IsNullOrEmpty(bankAcct) || string.IsNullOrEmpty(bankRouting))
                    return Results.BadRequest(new { error = "Bank account and routing numbers are required when bank account is your payout method." });
                profile.BankAccountNumber = bankAcct;
                profile.BankRoutingNumber = bankRouting;
                profile.BKashNumber = null;
                break;
            default:
                profile.BKashNumber = null;
                profile.BankAccountNumber = null;
                profile.BankRoutingNumber = null;
                break;
        }

        return null;
    }

    private static bool TryParsePaymentMethod(string? value, out PaymentMethod method, out string? error)
    {
        method = default;
        error = null;
        if (string.IsNullOrWhiteSpace(value))
        {
            error = "Payment method is required (BKash, Cash, or BankAccount).";
            return false;
        }

        if (!Enum.TryParse<PaymentMethod>(value.Trim(), true, out method))
        {
            error = "Payment method must be BKash, Cash, or BankAccount.";
            return false;
        }

        return true;
    }

    public async Task<IResult> ApproveDriverAsync(int id, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default)
    {
        var profile = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == id, ct);
        if (profile is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.Admin)))
        {
            // Admin may approve any pending driver.
        }
        else if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (profile.User.BranchId != branchIdResult.branchId)
                return Results.Forbid();
        }
        else return Results.Forbid();

        if (profile.IsApproved) return Results.NoContent();

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

    public async Task<IResult> GetDriverTripStateAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Driver))) return Results.Forbid();
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.AsNoTracking()
            .FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null)
            return Results.Ok(new DriverTripStateResponse("None", null, null, null, 0));

        var trip = await repo.Trips.AsNoTracking()
            .Include(t => t.Destinations).ThenInclude(d => d.Branch)
            .Include(t => t.TripProducts)
            .Where(t => t.DriverProfileId == profile.Id && t.Status != TripStatus.Completed)
            .OrderByDescending(t => t.LoadTime)
            .FirstOrDefaultAsync(ct);

        if (trip is null)
            return Results.Ok(new DriverTripStateResponse("None", null, null, null, 0));

        var destLabel = string.Join(", ", trip.Destinations.OrderBy(d => d.Branch.BranchName).Select(d => d.Branch.BranchName));
        if (trip.Status == TripStatus.AwaitingLoad)
            return Results.Ok(new DriverTripStateResponse(
                "AwaitingDriverStart",
                trip.Id,
                destLabel,
                trip.DriverPaymentAmount,
                trip.TripProducts.Count));

        return Results.Ok(new DriverTripStateResponse(
            "InTransit",
            trip.Id,
            destLabel,
            trip.DriverPaymentAmount,
            trip.TripProducts.Count));
    }

    public async Task<IResult> StartDriverTripAsync(Guid tripId, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Driver))) return Results.Forbid();
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null) return Results.NotFound();

        var trip = await repo.Trips.Include(t => t.TripProducts).FirstOrDefaultAsync(t => t.Id == tripId, ct);
        if (trip is null) return Results.NotFound();
        if (trip.DriverProfileId != profile.Id) return Results.Forbid();
        if (trip.Status != TripStatus.AwaitingLoad)
            return Results.BadRequest(new { error = "Trip is not waiting for you to start, or was already started." });
        if (trip.TripProducts.Count == 0)
            return Results.BadRequest(new { error = "Staff must load at least one parcel before you start this trip." });

        trip.Status = TripStatus.Active;
        trip.LoadTime = DateTime.UtcNow;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
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

    public async Task<IResult> GetMapSettingsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.Identity?.IsAuthenticated ?? true)
            return Results.Unauthorized();

        var config = await repo.AppConfigurations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.ConfigKey == "GoogleMapsApiKey", ct);

        return Results.Ok(new MapSettingsDto(config?.ConfigValue ?? string.Empty));
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

        var trips = await repo.Trips.AsNoTracking()
            .Include(t => t.DriverProfile).ThenInclude(d => d.User)
            .Include(t => t.Destinations).ThenInclude(d => d.Branch)
            .Where(t => t.Status == TripStatus.AwaitingLoad
                        && t.OriginBranchId == branchId
                        && t.DriverProfile.User.BranchId == branchId)
            .OrderBy(t => t.DriverProfile.User.FullName)
            .ToListAsync(ct);
        var list = trips.Select(t => new AvailableTripForStaffDto(
            t.Id,
            t.DriverProfileId,
            t.DriverProfile.User.FullName,
            t.DriverProfile.VehicleNumber,
            string.Join(", ", t.Destinations.OrderBy(d => d.Branch.BranchName).Select(d => d.Branch.BranchName)),
            t.DriverPaymentAmount)).ToList();
        return Results.Ok(list);
    }

    public async Task<IResult> CreateTripAsync(CreateTripRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var payment = RoundMoney(body.DriverPaymentAmount);
        if (payment < 0) return Results.BadRequest(new { error = "Driver payment cannot be negative." });

        int originId;
        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            originId = branchIdResult.branchId!.Value;
            if (body.OriginBranchId is { } ob && ob != originId)
                return Results.BadRequest(new { error = "Branch managers can only create trips for their own branch as origin." });
        }
        else
        {
            if (!body.OriginBranchId.HasValue || body.OriginBranchId.Value <= 0)
                return Results.BadRequest(new { error = "originBranchId is required for admins." });
            originId = body.OriginBranchId.Value;
        }

        if (!await repo.Branches.AnyAsync(b => b.Id == originId, ct))
            return Results.BadRequest(new { error = "Invalid origin branch." });
        var destIds = (body.DestinationBranchIds ?? Array.Empty<int>()).Distinct().OrderBy(x => x).ToList();
        if (destIds.Count == 0)
            return Results.BadRequest(new { error = "Select at least one destination branch." });
        foreach (var bid in destIds)
        {
            if (bid == originId)
                return Results.BadRequest(new { error = "Each destination branch must differ from the origin branch." });
            if (!await repo.Branches.AnyAsync(b => b.Id == bid, ct))
                return Results.BadRequest(new { error = $"Invalid destination branch id {bid}." });
        }

        var driver = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == body.DriverProfileId, ct);
        if (driver is null || !driver.IsApproved)
            return Results.BadRequest(new { error = "Invalid or unapproved driver." });
        if (driver.User.BranchId != originId)
            return Results.BadRequest(new { error = "Driver must belong to the trip origin branch." });

        var openTrip = await repo.Trips.AnyAsync(
            t => t.DriverProfileId == driver.Id && (t.Status == TripStatus.AwaitingLoad || t.Status == TripStatus.Active), ct);
        if (openTrip)
            return Results.BadRequest(new { error = "Driver already has an open trip. Complete it before starting another." });

        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            DriverProfileId = driver.Id,
            OriginBranchId = originId,
            LoadTime = DateTime.UtcNow,
            Status = TripStatus.AwaitingLoad,
            DriverPaymentAmount = payment,
            EarningsCredited = false,
        };
        await repo.AddAsync(trip, ct);
        foreach (var bid in destIds)
            await repo.AddAsync(new TripDestination { TripId = trip.Id, BranchId = bid }, ct);
        await repo.SaveChangesAsync(ct);
        return Results.Created($"/api/trips/{trip.Id}", new { id = trip.Id });
    }

    public async Task<IResult> GetTripsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();

        IQueryable<Trip> q = repo.Trips.AsNoTracking()
            .Include(t => t.DriverProfile).ThenInclude(d => d.User)
            .Include(t => t.OriginBranch)
            .Include(t => t.Destinations).ThenInclude(d => d.Branch)
            .Include(t => t.TripProducts).ThenInclude(tp => tp.Product);

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;
            q = q.Where(t => t.OriginBranchId == bid);
        }

        var list = await q.OrderByDescending(t => t.LoadTime).ToListAsync(ct);
        var rows = list.Select(t => new TripListItemDto(
            t.Id,
            t.DriverProfileId,
            t.DriverProfile.User.FullName,
            t.DriverProfile.VehicleNumber,
            t.OriginBranchId,
            t.OriginBranch.BranchName,
            t.Destinations.OrderBy(d => d.BranchId).Select(d => d.BranchId).ToList(),
            string.Join(", ", t.Destinations.OrderBy(d => d.Branch.BranchName).Select(d => d.Branch.BranchName)),
            t.Status.ToString(),
            t.DriverPaymentAmount,
            t.TripProducts.Count,
            t.TripProducts.Count(tp => tp.Product.Status == ProductStatus.InTransit),
            t.LoadTime)).ToList();
        return Results.Ok(rows);
    }

    public async Task<IResult> UpdateTripAsync(Guid id, UpdateTripRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();

        var trip = await repo.Trips
            .Include(t => t.TripProducts).ThenInclude(tp => tp.Product)
            .Include(t => t.DriverProfile).ThenInclude(d => d.User)
            .Include(t => t.Destinations)
            .FirstOrDefaultAsync(t => t.Id == id, ct);
        if (trip is null) return Results.NotFound();
        if (trip.Status == TripStatus.Completed)
            return Results.BadRequest(new { error = "Completed trips cannot be edited." });

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (trip.OriginBranchId != branchIdResult.branchId) return Results.Forbid();
        }

        var payment = RoundMoney(body.DriverPaymentAmount);
        if (payment < 0) return Results.BadRequest(new { error = "Driver payment cannot be negative." });

        var requestedDestIds = (body.DestinationBranchIds ?? Array.Empty<int>()).Distinct().OrderBy(x => x).ToList();
        if (requestedDestIds.Count == 0)
            return Results.BadRequest(new { error = "Select at least one destination branch." });
        foreach (var bid in requestedDestIds)
        {
            if (bid == trip.OriginBranchId)
                return Results.BadRequest(new { error = "Each destination branch must differ from the origin branch." });
            if (!await repo.Branches.AnyAsync(b => b.Id == bid, ct))
                return Results.BadRequest(new { error = $"Invalid destination branch id {bid}." });
        }

        var currentDestIds = trip.Destinations.Select(d => d.BranchId).OrderBy(x => x).ToList();
        var hasProducts = trip.TripProducts.Count > 0;
        if (hasProducts)
        {
            if (body.DriverProfileId != trip.DriverProfileId || !currentDestIds.SequenceEqual(requestedDestIds))
                return Results.BadRequest(new { error = "Cannot change driver or allowed destinations after products have been loaded onto this trip." });
        }
        else
        {
            var newDriver = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == body.DriverProfileId, ct);
            if (newDriver is null || !newDriver.IsApproved)
                return Results.BadRequest(new { error = "Invalid or unapproved driver." });
            if (newDriver.User.BranchId != trip.OriginBranchId)
                return Results.BadRequest(new { error = "Driver must belong to the trip origin branch." });

            var otherOpen = await repo.Trips.AnyAsync(
                t => t.Id != trip.Id
                     && t.DriverProfileId == newDriver.Id
                     && (t.Status == TripStatus.AwaitingLoad || t.Status == TripStatus.Active), ct);
            if (otherOpen)
                return Results.BadRequest(new { error = "Selected driver already has another open trip." });

            trip.DriverProfileId = newDriver.Id;
            foreach (var d in trip.Destinations.ToList())
                repo.Remove(d);
            foreach (var bid in requestedDestIds)
                await repo.AddAsync(new TripDestination { TripId = trip.Id, BranchId = bid }, ct);
        }

        trip.DriverPaymentAmount = payment;
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> GetDriverEarningsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();

        IQueryable<DriverProfile> q = repo.DriverProfiles.AsNoTracking()
            .Where(d => d.IsApproved)
            .Include(d => d.User).ThenInclude(u => u.Branch);

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;
            q = q.Where(d => d.User.BranchId == bid);
        }

        var list = await q.OrderBy(d => d.User.FullName).ToListAsync(ct);
        var rows = list.Select(d =>
        {
            var accrued = RoundMoney(d.AccruedTripEarnings);
            var paid = RoundMoney(d.PaidToDriver);
            return new DriverEarningsRowDto(
                d.Id,
                d.User.FullName,
                d.VehicleNumber,
                d.User.BranchId,
                d.User.Branch?.BranchName,
                d.PreferredPaymentMethod?.ToString(),
                d.BKashNumber,
                d.BankAccountNumber,
                d.BankRoutingNumber,
                accrued,
                paid,
                RoundMoney(accrued - paid));
        }).ToList();
        return Results.Ok(rows);
    }

    public async Task<IResult> GetMyDriverEarningsAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Driver))) return Results.Forbid();
        var userId = GetUserId(principal);
        var profile = await repo.DriverProfiles.AsNoTracking()
            .FirstOrDefaultAsync(d => d.UserId == userId, ct);
        if (profile is null) return Results.NotFound();
        var accrued = RoundMoney(profile.AccruedTripEarnings);
        var paid = RoundMoney(profile.PaidToDriver);
        return Results.Ok(new DriverMyEarningsDto(
            accrued,
            paid,
            RoundMoney(accrued - paid),
            profile.PreferredPaymentMethod?.ToString()));
    }

    public async Task<IResult> PayDriverEarningsAsync(int driverProfileId, PayDriverEarningsRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var amount = RoundMoney(body.Amount);
        if (amount <= 0) return Results.BadRequest(new { error = "Amount must be greater than zero." });
        if (!TryParsePaymentMethod(body.PaymentMethod, out var paymentMethod, out var paymentMethodError))
            return Results.BadRequest(new { error = paymentMethodError });

        var profile = await repo.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == driverProfileId, ct);
        if (profile is null) return Results.NotFound();
        if (!profile.IsApproved) return Results.BadRequest(new { error = "Driver is not approved." });

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (profile.User.BranchId != branchIdResult.branchId) return Results.Forbid();
        }

        var due = RoundMoney(profile.AccruedTripEarnings - profile.PaidToDriver);
        if (amount > due) return Results.BadRequest(new { error = "Amount exceeds outstanding due." });

        profile.PaidToDriver = RoundMoney(profile.PaidToDriver + amount);
        await repo.AddAsync(new DriverEarningsPayment
        {
            DriverProfileId = profile.Id,
            Amount = amount,
            PaymentMethod = paymentMethod,
            RecordedByUserId = GetUserId(principal),
            CreatedAt = DateTime.UtcNow
        }, ct);
        await repo.SaveChangesAsync(ct);
        return Results.NoContent();
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
        var shipping = RoundMoney(body.ShippingPrice);
        var originReceived = RoundMoney(body.AmountReceivedAtOrigin);
        if (shipping < 0) return Results.BadRequest(new { error = "Shipping price cannot be negative." });
        if (originReceived < 0) return Results.BadRequest(new { error = "Origin received amount cannot be negative." });
        if (originReceived > shipping)
            return Results.BadRequest(new { error = "Origin received amount cannot exceed shipping price." });

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
            ShippingPrice = shipping,
            AmountReceivedAtOrigin = originReceived,
            AmountReceivedAtDestination = 0m,
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

    public async Task<IResult> GetProductsAsync(
        ClaimsPrincipal principal,
        string? tracking = null,
        string? phone = null,
        CancellationToken ct = default)
    {
        IQueryable<Product> query = repo.Products.AsNoTracking();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;
            query = query.Where(p => p.OriginBranchId == bid || p.DestinationBranchId == bid || p.CurrentBranchId == bid);
        }
        else if (!principal.IsInRole(nameof(UserRole.Admin)))
        {
            return Results.Forbid();
        }

        var trackingTerm = tracking?.Trim();
        if (!string.IsNullOrEmpty(trackingTerm))
            query = query.Where(p => EF.Functions.ILike(p.TrackingNumber, $"%{trackingTerm}%"));

        var phoneTerm = phone?.Trim();
        if (!string.IsNullOrEmpty(phoneTerm))
        {
            query = query.Where(p =>
                EF.Functions.ILike(p.SenderPhone, $"%{phoneTerm}%") ||
                EF.Functions.ILike(p.ReceiverPhone, $"%{phoneTerm}%"));
        }

        var list = await (from p in query
                          join ob in repo.Branches.AsNoTracking() on p.OriginBranchId equals ob.Id
                          join dbDest in repo.Branches.AsNoTracking() on p.DestinationBranchId equals dbDest.Id
                          orderby p.CreatedAt descending
                          select new ProductListItemDto(
                              p.Id,
                              p.TrackingNumber,
                              p.Description,
                              p.SenderName,
                              p.SenderPhone,
                              p.SenderAddress,
                              p.ReceiverName,
                              p.ReceiverPhone,
                              p.ReceiverAddress,
                              p.OriginBranchId,
                              p.DestinationBranchId,
                              ob.BranchName,
                              dbDest.BranchName,
                              p.ShippingPrice,
                              p.AmountReceivedAtOrigin,
                              p.AmountReceivedAtDestination,
                              p.ShippingPrice - p.AmountReceivedAtOrigin - p.AmountReceivedAtDestination,
                              p.Status.ToString(),
                              p.CreatedAt))
            .ToListAsync(ct);
        return Results.Ok(list);
    }

    public async Task<IResult> GetCustomersAsync(
        ClaimsPrincipal principal,
        string? phone = null,
        CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        IQueryable<Product> query = repo.Products.AsNoTracking();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            var bid = branchIdResult.branchId!.Value;
            query = query.Where(p => p.OriginBranchId == bid || p.DestinationBranchId == bid || p.CurrentBranchId == bid);
        }

        var phoneTerm = phone?.Trim();
        if (!string.IsNullOrEmpty(phoneTerm))
        {
            query = query.Where(p =>
                EF.Functions.ILike(p.SenderPhone, $"%{phoneTerm}%") ||
                EF.Functions.ILike(p.ReceiverPhone, $"%{phoneTerm}%"));
        }

        var rows = await query
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new
            {
                p.SenderPhone,
                p.SenderName,
                p.SenderAddress,
                p.ReceiverPhone,
                p.ReceiverName,
                p.ReceiverAddress,
                p.CreatedAt
            })
            .ToListAsync(ct);

        var customers = new Dictionary<string, CustomerAccumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in rows)
        {
            ApplySenderRole(customers, row.SenderPhone, row.SenderName, row.SenderAddress, row.CreatedAt);
            ApplyReceiverRole(customers, row.ReceiverPhone, row.ReceiverName, row.ReceiverAddress, row.CreatedAt);
        }

        var list = customers.Values
            .Select(c => new CustomerListItemDto(
                c.DisplayPhone,
                c.SenderName,
                c.SenderAddress,
                c.SentCount,
                c.ReceiverName,
                c.ReceiverAddress,
                c.ReceivedCount))
            .OrderByDescending(c => c.SentCount + c.ReceivedCount)
            .ThenBy(c => c.Phone, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Results.Ok(list);
    }

    public async Task<IResult> GetProductDetailAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager)))
            return Results.Forbid();

        var product = await repo.Products.AsNoTracking()
            .Include(p => p.OriginBranch)
            .Include(p => p.DestinationBranch)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return Results.NotFound();

        if (principal.IsInRole(nameof(UserRole.BranchManager)))
        {
            var branchIdResult = TryGetBranchId(principal, "Branch manager must have a branch assigned.");
            if (branchIdResult.error is not null) return branchIdResult.error;
            if (!ProductTouchesBranch(product, branchIdResult.branchId!.Value)) return Results.Forbid();
        }

        var originMgr = await GetBranchManagerContactAsync(product.OriginBranchId, product.OriginBranch.BranchName, ct);
        var destMgr = await GetBranchManagerContactAsync(product.DestinationBranchId, product.DestinationBranch.BranchName, ct);

        ProductTripDetailDto? tripDto = null;
        var tripId = await (from tp in repo.TripProducts.AsNoTracking()
                            where tp.ProductId == id
                            join t in repo.Trips.AsNoTracking() on tp.TripId equals t.Id
                            orderby t.LoadTime descending
                            select t.Id).FirstOrDefaultAsync(ct);
        if (tripId != Guid.Empty)
        {
            var trip = await repo.Trips.AsNoTracking()
                .Include(t => t.DriverProfile).ThenInclude(d => d.User)
                .Include(t => t.OriginBranch)
                .Include(t => t.Destinations).ThenInclude(d => d.Branch)
                .FirstOrDefaultAsync(t => t.Id == tripId, ct);
            if (trip is not null)
            {
                var destLabel = string.Join(", ",
                    trip.Destinations.OrderBy(d => d.Branch.BranchName).Select(d => d.Branch.BranchName));
                tripDto = new ProductTripDetailDto(
                    trip.Id,
                    trip.Status.ToString(),
                    trip.DriverProfile.User.FullName,
                    trip.DriverProfile.User.Phone,
                    trip.DriverProfile.VehicleNumber,
                    trip.OriginBranch.BranchName,
                    destLabel,
                    trip.DriverPaymentAmount,
                    trip.LoadTime);
            }
        }

        var due = RoundMoney(product.ShippingPrice - product.AmountReceivedAtOrigin - product.AmountReceivedAtDestination);
        return Results.Ok(new ProductDetailDto(
            product.Id,
            product.TrackingNumber,
            product.Description,
            product.Status.ToString(),
            new ProductPartyDto(product.SenderName, product.SenderPhone, product.SenderAddress),
            new ProductPartyDto(product.ReceiverName, product.ReceiverPhone, product.ReceiverAddress),
            product.OriginBranch.BranchName,
            product.DestinationBranch.BranchName,
            originMgr,
            destMgr,
            tripDto,
            product.ShippingPrice,
            product.AmountReceivedAtOrigin,
            product.AmountReceivedAtDestination,
            due,
            product.CreatedAt,
            product.DeliveredAt));
    }

    async Task<ProductBranchManagerDto?> GetBranchManagerContactAsync(int branchId, string branchName, CancellationToken ct)
    {
        var mgr = await repo.Users.AsNoTracking()
            .FirstOrDefaultAsync(
                u => u.Role == UserRole.BranchManager && u.BranchId == branchId && u.IsActive,
                ct);
        return mgr is null ? null : new ProductBranchManagerDto(branchName, mgr.FullName, mgr.Phone);
    }

    public async Task<IResult> UpdateProductAsync(Guid id, UpdateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)) && !principal.IsInRole(nameof(UserRole.BranchManager))) return Results.Forbid();
        var originExists = await repo.Branches.AnyAsync(b => b.Id == body.OriginBranchId, ct);
        var destExists = await repo.Branches.AnyAsync(b => b.Id == body.DestinationBranchId, ct);
        if (!originExists || !destExists) return Results.BadRequest(new { error = "Invalid origin or destination branch." });
        var shipping = RoundMoney(body.ShippingPrice);
        var originReceived = RoundMoney(body.AmountReceivedAtOrigin);
        if (shipping < 0) return Results.BadRequest(new { error = "Shipping price cannot be negative." });
        if (originReceived < 0) return Results.BadRequest(new { error = "Origin received amount cannot be negative." });
        if (originReceived > shipping)
            return Results.BadRequest(new { error = "Origin received amount cannot exceed shipping price." });

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
        product.ShippingPrice = shipping;
        product.AmountReceivedAtOrigin = originReceived;
        var maxDestinationCollection = Math.Max(0m, product.ShippingPrice - product.AmountReceivedAtOrigin);
        if (product.AmountReceivedAtDestination > maxDestinationCollection)
            product.AmountReceivedAtDestination = maxDestinationCollection;
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
        var dueBeforeDelivery = Math.Max(0m, product.ShippingPrice - product.AmountReceivedAtOrigin);
        var amountAtDest = RoundMoney(body.AmountReceivedAtDestination);
        if (amountAtDest < 0)
            return Results.BadRequest(new { error = "Destination received amount cannot be negative." });
        if (amountAtDest > dueBeforeDelivery)
            return Results.BadRequest(new { error = "Destination received amount cannot exceed pending due amount." });
        if (dueBeforeDelivery > 0 && amountAtDest != dueBeforeDelivery)
            return Results.BadRequest(new { error = "Full due amount must be confirmed at destination before delivery." });
        if (dueBeforeDelivery == 0 && amountAtDest > 0)
            return Results.BadRequest(new { error = "No due amount remains for this product." });

        product.AmountReceivedAtDestination = amountAtDest;
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

        if (body.TripId is { } plannedTripId)
        {
            var trip = await repo.Trips.Include(t => t.Destinations).FirstOrDefaultAsync(t => t.Id == plannedTripId, ct);
            if (trip is null) return Results.BadRequest(new { error = "Trip not found." });
            if (trip.Status == TripStatus.Completed) return Results.BadRequest(new { error = "Trip is already completed." });
            if (trip.OriginBranchId != staffBranchId) return Results.BadRequest(new { error = "Trip does not start at your branch." });
            if (trip.DriverProfileId != driver.Id) return Results.BadRequest(new { error = "Trip is not assigned to this driver." });
            if (trip.Status != TripStatus.AwaitingLoad)
                return Results.BadRequest(new { error = "This trip is no longer accepting scans at origin (driver has started or trip is closed)." });

            var allowedDest = trip.Destinations.Select(d => d.BranchId).ToHashSet();
            foreach (var p in products)
            {
                if (!allowedDest.Contains(p.DestinationBranchId))
                    return Results.BadRequest(new { error = $"Product {p.TrackingNumber} is not destined for a branch allowed on this trip." });
            }

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

        var adHocTrip = new Trip
        {
            Id = Guid.NewGuid(),
            DriverProfileId = driver.Id,
            OriginBranchId = staffBranchId,
            LoadTime = DateTime.UtcNow,
            Status = TripStatus.Active,
            DriverPaymentAmount = 0m,
            EarningsCredited = false,
        };
        await repo.AddAsync(adHocTrip, ct);
        foreach (var bid in products.Select(p => p.DestinationBranchId).Distinct())
            await repo.AddAsync(new TripDestination { TripId = adHocTrip.Id, BranchId = bid }, ct);
        foreach (var p in products)
        {
            await repo.AddAsync(new TripProduct { TripId = adHocTrip.Id, ProductId = p.Id }, ct);
            p.Status = ProductStatus.InTransit;
            p.CurrentBranchId = null;
        }
        await repo.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new TripLoadResponse(adHocTrip.Id));
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

        var tripIds = await repo.TripProducts.AsNoTracking()
            .Where(tp => body.ProductIds.Contains(tp.ProductId))
            .Select(tp => tp.TripId)
            .Distinct()
            .ToListAsync(ct);
        foreach (var tripId in tripIds)
            await TryCompleteTripAndCreditEarningsAsync(tripId, ct);

        return Results.Ok(new { unloadedCount = products.Count });
    }

    private async Task TryCompleteTripAndCreditEarningsAsync(Guid tripId, CancellationToken ct)
    {
        var trip = await repo.Trips
            .Include(t => t.TripProducts).ThenInclude(tp => tp.Product)
            .Include(t => t.DriverProfile)
            .FirstOrDefaultAsync(t => t.Id == tripId, ct);
        if (trip is null || trip.Status == TripStatus.Completed || trip.EarningsCredited) return;
        if (trip.TripProducts.Count == 0) return;
        if (trip.TripProducts.Any(tp => tp.Product.Status == ProductStatus.InTransit)) return;

        trip.Status = TripStatus.Completed;
        var pay = RoundMoney(trip.DriverPaymentAmount);
        if (pay > 0)
            trip.DriverProfile.AccruedTripEarnings = RoundMoney(trip.DriverProfile.AccruedTripEarnings + pay);
        trip.EarningsCredited = true;
        await repo.SaveChangesAsync(ct);
    }

    public async Task<IResult> GetAppConfigurationAsync(string key, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        if (string.IsNullOrWhiteSpace(key)) return Results.BadRequest(new { error = "Configuration key is required." });

        var config = await repo.AppConfigurations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.ConfigKey == key, ct);
        if (config is null) return Results.NotFound(new { error = "Configuration not found." });

        return Results.Ok(new AppConfigurationDto(config.ConfigKey, config.ConfigValue, config.UpdatedAt));
    }

    public async Task<IResult> UpsertAppConfigurationAsync(string key, UpdateAppConfigurationRequest body, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        if (!principal.IsInRole(nameof(UserRole.Admin))) return Results.Forbid();
        if (string.IsNullOrWhiteSpace(key)) return Results.BadRequest(new { error = "Configuration key is required." });

        var value = body.ConfigValue?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(value))
            return Results.BadRequest(new { error = "Configuration value is required." });

        var config = await repo.AppConfigurations.FirstOrDefaultAsync(c => c.ConfigKey == key, ct);
        if (config is null)
        {
            config = new AppConfiguration
            {
                ConfigKey = key,
                ConfigValue = value,
                UpdatedAt = DateTime.UtcNow
            };
            await repo.AddAsync(config, ct);
        }
        else
        {
            config.ConfigValue = value;
            config.UpdatedAt = DateTime.UtcNow;
        }

        await repo.SaveChangesAsync(ct);
        return Results.Ok(new AppConfigurationDto(config.ConfigKey, config.ConfigValue, config.UpdatedAt));
    }

    private static decimal RoundMoney(decimal value) =>
        decimal.Round(value, 2, MidpointRounding.AwayFromZero);

    private static bool ProductTouchesBranch(Product p, int bid) =>
        p.OriginBranchId == bid || p.DestinationBranchId == bid || p.CurrentBranchId == bid;

    private static string? CustomerPhoneKey(string? phone)
    {
        var trimmed = phone?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static void ApplySenderRole(
        Dictionary<string, CustomerAccumulator> customers,
        string phone,
        string name,
        string address,
        DateTime createdAt)
    {
        var key = CustomerPhoneKey(phone);
        if (key is null) return;

        if (!customers.TryGetValue(key, out var entry))
        {
            entry = new CustomerAccumulator { DisplayPhone = phone.Trim() };
            customers[key] = entry;
        }

        entry.SentCount++;
        if (entry.LastSenderAt is null || createdAt >= entry.LastSenderAt)
        {
            entry.LastSenderAt = createdAt;
            entry.SenderName = name;
            entry.SenderAddress = address;
        }
    }

    private static void ApplyReceiverRole(
        Dictionary<string, CustomerAccumulator> customers,
        string phone,
        string name,
        string address,
        DateTime createdAt)
    {
        var key = CustomerPhoneKey(phone);
        if (key is null) return;

        if (!customers.TryGetValue(key, out var entry))
        {
            entry = new CustomerAccumulator { DisplayPhone = phone.Trim() };
            customers[key] = entry;
        }

        entry.ReceivedCount++;
        if (entry.LastReceiverAt is null || createdAt >= entry.LastReceiverAt)
        {
            entry.LastReceiverAt = createdAt;
            entry.ReceiverName = name;
            entry.ReceiverAddress = address;
        }
    }

    private sealed class CustomerAccumulator
    {
        public string DisplayPhone { get; set; } = "";
        public string? SenderName { get; set; }
        public string? SenderAddress { get; set; }
        public int SentCount { get; set; }
        public DateTime? LastSenderAt { get; set; }
        public string? ReceiverName { get; set; }
        public string? ReceiverAddress { get; set; }
        public int ReceivedCount { get; set; }
        public DateTime? LastReceiverAt { get; set; }
    }

    private static (int? branchId, IResult? error) TryGetBranchId(ClaimsPrincipal principal, string message)
    {
        var branchClaim = principal.FindFirst(JwtClaims.BranchId)?.Value;
        if (string.IsNullOrEmpty(branchClaim) || !int.TryParse(branchClaim, out var branchId))
            return (null, Results.BadRequest(new { error = message }));
        return (branchId, null);
    }

    private static IResult? ValidateNewPassword(string? newPassword)
    {
        if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 6)
            return Results.BadRequest(new { error = "New password must be at least 6 characters." });
        return null;
    }

    private static string HashResetToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static int GetUserId(ClaimsPrincipal principal)
    {
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier)
                 ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
        if (string.IsNullOrEmpty(id) || !int.TryParse(id, out var userId))
            throw new InvalidOperationException("Invalid user id claim.");
        return userId;
    }

    private static BranchDto ToBranchDto(Branch branch) =>
        new(
            branch.Id,
            branch.BranchName,
            branch.Code,
            branch.Address,
            branch.SettlementType.ToString(),
            branch.CommissionPercent,
            branch.BKashNumber,
            branch.BankAccountNumber,
            branch.BankRoutingNumber);

    private static IResult? NormalizeBranchPayoutFields(
        string? bKashNumber,
        string? bankAccountNumber,
        string? bankRoutingNumber,
        out string? bKash,
        out string? bankAcct,
        out string? bankRouting,
        out string? error)
    {
        bKash = string.IsNullOrWhiteSpace(bKashNumber) ? null : bKashNumber.Trim();
        bankAcct = string.IsNullOrWhiteSpace(bankAccountNumber) ? null : bankAccountNumber.Trim();
        bankRouting = string.IsNullOrWhiteSpace(bankRoutingNumber) ? null : bankRoutingNumber.Trim();
        error = null;

        var hasAcct = !string.IsNullOrEmpty(bankAcct);
        var hasRouting = !string.IsNullOrEmpty(bankRouting);
        if (hasAcct != hasRouting)
        {
            error = "Bank account number and routing number must both be provided or both left empty.";
            return Results.BadRequest(new { error });
        }

        return null;
    }

    private static bool TryParseSettlementType(string? value, out BranchSettlementType type, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(value))
        {
            type = BranchSettlementType.Normal;
            return true;
        }

        if (!Enum.TryParse(value.Trim(), true, out type) || !Enum.IsDefined(type))
        {
            error = "Settlement type must be Normal or Commission.";
            return false;
        }

        return true;
    }

    private static bool TryValidateCommission(
        BranchSettlementType type,
        decimal? commissionPercent,
        out decimal? normalized,
        out string? error)
    {
        error = null;
        normalized = null;

        if (type == BranchSettlementType.Normal)
        {
            if (commissionPercent is > 0)
            {
                error = "Commission percent is only for commission-based branches.";
                return false;
            }

            return true;
        }

        if (commissionPercent is null or <= 0 or > 100)
        {
            error = "Commission percent is required for commission branches (0.01–100).";
            return false;
        }

        normalized = Math.Round(commissionPercent.Value, 2, MidpointRounding.AwayFromZero);
        return true;
    }

    private static (DateTime? StartUtc, DateTime? EndUtcExclusive, IResult? Error) TryParseReportDateRange(string? fromDate, string? toDate)
    {
        DateTime? startUtc = null;
        DateTime? endUtcExclusive = null;

        if (!string.IsNullOrWhiteSpace(fromDate))
        {
            if (!DateOnly.TryParse(fromDate, out var from))
                return (null, null, Results.BadRequest(new { error = "Invalid fromDate. Use YYYY-MM-DD." }));
            startUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        }

        if (!string.IsNullOrWhiteSpace(toDate))
        {
            if (!DateOnly.TryParse(toDate, out var to))
                return (null, null, Results.BadRequest(new { error = "Invalid toDate. Use YYYY-MM-DD." }));
            endUtcExclusive = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        }

        if (startUtc.HasValue && endUtcExclusive.HasValue && startUtc.Value >= endUtcExclusive.Value)
            return (null, null, Results.BadRequest(new { error = "fromDate must be before or equal to toDate." }));

        return (startUtc, endUtcExclusive, null);
    }
}
