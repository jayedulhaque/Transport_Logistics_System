namespace Transport.Domain.Entities;

public class Branch
{
    public int Id { get; set; }
    public string BranchName { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;

    public ICollection<User> Users { get; set; } = new List<User>();
    public ICollection<Product> ProductsAtBranch { get; set; } = new List<Product>();
    public ICollection<Product> OriginProducts { get; set; } = new List<Product>();
    public ICollection<Product> DestinationProducts { get; set; } = new List<Product>();
    public ICollection<Trip> OriginTrips { get; set; } = new List<Trip>();
    public ICollection<TripDestination> TripDestinations { get; set; } = new List<TripDestination>();
}
