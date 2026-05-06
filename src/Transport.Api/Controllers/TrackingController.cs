using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/tracking")]
[Authorize]
public class TrackingController(ITransportService service) : ControllerBase
{
    [HttpGet("map-settings")]
    public Task<IResult> MapSettings(CancellationToken ct) =>
        service.GetMapSettingsAsync(User, ct);

    [HttpGet("driver-locations")]
    public Task<IResult> DriverLocations(CancellationToken ct) =>
        service.GetDriverLocationsAsync(User, ct);
}
