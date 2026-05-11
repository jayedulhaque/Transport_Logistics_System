using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize]
public class ReportsController(ITransportService service) : ControllerBase
{
    [HttpGet("branch-collections")]
    public Task<IResult> BranchCollections([FromQuery] string? fromDate, [FromQuery] string? toDate, CancellationToken ct) =>
        service.GetBranchCollectionsAsync(fromDate, toDate, User, ct);

    /// <summary>
    /// <see cref="Transport.Domain.Enums.ProductStatus.Pending"/> products at the sending branch, grouped by destination (highest count first for routing).
    /// Date filter uses <c>CreatedAt</c> (booking date).
    /// </summary>
    [HttpGet("bookings-by-destination")]
    public Task<IResult> BookingsByDestination(
        [FromQuery] string? fromDate,
        [FromQuery] string? toDate,
        [FromQuery] int? originBranchId,
        CancellationToken ct) =>
        service.GetBookingsByDestinationAsync(fromDate, toDate, originBranchId, User, ct);
}
