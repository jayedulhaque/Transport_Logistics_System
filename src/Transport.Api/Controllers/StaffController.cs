using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Authorize]
public class StaffController(ITransportService service) : ControllerBase
{
    [HttpPost("/api/staff")]
    public Task<IResult> Create([FromBody] CreateStaffRequest body, CancellationToken ct) =>
        service.CreateStaffAsync(body, User, ct);

    [HttpGet("/api/staff")]
    public Task<IResult> List(CancellationToken ct) => service.GetStaffAsync(User, ct);

    [HttpPatch("/api/staff/{id:int}")]
    public Task<IResult> Update(int id, [FromBody] UpdateStaffRequest body, CancellationToken ct) =>
        service.UpdateStaffAsync(id, body, User, ct);

    [HttpDelete("/api/staff/{id:int}")]
    public Task<IResult> Delete(int id, CancellationToken ct) =>
        service.DeleteStaffAsync(id, User, ct);

    [HttpGet("/api/staff/available-drivers")]
    public Task<IResult> AvailableDrivers(CancellationToken ct) =>
        service.GetAvailableDriversAsync(User, ct);

    [HttpGet("/api/staff/products/lookup")]
    public Task<IResult> Lookup([FromQuery] string tracking, [FromQuery] string? mode, CancellationToken ct) =>
        service.LookupProductAsync(tracking, mode, User, ct);
}
