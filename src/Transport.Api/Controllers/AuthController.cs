using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(ITransportService service) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public Task<IResult> Login([FromBody] LoginRequest body, CancellationToken ct) =>
        service.LoginAsync(body, ct);

    [HttpPost("register-driver")]
    [AllowAnonymous]
    public Task<IResult> RegisterDriver([FromBody] RegisterDriverRequest body, CancellationToken ct) =>
        service.RegisterDriverAsync(body, ct);
}
