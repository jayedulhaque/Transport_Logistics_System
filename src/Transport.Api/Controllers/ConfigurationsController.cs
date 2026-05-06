using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/configurations")]
[Authorize]
public class ConfigurationsController(ITransportService service) : ControllerBase
{
    [HttpGet("{key}")]
    public Task<IResult> GetConfiguration([FromRoute] string key, CancellationToken ct) =>
        service.GetAppConfigurationAsync(key, User, ct);

    [HttpPut("{key}")]
    public Task<IResult> UpdateConfiguration(
        [FromRoute] string key,
        [FromBody] UpdateAppConfigurationRequest body,
        CancellationToken ct) =>
        service.UpsertAppConfigurationAsync(key, body, User, ct);
}
