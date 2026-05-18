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

    [HttpGet("/api/branches/{id:int}/settlement")]
    [Authorize]
    public Task<IResult> GetSettlement(int id, [FromQuery] string? fromDate, [FromQuery] string? toDate, CancellationToken ct) =>
        service.GetBranchSettlementAsync(id, fromDate, toDate, User, ct);

    [HttpPost("/api/branches/{id:int}/settlement/payments")]
    [Authorize]
    public Task<IResult> RecordPayment(int id, [FromBody] RecordBranchSettlementPaymentRequest body, CancellationToken ct) =>
        service.RecordBranchSettlementPaymentAsync(id, body, User, ct);

    [HttpGet("/api/branches/settlement/payments/pending")]
    [Authorize]
    public Task<IResult> GetPendingPayments(CancellationToken ct) =>
        service.GetPendingBranchSettlementPaymentsAsync(User, ct);

    [HttpPatch("/api/branches/settlement/payments/{paymentId:int}/approve")]
    [Authorize]
    public Task<IResult> ApprovePayment(int paymentId, CancellationToken ct) =>
        service.ApproveBranchSettlementPaymentAsync(paymentId, User, ct);

    [HttpPatch("/api/branches/settlement/payments/{paymentId:int}/reject")]
    [Authorize]
    public Task<IResult> RejectPayment(int paymentId, CancellationToken ct) =>
        service.RejectBranchSettlementPaymentAsync(paymentId, User, ct);
}
