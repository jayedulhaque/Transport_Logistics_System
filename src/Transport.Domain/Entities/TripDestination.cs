namespace Transport.Domain.Entities;

/// <summary>Allowed destination hub for a trip; staff may load pending parcels booked to any of these branches.</summary>
public class TripDestination
{
    public Guid TripId { get; set; }
    public int BranchId { get; set; }

    public Trip Trip { get; set; } = null!;
    public Branch Branch { get; set; } = null!;
}
