using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Transport.Api.Contracts;
using Transport.Api.Hubs;

namespace Transport.Api.Services.Interfaces;

public interface ITransportService
{
    Task<IResult> GetPublicBranchesAsync(CancellationToken ct = default);
    Task<IResult> GetBranchesAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> CreateBranchAsync(UpsertBranchRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateBranchAsync(int id, UpsertBranchRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteBranchAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetBranchSettlementAsync(int branchId, string? fromDate, string? toDate, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> RecordBranchSettlementPaymentAsync(int branchId, RecordBranchSettlementPaymentRequest body, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> LoginAsync(LoginRequest body, CancellationToken ct = default);
    Task<IResult> ChangeMyPasswordAsync(ChangePasswordRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetMyAdminAccountAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateMyAdminAccountAsync(UpdateAdminAccountRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> ForgotPasswordAsync(ForgotPasswordRequest body, CancellationToken ct = default);
    Task<IResult> ResetPasswordWithTokenAsync(ResetPasswordWithTokenRequest body, CancellationToken ct = default);
    Task<IResult> ResetStaffPasswordAsync(int id, ResetPasswordRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> ResetBranchManagerPasswordAsync(int id, ResetPasswordRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> ResetDriverPasswordAsync(int driverProfileId, ResetPasswordRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> RegisterDriverAsync(RegisterDriverRequest body, CancellationToken ct = default);

    Task<IResult> GetBranchCollectionsAsync(string? fromDate, string? toDate, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetBookingsByDestinationAsync(
        string? fromDate,
        string? toDate,
        int? originBranchId,
        ClaimsPrincipal principal,
        CancellationToken ct = default);

    Task<IResult> GetPendingDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetApprovedDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateDriverAsync(int id, UpdateDriverRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetMyDriverProfileAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateMyDriverProfileAsync(UpdateDriverRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> ApproveDriverAsync(int id, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default);
    Task<IResult> GetDriverStatusAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetDriverTripStateAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> StartDriverTripAsync(Guid tripId, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateDriverPresenceAsync(PresenceRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateDriverLocationAsync(LocationRequest body, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default);
    Task<IResult> GetDriverLocationsAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetMapSettingsAsync(ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> CreateStaffAsync(CreateStaffRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetStaffAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateStaffAsync(int id, UpdateStaffRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteStaffAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetBranchManagersAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> CreateBranchManagerAsync(CreateBranchManagerRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateBranchManagerAsync(int id, UpdateBranchManagerRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteBranchManagerAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetAvailableDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> CreateTripAsync(CreateTripRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetTripsAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateTripAsync(Guid id, UpdateTripRequest body, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetDriverEarningsAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetMyDriverEarningsAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> PayDriverEarningsAsync(int driverProfileId, PayDriverEarningsRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> LookupProductAsync(string tracking, string? mode, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> CreateProductAsync(CreateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetProductsAsync(ClaimsPrincipal principal, string? tracking = null, string? phone = null, CancellationToken ct = default);
    Task<IResult> GetProductDetailAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateProductAsync(Guid id, UpdateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteProductAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeliverProductAsync(Guid id, DeliverProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> LoadTripAsync(TripLoadRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UnloadTripAsync(TripUnloadRequest body, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetAppConfigurationAsync(string key, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpsertAppConfigurationAsync(string key, UpdateAppConfigurationRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
}
