using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Transport.Api.Contracts;
using Transport.Api.Services.Interfaces;

namespace Transport.Api.Controllers;

[ApiController]
[Route("api/products")]
[Authorize]
public class ProductsController(ITransportService service) : ControllerBase
{
    [HttpPost]
    public Task<IResult> Create([FromBody] CreateProductRequest body, CancellationToken ct) =>
        service.CreateProductAsync(body, User, ct);

    [HttpGet]
    public Task<IResult> List(
        [FromQuery] string? tracking,
        [FromQuery] string? phone,
        CancellationToken ct) =>
        service.GetProductsAsync(User, tracking, phone, ct);

    [HttpGet("{id:guid}")]
    public Task<IResult> Get(Guid id, CancellationToken ct) =>
        service.GetProductDetailAsync(id, User, ct);

    [HttpPut("{id:guid}")]
    public Task<IResult> Update(Guid id, [FromBody] UpdateProductRequest body, CancellationToken ct) =>
        service.UpdateProductAsync(id, body, User, ct);

    [HttpDelete("{id:guid}")]
    public Task<IResult> Delete(Guid id, CancellationToken ct) => service.DeleteProductAsync(id, User, ct);

    [HttpPatch("{id:guid}/deliver")]
    public Task<IResult> Deliver(Guid id, [FromBody] DeliverProductRequest body, CancellationToken ct) =>
        service.DeliverProductAsync(id, body, User, ct);
}
