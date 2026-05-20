using Microsoft.EntityFrameworkCore.Storage;
using Transport.Api.Repositories.Interfaces;
using Transport.Domain.Entities;
using Transport.Infrastructure.Data;

namespace Transport.Api.Repositories.Implementations;

public class TransportRepository(TransportDbContext db) : ITransportRepository
{
    public IQueryable<Branch> Branches => db.Branches;
    public IQueryable<User> Users => db.Users;
    public IQueryable<DriverProfile> DriverProfiles => db.DriverProfiles;
    public IQueryable<Product> Products => db.Products;
    public IQueryable<Trip> Trips => db.Trips;
    public IQueryable<TripProduct> TripProducts => db.TripProducts;
    public IQueryable<AppConfiguration> AppConfigurations => db.AppConfigurations;
    public IQueryable<BranchSettlementPayment> BranchSettlementPayments => db.BranchSettlementPayments;
    public IQueryable<DriverEarningsPayment> DriverEarningsPayments => db.DriverEarningsPayments;
    public IQueryable<PasswordResetToken> PasswordResetTokens => db.PasswordResetTokens;

    public Task AddAsync<TEntity>(TEntity entity, CancellationToken ct = default) where TEntity : class =>
        db.Set<TEntity>().AddAsync(entity, ct).AsTask();

    public void Remove<TEntity>(TEntity entity) where TEntity : class => db.Set<TEntity>().Remove(entity);

    public Task<int> SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);

    public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken ct = default) =>
        db.Database.BeginTransactionAsync(ct);
}
