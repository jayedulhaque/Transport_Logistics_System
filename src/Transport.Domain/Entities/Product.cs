using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class Product
{
    public Guid Id { get; set; }
    public string TrackingNumber { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public string SenderName { get; set; } = string.Empty;
    public string SenderPhone { get; set; } = string.Empty;
    public string SenderAddress { get; set; } = string.Empty;

    public string ReceiverName { get; set; } = string.Empty;
    public string ReceiverPhone { get; set; } = string.Empty;
    public string ReceiverAddress { get; set; } = string.Empty;

    public int OriginBranchId { get; set; }
    public int DestinationBranchId { get; set; }
    public int? CurrentBranchId { get; set; }

    public decimal ShippingPrice { get; set; }

    public ProductStatus Status { get; set; } = ProductStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeliveredAt { get; set; }

    public Branch OriginBranch { get; set; } = null!;
    public Branch DestinationBranch { get; set; } = null!;
    public Branch? CurrentBranch { get; set; }
    public ICollection<TripProduct> TripProducts { get; set; } = new List<TripProduct>();
}
