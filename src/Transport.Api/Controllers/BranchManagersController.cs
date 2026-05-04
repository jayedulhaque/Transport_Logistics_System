using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/branch-managers")]
[Authorize]
public class BranchManagersController(ITransportService service) : ControllerBase
{
    [HttpGet]
    public Task<IResult> List(CancellationToken ct) => service.GetBranchManagersAsync(User, ct);

    [HttpPost]
    public Task<IResult> Create([FromBody] CreateBranchManagerRequest body, CancellationToken ct) =>
        service.CreateBranchManagerAsync(body, User, ct);

    [HttpPatch("{id:int}")]
    public Task<IResult> Update(int id, [FromBody] UpdateBranchManagerRequest body, CancellationToken ct) =>
        service.UpdateBranchManagerAsync(id, body, User, ct);

    [HttpDelete("{id:int}")]
    public Task<IResult> Delete(int id, CancellationToken ct) =>
        service.DeleteBranchManagerAsync(id, User, ct);
}
