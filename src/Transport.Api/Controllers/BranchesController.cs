using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
public class BranchesController(ITransportService service) : ControllerBase
{
    [HttpGet("/api/public/branches")]
    [AllowAnonymous]
    public Task<IResult> GetPublic(CancellationToken ct) => service.GetPublicBranchesAsync(ct);

    [HttpGet("/api/branches")]
    [Authorize]
    public Task<IResult> GetAll(CancellationToken ct) => service.GetBranchesAsync(User, ct);

    [HttpPost("/api/branches")]
    [Authorize]
    public Task<IResult> Create([FromBody] UpsertBranchRequest body, CancellationToken ct) =>
        service.CreateBranchAsync(body, User, ct);

    [HttpPut("/api/branches/{id:int}")]
    [Authorize]
    public Task<IResult> Update(int id, [FromBody] UpsertBranchRequest body, CancellationToken ct) =>
        service.UpdateBranchAsync(id, body, User, ct);

    [HttpDelete("/api/branches/{id:int}")]
    [Authorize]
    public Task<IResult> Delete(int id, CancellationToken ct) =>
        service.DeleteBranchAsync(id, User, ct);
}
