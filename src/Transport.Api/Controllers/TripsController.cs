using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/trips")]
[Authorize]
public class TripsController(ITransportService service) : ControllerBase
{
    [HttpPost("load")]
    public Task<IResult> Load([FromBody] TripLoadRequest body, CancellationToken ct) =>
        service.LoadTripAsync(body, User, ct);

    [HttpPost("unload")]
    public Task<IResult> Unload([FromBody] TripUnloadRequest body, CancellationToken ct) =>
        service.UnloadTripAsync(body, User, ct);
}
