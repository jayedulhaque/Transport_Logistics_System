using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Transport.Api.Contracts;
using Transport.Api.Hubs;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/drivers")]
[Authorize]
public class DriversController(ITransportService service, IHubContext<TransportHub> hub) : ControllerBase
{
    [HttpGet("pending")]
    public Task<IResult> Pending(CancellationToken ct) => service.GetPendingDriversAsync(User, ct);

    [HttpGet("approved")]
    public Task<IResult> Approved(CancellationToken ct) => service.GetApprovedDriversAsync(User, ct);

    [HttpPatch("{id:int}/branch")]
    public Task<IResult> UpdateBranch(int id, [FromBody] UpdateDriverBranchRequest body, CancellationToken ct) =>
        service.UpdateDriverBranchAsync(id, body, User, ct);

    [HttpPatch("{id:int}/approve")]
    public Task<IResult> Approve(int id, CancellationToken ct) => service.ApproveDriverAsync(id, User, hub, ct);

    [HttpGet("me/status")]
    public Task<IResult> Status(CancellationToken ct) => service.GetDriverStatusAsync(User, ct);

    [HttpPatch("me/presence")]
    public Task<IResult> Presence([FromBody] PresenceRequest body, CancellationToken ct) =>
        service.UpdateDriverPresenceAsync(body, User, ct);

    [HttpPatch("me/location")]
    public Task<IResult> Location([FromBody] LocationRequest body, CancellationToken ct) =>
        service.UpdateDriverLocationAsync(body, User, hub, ct);
}
