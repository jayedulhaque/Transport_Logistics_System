namespace Transport.Domain.Entities;

public class TripProduct
{
    public Guid TripId { get; set; }
    public Guid ProductId { get; set; }

    public Trip Trip { get; set; } = null!;
    public Product Product { get; set; } = null!;
}
