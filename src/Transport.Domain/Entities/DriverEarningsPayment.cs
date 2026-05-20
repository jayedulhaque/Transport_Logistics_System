using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class DriverEarningsPayment
{
    public int Id { get; set; }
    public int DriverProfileId { get; set; }
    public decimal Amount { get; set; }
    public PaymentMethod PaymentMethod { get; set; }
    public int RecordedByUserId { get; set; }
    public DateTime CreatedAt { get; set; }

    public DriverProfile DriverProfile { get; set; } = null!;
    public User RecordedBy { get; set; } = null!;
}
