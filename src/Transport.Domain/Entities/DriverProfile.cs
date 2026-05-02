namespace Transport.Domain.Entities;

public class DriverProfile
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string VehicleNumber { get; set; } = string.Empty;
    public bool IsApproved { get; set; }
    public decimal CurrentLat { get; set; }
    public decimal CurrentLng { get; set; }
    public bool IsOnline { get; set; }
    public DateTime? LastSeenAt { get; set; }

    public User User { get; set; } = null!;
    public ICollection<Trip> Trips { get; set; } = new List<Trip>();
}
