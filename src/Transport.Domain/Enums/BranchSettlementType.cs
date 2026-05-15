namespace Transport.Domain.Enums;

public enum BranchSettlementType
{
    /// <summary>All collections (origin + destination) are payable to admin.</summary>
    Normal,

    /// <summary>Origin collections go to admin; destination earns commission on shipping price.</summary>
    Commission
}
