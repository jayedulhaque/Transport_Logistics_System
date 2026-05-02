using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Transport.Infrastructure.Data;

public class TransportDbContextFactory : IDesignTimeDbContextFactory<TransportDbContext>
{
    public TransportDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<TransportDbContext>();
        optionsBuilder.UseNpgsql(
            "Host=localhost;Port=5432;Database=transport;Username=postgres;Password=postgres");
        return new TransportDbContext(optionsBuilder.Options);
    }
}
