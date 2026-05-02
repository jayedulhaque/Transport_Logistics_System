using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class Trip
{
    public Guid Id { get; set; }
    public int DriverProfileId { get; set; }
    public int OriginBranchId { get; set; }
    public int DestinationBranchId { get; set; }
    public DateTime LoadTime { get; set; }
    public TripStatus Status { get; set; } = TripStatus.Active;

    public DriverProfile DriverProfile { get; set; } = null!;
    public Branch OriginBranch { get; set; } = null!;
    public Branch DestinationBranch { get; set; } = null!;
    public ICollection<TripProduct> TripProducts { get; set; } = new List<TripProduct>();
}
