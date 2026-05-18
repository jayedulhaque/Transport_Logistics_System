using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/customers")]
[Authorize]
public class CustomersController(ITransportService service) : ControllerBase
{
    [HttpGet]
    public Task<IResult> List([FromQuery] string? phone, CancellationToken ct) =>
        service.GetCustomersAsync(User, phone, ct);
}
