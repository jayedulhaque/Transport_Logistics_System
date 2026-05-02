using Microsoft.EntityFrameworkCore;
using Transport.Domain.Entities;
using Transport.Domain.Enums;

namespace Transport.Infrastructure.Data;

public class TransportDbContext(DbContextOptions<TransportDbContext> options) : DbContext(options)
{
    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<User> Users => Set<User>();
    public DbSet<DriverProfile> DriverProfiles => Set<DriverProfile>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Trip> Trips => Set<Trip>();
    public DbSet<TripProduct> TripProducts => Set<TripProduct>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Phone).IsUnique();
            entity.Property(u => u.Role).HasConversion<string>();
            entity.HasOne(u => u.Branch)
                .WithMany(b => b.Users)
                .HasForeignKey(u => u.BranchId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DriverProfile>(entity =>
        {
            entity.Property(d => d.CurrentLat).HasPrecision(18, 8);
            entity.Property(d => d.CurrentLng).HasPrecision(18, 8);
            entity.HasOne(d => d.User)
                .WithOne(u => u.DriverProfile)
                .HasForeignKey<DriverProfile>(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Product>(entity =>
        {
            entity.HasIndex(p => p.TrackingNumber).IsUnique();
            entity.Property(p => p.Status).HasConversion<string>();
            entity.HasOne(p => p.OriginBranch)
                .WithMany(b => b.OriginProducts)
                .HasForeignKey(p => p.OriginBranchId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(p => p.DestinationBranch)
                .WithMany(b => b.DestinationProducts)
                .HasForeignKey(p => p.DestinationBranchId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(p => p.CurrentBranch)
                .WithMany(b => b.ProductsAtBranch)
                .HasForeignKey(p => p.CurrentBranchId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Trip>(entity =>
        {
            entity.Property(t => t.Status).HasConversion<string>();
            entity.HasOne(t => t.DriverProfile)
                .WithMany(d => d.Trips)
                .HasForeignKey(t => t.DriverProfileId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(t => t.OriginBranch)
                .WithMany(b => b.OriginTrips)
                .HasForeignKey(t => t.OriginBranchId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(t => t.DestinationBranch)
                .WithMany(b => b.DestinationTrips)
                .HasForeignKey(t => t.DestinationBranchId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<TripProduct>(entity =>
        {
            entity.HasKey(tp => new { tp.TripId, tp.ProductId });
            entity.HasOne(tp => tp.Trip)
                .WithMany(t => t.TripProducts)
                .HasForeignKey(tp => tp.TripId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(tp => tp.Product)
                .WithMany(p => p.TripProducts)
                .HasForeignKey(tp => tp.ProductId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
