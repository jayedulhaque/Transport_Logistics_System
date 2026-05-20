using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class DriverProfile
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string VehicleNumber { get; set; } = string.Empty;
    public PaymentMethod? PreferredPaymentMethod { get; set; }
    /// <summary>bKash wallet number for driver trip-earnings payouts.</summary>
    public string? BKashNumber { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? BankRoutingNumber { get; set; }
    public bool IsApproved { get; set; }
    public decimal CurrentLat { get; set; }
    public decimal CurrentLng { get; set; }
    public bool IsOnline { get; set; }
    public DateTime? LastSeenAt { get; set; }

    public decimal AccruedTripEarnings { get; set; }
    public decimal PaidToDriver { get; set; }

    public User User { get; set; } = null!;
    public ICollection<Trip> Trips { get; set; } = new List<Trip>();
    public ICollection<DriverEarningsPayment> EarningsPayments { get; set; } = new List<DriverEarningsPayment>();
}
