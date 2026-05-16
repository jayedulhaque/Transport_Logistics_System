using Microsoft.EntityFrameworkCore.Storage;
using Transport.Domain.Entities;

namespace Transport.Api.Repositories.Interfaces;

public interface ITransportRepository
{
    IQueryable<Branch> Branches { get; }
    IQueryable<User> Users { get; }
    IQueryable<DriverProfile> DriverProfiles { get; }
    IQueryable<Product> Products { get; }
    IQueryable<Trip> Trips { get; }
    IQueryable<TripProduct> TripProducts { get; }
    IQueryable<AppConfiguration> AppConfigurations { get; }
    IQueryable<BranchSettlementPayment> BranchSettlementPayments { get; }
    IQueryable<PasswordResetToken> PasswordResetTokens { get; }

    Task AddAsync<TEntity>(TEntity entity, CancellationToken ct = default) where TEntity : class;
    void Remove<TEntity>(TEntity entity) where TEntity : class;
    Task<int> SaveChangesAsync(CancellationToken ct = default);
    Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken ct = default);
}
