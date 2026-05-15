namespace Transport.Domain.Enums;

public enum BranchSettlementDirection
{
    /// <summary>Branch pays admin (settlement or partial payment).</summary>
    ToAdmin,

    /// <summary>Admin pays branch (e.g. commission branch is owed).</summary>
    FromAdmin
}
