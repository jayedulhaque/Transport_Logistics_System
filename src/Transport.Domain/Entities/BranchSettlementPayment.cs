using Transport.Domain.Enums;

namespace Transport.Domain.Entities;

public class BranchSettlementPayment
{
    public int Id { get; set; }
    public int BranchId { get; set; }
    public decimal Amount { get; set; }
    public BranchSettlementDirection Direction { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public int RecordedByUserId { get; set; }

    public Branch Branch { get; set; } = null!;
    public User RecordedBy { get; set; } = null!;
}
