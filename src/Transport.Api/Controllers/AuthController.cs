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

    [HttpPatch("me/password")]
    [Authorize]
    public Task<IResult> ChangeMyPassword([FromBody] ChangePasswordRequest body, CancellationToken ct) =>
        service.ChangeMyPasswordAsync(body, User, ct);

    [HttpGet("me/account")]
    [Authorize]
    public Task<IResult> GetMyAccount(CancellationToken ct) =>
        service.GetMyAdminAccountAsync(User, ct);

    [HttpPatch("me/account")]
    [Authorize]
    public Task<IResult> UpdateMyAccount([FromBody] UpdateAdminAccountRequest body, CancellationToken ct) =>
        service.UpdateMyAdminAccountAsync(body, User, ct);

    [HttpPost("forgot-password")]
    [AllowAnonymous]
    public Task<IResult> ForgotPassword([FromBody] ForgotPasswordRequest body, CancellationToken ct) =>
        service.ForgotPasswordAsync(body, ct);

    [HttpPost("reset-password")]
    [AllowAnonymous]
    public Task<IResult> ResetPassword([FromBody] ResetPasswordWithTokenRequest body, CancellationToken ct) =>
        service.ResetPasswordWithTokenAsync(body, ct);
}
