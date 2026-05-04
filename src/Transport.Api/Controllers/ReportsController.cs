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
}
