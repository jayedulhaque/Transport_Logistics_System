using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Transport.Api.Auth;
using Transport.Infrastructure.Data;

namespace Transport.Api.Hubs;

[Authorize]
public class TransportHub(IServiceScopeFactory scopeFactory) : Hub
{
    public Task SubscribeLiveTracking() =>
        Groups.AddToGroupAsync(Context.ConnectionId, "live-tracking");

    public Task JoinUserChannel(int userId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, $"user-{userId}");

    public async Task ReportLocation(decimal latitude, decimal longitude)
    {
        var driverClaim = Context.User?.FindFirst(JwtClaims.DriverProfileId)?.Value;
        if (string.IsNullOrEmpty(driverClaim) || !int.TryParse(driverClaim, out var driverProfileId))
            return;

        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<TransportDbContext>();
        var profile = await db.DriverProfiles.FirstOrDefaultAsync(d => d.Id == driverProfileId);
        if (profile is null)
            return;

        profile.CurrentLat = latitude;
        profile.CurrentLng = longitude;
        profile.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        await Clients.Group("live-tracking").SendAsync(
            "LocationUpdated",
            driverProfileId,
            latitude,
            longitude);
    }
}
