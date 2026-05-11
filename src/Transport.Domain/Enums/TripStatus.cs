namespace Transport.Domain.Enums;

public enum TripStatus
{
    /// <summary>Trip created by manager; staff can load products onto this trip at the origin branch.</summary>
    AwaitingLoad,
    Active,
    Completed
}
