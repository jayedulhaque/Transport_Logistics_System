using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Transport.Api.Controllers;

[ApiController]
[Route("health")]
public class HealthController : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public IResult Get() => Results.Ok(new { status = "ok", ts = DateTime.UtcNow });
}
