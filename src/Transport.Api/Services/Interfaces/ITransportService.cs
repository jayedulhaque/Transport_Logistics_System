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

    Task<IResult> LoginAsync(LoginRequest body, CancellationToken ct = default);
    Task<IResult> RegisterDriverAsync(RegisterDriverRequest body, CancellationToken ct = default);

    Task<IResult> GetBranchCollectionsAsync(string? fromDate, string? toDate, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetPendingDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetApprovedDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateDriverBranchAsync(int id, UpdateDriverBranchRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> ApproveDriverAsync(int id, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default);
    Task<IResult> GetDriverStatusAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateDriverPresenceAsync(PresenceRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateDriverLocationAsync(LocationRequest body, ClaimsPrincipal principal, IHubContext<TransportHub> hub, CancellationToken ct = default);
    Task<IResult> GetDriverLocationsAsync(ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> CreateStaffAsync(CreateStaffRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetStaffAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateStaffAsync(int id, UpdateStaffRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteStaffAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetBranchManagersAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> CreateBranchManagerAsync(CreateBranchManagerRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateBranchManagerAsync(int id, UpdateBranchManagerRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteBranchManagerAsync(int id, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> GetAvailableDriversAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> LookupProductAsync(string tracking, string? mode, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> CreateProductAsync(CreateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> GetProductsAsync(ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UpdateProductAsync(Guid id, UpdateProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeleteProductAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> DeliverProductAsync(Guid id, DeliverProductRequest body, ClaimsPrincipal principal, CancellationToken ct = default);

    Task<IResult> LoadTripAsync(TripLoadRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
    Task<IResult> UnloadTripAsync(TripUnloadRequest body, ClaimsPrincipal principal, CancellationToken ct = default);
}
