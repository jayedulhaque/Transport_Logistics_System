using Transport.Domain.Entities;
using Transport.Domain.Enums;

namespace Transport.Api.Services;

public static class BranchSettlementCalculator
{
    public static (decimal CollectedAsOrigin, decimal CollectedAsDestination, decimal DestinationShippingTotal, decimal CommissionEarned, decimal NetSettlement) Compute(
        BranchSettlementType settlementType,
        decimal? commissionPercent,
        decimal collectedAsOrigin,
        decimal collectedAsDestination,
        decimal destinationShippingTotal)
    {
        if (settlementType == BranchSettlementType.Normal)
        {
            var total = collectedAsOrigin + collectedAsDestination;
            return (collectedAsOrigin, collectedAsDestination, destinationShippingTotal, 0m, total);
        }

        var rate = (commissionPercent ?? 0m) / 100m;
        var commissionEarned = Math.Round(destinationShippingTotal * rate, 2, MidpointRounding.AwayFromZero);
        var netToAdminFromDestination = collectedAsDestination - commissionEarned;
        var netSettlement = collectedAsOrigin + netToAdminFromDestination;
        return (collectedAsOrigin, collectedAsDestination, destinationShippingTotal, commissionEarned, netSettlement);
    }

    public static (decimal DueToAdmin, decimal DueFromAdmin) ComputeBalances(
        decimal netSettlement,
        decimal paidToAdmin,
        decimal paidFromAdmin)
    {
        if (netSettlement >= 0)
            return (Math.Max(0m, netSettlement - paidToAdmin), 0m);

        return (0m, Math.Max(0m, -netSettlement - paidFromAdmin));
    }
}
