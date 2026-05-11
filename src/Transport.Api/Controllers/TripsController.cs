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
    [HttpPost]
    public Task<IResult> Create([FromBody] CreateTripRequest body, CancellationToken ct) =>
        service.CreateTripAsync(body, User, ct);

    [HttpGet]
    public Task<IResult> List(CancellationToken ct) => service.GetTripsAsync(User, ct);

    [HttpPut("{id:guid}")]
    public Task<IResult> Update(Guid id, [FromBody] UpdateTripRequest body, CancellationToken ct) =>
        service.UpdateTripAsync(id, body, User, ct);

    [HttpPost("load")]
    public Task<IResult> Load([FromBody] TripLoadRequest body, CancellationToken ct) =>
        service.LoadTripAsync(body, User, ct);

    [HttpPost("unload")]
    public Task<IResult> Unload([FromBody] TripUnloadRequest body, CancellationToken ct) =>
        service.UnloadTripAsync(body, User, ct);
}
