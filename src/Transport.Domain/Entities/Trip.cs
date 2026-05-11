using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class Trip
{
    public Guid Id { get; set; }
    public int DriverProfileId { get; set; }
    public int OriginBranchId { get; set; }
    public DateTime LoadTime { get; set; }
    public TripStatus Status { get; set; } = TripStatus.AwaitingLoad;
    public decimal DriverPaymentAmount { get; set; }
    /// <summary>True after trip completion earnings were added to the driver profile.</summary>
    public bool EarningsCredited { get; set; }

    public DriverProfile DriverProfile { get; set; } = null!;
    public Branch OriginBranch { get; set; } = null!;
    public ICollection<TripDestination> Destinations { get; set; } = new List<TripDestination>();
    public ICollection<TripProduct> TripProducts { get; set; } = new List<TripProduct>();
}
