using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class Branch
{
    public int Id { get; set; }
    public string BranchName { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public BranchSettlementType SettlementType { get; set; } = BranchSettlementType.Normal;
    /// <summary>Commission % on shipping price for deliveries at this branch (destination role only).</summary>
    public decimal? CommissionPercent { get; set; }
    /// <summary>bKash wallet number for admin-to-branch payouts.</summary>
    public string? BKashNumber { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? BankRoutingNumber { get; set; }

    public ICollection<User> Users { get; set; } = new List<User>();
    public ICollection<BranchSettlementPayment> SettlementPayments { get; set; } = new List<BranchSettlementPayment>();
    public ICollection<Product> ProductsAtBranch { get; set; } = new List<Product>();
    public ICollection<Product> OriginProducts { get; set; } = new List<Product>();
    public ICollection<Product> DestinationProducts { get; set; } = new List<Product>();
    public ICollection<Trip> OriginTrips { get; set; } = new List<Trip>();
    public ICollection<TripDestination> TripDestinations { get; set; } = new List<TripDestination>();
}
