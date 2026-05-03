using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Transport.Api.Auth;
using Transport.Api.Contracts;
using Transport.Api.Hubs;
using Transport.Api.Services;
using Transport.Domain.Entities;
using Transport.Domain.Enums;
using Transport.Infrastructure;
using Transport.Infrastructure.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.AddScoped<TokenService>();

var jwtKey = builder.Configuration["Jwt:Key"]
             ?? throw new InvalidOperationException("Jwt:Key is not configured.");
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "Transport";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "Transport";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
                  ?? ["http://localhost:5173", "http://localhost:3000"];
builder.Services.AddCors(o =>
{
    o.AddDefaultPolicy(p =>
        p.WithOrigins(corsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());
});

builder.Services.AddSignalR();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI(o => o.SwaggerEndpoint("/swagger/v1/swagger.json", "Transport API v1"));

var useHttpsRedirection = app.Environment.IsProduction();
if (useHttpsRedirection)
    app.UseHttpsRedirection();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", ts = DateTime.UtcNow }))
    .WithTags("Health");

app.MapGet("/api/branches", async (TransportDbContext db) =>
{
    var list = await db.Branches.AsNoTracking()
        .OrderBy(b => b.Code)
        .Select(b => new BranchDto(b.Id, b.BranchName, b.Code, b.Address))
        .ToListAsync();
    return Results.Ok(list);
}).AllowAnonymous();

app.MapPost("/api/branches", async (
        UpsertBranchRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var name = body.BranchName.Trim();
        var code = body.Code.Trim();
        var address = body.Address.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(code))
            return Results.BadRequest(new { error = "Branch name and code are required." });

        if (await db.Branches.AnyAsync(b => b.Code == code))
            return Results.Conflict(new { error = "A branch with this code already exists." });

        var branch = new Branch { BranchName = name, Code = code, Address = address };
        db.Branches.Add(branch);
        await db.SaveChangesAsync();

        return Results.Created(
            $"/api/branches/{branch.Id}",
            new BranchDto(branch.Id, branch.BranchName, branch.Code, branch.Address));
    })
    .RequireAuthorization();

app.MapPut("/api/branches/{id:int}", async (
        int id,
        UpsertBranchRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == id);
        if (branch is null)
            return Results.NotFound();

        var name = body.BranchName.Trim();
        var code = body.Code.Trim();
        var address = body.Address.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(code))
            return Results.BadRequest(new { error = "Branch name and code are required." });

        if (await db.Branches.AnyAsync(b => b.Code == code && b.Id != id))
            return Results.Conflict(new { error = "A branch with this code already exists." });

        branch.BranchName = name;
        branch.Code = code;
        branch.Address = address;
        await db.SaveChangesAsync();

        return Results.Ok(new BranchDto(branch.Id, branch.BranchName, branch.Code, branch.Address));
    })
    .RequireAuthorization();

app.MapDelete("/api/branches/{id:int}", async (
        int id,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == id);
        if (branch is null)
            return Results.NotFound();

        if (await db.Users.AnyAsync(u => u.BranchId == id))
            return Results.BadRequest(new { error = "Cannot delete a branch that has users assigned." });

        if (await db.Products.AnyAsync(p =>
                p.OriginBranchId == id || p.DestinationBranchId == id || p.CurrentBranchId == id))
            return Results.BadRequest(new { error = "Cannot delete a branch referenced by products." });

        if (await db.Trips.AnyAsync(t => t.OriginBranchId == id || t.DestinationBranchId == id))
            return Results.BadRequest(new { error = "Cannot delete a branch referenced by trips." });

        db.Branches.Remove(branch);
        await db.SaveChangesAsync();

        return Results.NoContent();
    })
    .RequireAuthorization();

app.MapPost("/api/auth/login", async (
        LoginRequest body,
        TransportDbContext db,
        TokenService tokens) =>
    {
        var user = await db.Users
            .Include(u => u.DriverProfile)
            .FirstOrDefaultAsync(u => u.Phone == body.Phone && u.IsActive);
        if (user?.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(body.Password, user.PasswordHash))
            return Results.Unauthorized();

        var token = tokens.CreateToken(user);
        return Results.Ok(new LoginResponse(
            token,
            user.Id,
            user.FullName,
            user.Role.ToString(),
            user.BranchId,
            user.DriverProfile?.Id,
            user.DriverProfile?.IsApproved ?? true));
    })
    .AllowAnonymous();

app.MapPost("/api/auth/register-driver", async (
        RegisterDriverRequest body,
        TransportDbContext db) =>
    {
        if (await db.Users.AnyAsync(u => u.Phone == body.Phone))
            return Results.Conflict(new { error = "Phone already registered." });

        if (!await db.Branches.AnyAsync(b => b.Id == body.BranchId))
            return Results.BadRequest(new { error = "Invalid branch." });

        var user = new User
        {
            FullName = body.FullName,
            Phone = body.Phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(body.Password),
            Role = UserRole.Driver,
            BranchId = body.BranchId,
            IsActive = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var profile = new DriverProfile
        {
            UserId = user.Id,
            VehicleNumber = body.VehicleNumber,
            IsApproved = false,
            IsOnline = false,
            CurrentLat = 0,
            CurrentLng = 0
        };
        db.DriverProfiles.Add(profile);
        await db.SaveChangesAsync();

        return Results.Created($"/api/drivers/{profile.Id}", new { driverProfileId = profile.Id, user.Id });
    })
    .AllowAnonymous();

app.MapGet("/api/drivers/pending", async (ClaimsPrincipal principal, TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var list = await db.DriverProfiles.AsNoTracking()
            .Where(d => !d.IsApproved)
            .Include(d => d.User)
            .Select(d => new PendingDriverDto(
                d.Id,
                d.UserId,
                d.User.FullName,
                d.User.Phone,
                d.VehicleNumber,
                d.User.BranchId))
            .ToListAsync();

        return Results.Ok(list);
    })
    .RequireAuthorization();

app.MapPatch("/api/drivers/{id:int}/approve", async (
        int id,
        ClaimsPrincipal principal,
        TransportDbContext db,
        IHubContext<TransportHub> hub) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var profile = await db.DriverProfiles.Include(d => d.User).FirstOrDefaultAsync(d => d.Id == id);
        if (profile is null)
            return Results.NotFound();

        profile.IsApproved = true;
        await db.SaveChangesAsync();

        await hub.Clients.Group($"user-{profile.UserId}")
            .SendAsync("DriverApproved", profile.Id);

        return Results.NoContent();
    })
    .RequireAuthorization();

app.MapGet("/api/drivers/me/status", async (ClaimsPrincipal principal, TransportDbContext db) =>
    {
        var userId = GetUserId(principal);
        var profile = await db.DriverProfiles.AsNoTracking()
            .FirstOrDefaultAsync(d => d.UserId == userId);
        return Results.Ok(new DriverStatusResponse(profile?.IsApproved ?? false, profile?.Id));
    })
    .RequireAuthorization();

app.MapPatch("/api/drivers/me/presence", async (
        PresenceRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        var userId = GetUserId(principal);
        var profile = await db.DriverProfiles.FirstOrDefaultAsync(d => d.UserId == userId);
        if (profile is null)
            return Results.NotFound();

        profile.IsOnline = body.IsOnline;
        profile.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Results.NoContent();
    })
    .RequireAuthorization();

app.MapPatch("/api/drivers/me/location", async (
        LocationRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db,
        IHubContext<TransportHub> hub) =>
    {
        var userId = GetUserId(principal);
        var profile = await db.DriverProfiles.FirstOrDefaultAsync(d => d.UserId == userId);
        if (profile is null)
            return Results.NotFound();

        profile.CurrentLat = body.Latitude;
        profile.CurrentLng = body.Longitude;
        profile.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        await hub.Clients.Group("live-tracking").SendAsync(
            "LocationUpdated",
            profile.Id,
            body.Latitude,
            body.Longitude);

        return Results.NoContent();
    })
    .RequireAuthorization();

app.MapGet("/api/staff/available-drivers", async (ClaimsPrincipal principal, TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)))
            return Results.Forbid();

        var branchClaim = principal.FindFirst(JwtClaims.BranchId)?.Value;
        if (string.IsNullOrEmpty(branchClaim) || !int.TryParse(branchClaim, out var branchId))
            return Results.BadRequest(new { error = "Staff must belong to a branch." });

        var list = await db.DriverProfiles.AsNoTracking()
            .Where(d => d.IsApproved && d.IsOnline && d.User.BranchId == branchId)
            .Select(d => new AvailableDriverDto(d.Id, d.User.FullName, d.VehicleNumber, d.IsOnline))
            .ToListAsync();

        return Results.Ok(list);
    })
    .RequireAuthorization();

app.MapGet("/api/staff/products/lookup", async (
        string tracking,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)))
            return Results.Forbid();

        var branchClaim = principal.FindFirst(JwtClaims.BranchId)?.Value;
        if (string.IsNullOrEmpty(branchClaim) || !int.TryParse(branchClaim, out var staffBranchId))
            return Results.BadRequest(new { error = "Staff must belong to a branch." });

        var product = await db.Products.AsNoTracking()
            .FirstOrDefaultAsync(p => p.TrackingNumber == tracking);
        if (product is null)
            return Results.NotFound();

        if (product.CurrentBranchId != staffBranchId)
            return Results.BadRequest(new { error = "Product is not at your branch." });

        return Results.Ok(new { product.Id, product.TrackingNumber, status = product.Status.ToString() });
    })
    .RequireAuthorization();

app.MapPost("/api/products", async (
        CreateProductRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var originExists = await db.Branches.AnyAsync(b => b.Id == body.OriginBranchId);
        var destExists = await db.Branches.AnyAsync(b => b.Id == body.DestinationBranchId);
        if (!originExists || !destExists)
            return Results.BadRequest(new { error = "Invalid origin or destination branch." });

        if (body.ShippingPrice < 0)
            return Results.BadRequest(new { error = "Shipping price cannot be negative." });

        var tracking = $"TN-{Guid.NewGuid():N}"[..18];

        var product = new Product
        {
            Id = Guid.NewGuid(),
            TrackingNumber = tracking,
            Description = body.Description.Trim(),
            SenderName = body.SenderName.Trim(),
            SenderPhone = body.SenderPhone.Trim(),
            SenderAddress = body.SenderAddress.Trim(),
            ReceiverName = body.ReceiverName.Trim(),
            ReceiverPhone = body.ReceiverPhone.Trim(),
            ReceiverAddress = body.ReceiverAddress.Trim(),
            ShippingPrice = body.ShippingPrice,
            OriginBranchId = body.OriginBranchId,
            DestinationBranchId = body.DestinationBranchId,
            CurrentBranchId = body.OriginBranchId,
            Status = ProductStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        db.Products.Add(product);
        await db.SaveChangesAsync();

        return Results.Ok(new ProductCreatedResponse(product.Id, product.TrackingNumber, product.ShippingPrice));
    })
    .RequireAuthorization();

app.MapGet("/api/products", async (ClaimsPrincipal principal, TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var list = await (
            from p in db.Products.AsNoTracking()
            join ob in db.Branches.AsNoTracking() on p.OriginBranchId equals ob.Id
            join dbDest in db.Branches.AsNoTracking() on p.DestinationBranchId equals dbDest.Id
            orderby p.CreatedAt descending
            select new ProductListItemDto(
                p.Id,
                p.TrackingNumber,
                p.Description,
                p.SenderName,
                p.SenderPhone,
                p.SenderAddress,
                p.ReceiverName,
                p.ReceiverPhone,
                p.ReceiverAddress,
                p.OriginBranchId,
                p.DestinationBranchId,
                ob.BranchName,
                dbDest.BranchName,
                p.ShippingPrice,
                p.Status.ToString(),
                p.CreatedAt)).ToListAsync();

        return Results.Ok(list);
    })
    .RequireAuthorization();

app.MapPut("/api/products/{id:guid}", async (
        Guid id,
        UpdateProductRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var originExists = await db.Branches.AnyAsync(b => b.Id == body.OriginBranchId);
        var destExists = await db.Branches.AnyAsync(b => b.Id == body.DestinationBranchId);
        if (!originExists || !destExists)
            return Results.BadRequest(new { error = "Invalid origin or destination branch." });

        if (body.ShippingPrice < 0)
            return Results.BadRequest(new { error = "Shipping price cannot be negative." });

        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id);
        if (product is null)
            return Results.NotFound();

        product.Description = body.Description.Trim();
        product.SenderName = body.SenderName.Trim();
        product.SenderPhone = body.SenderPhone.Trim();
        product.SenderAddress = body.SenderAddress.Trim();
        product.ReceiverName = body.ReceiverName.Trim();
        product.ReceiverPhone = body.ReceiverPhone.Trim();
        product.ReceiverAddress = body.ReceiverAddress.Trim();
        product.OriginBranchId = body.OriginBranchId;
        product.DestinationBranchId = body.DestinationBranchId;
        product.ShippingPrice = body.ShippingPrice;

        if (product.Status == ProductStatus.Pending)
            product.CurrentBranchId = body.OriginBranchId;

        await db.SaveChangesAsync();
        return Results.NoContent();
    })
    .RequireAuthorization();

app.MapDelete("/api/products/{id:guid}", async (
        Guid id,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Admin)))
            return Results.Forbid();

        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id);
        if (product is null)
            return Results.NotFound();

        if (await db.TripProducts.AnyAsync(tp => tp.ProductId == id))
            return Results.BadRequest(new { error = "Cannot delete a product that has been assigned to a trip." });

        db.Products.Remove(product);
        await db.SaveChangesAsync();

        return Results.NoContent();
    })
    .RequireAuthorization();

app.MapPost("/api/trips/load", async (
        TripLoadRequest body,
        ClaimsPrincipal principal,
        TransportDbContext db) =>
    {
        if (!principal.IsInRole(nameof(UserRole.Staff)))
            return Results.Forbid();

        var branchClaim = principal.FindFirst(JwtClaims.BranchId)?.Value;
        if (string.IsNullOrEmpty(branchClaim) || !int.TryParse(branchClaim, out var staffBranchId))
            return Results.BadRequest(new { error = "Staff must belong to a branch." });

        if (body.ProductIds.Count == 0)
            return Results.BadRequest(new { error = "No products selected." });

        var driver = await db.DriverProfiles
            .Include(d => d.User)
            .FirstOrDefaultAsync(d => d.Id == body.DriverProfileId);

        if (driver is null || !driver.IsApproved || driver.User.BranchId != staffBranchId)
            return Results.BadRequest(new { error = "Invalid driver for this branch." });

        await using var tx = await db.Database.BeginTransactionAsync();

        var products = await db.Products
            .Where(p => body.ProductIds.Contains(p.Id))
            .ToListAsync();

        if (products.Count != body.ProductIds.Count)
            return Results.BadRequest(new { error = "One or more products were not found." });

        foreach (var p in products)
        {
            if (p.CurrentBranchId != staffBranchId)
                return Results.BadRequest(new { error = $"Product {p.Id} is not at your branch." });
            if (p.Status != ProductStatus.Pending)
                return Results.BadRequest(new { error = $"Product {p.TrackingNumber} is not pending." });
        }

        var destId = products[0].DestinationBranchId;
        if (products.Any(p => p.DestinationBranchId != destId))
            return Results.BadRequest(new { error = "All products in a load must share the same destination branch." });

        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            DriverProfileId = driver.Id,
            OriginBranchId = staffBranchId,
            DestinationBranchId = destId,
            LoadTime = DateTime.UtcNow,
            Status = TripStatus.Active
        };
        db.Trips.Add(trip);

        foreach (var p in products)
        {
            db.TripProducts.Add(new TripProduct { TripId = trip.Id, ProductId = p.Id });
            p.Status = ProductStatus.InTransit;
            p.CurrentBranchId = null;
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return Results.Ok(new TripLoadResponse(trip.Id));
    })
    .RequireAuthorization();

app.MapHub<TransportHub>("/hubs/transport");

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TransportDbContext>();
    await db.Database.MigrateAsync();
    await DatabaseSeed.SeedAsync(db);
}

app.Run();

static int GetUserId(ClaimsPrincipal principal)
{
    var id = principal.FindFirstValue(ClaimTypes.NameIdentifier)
             ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
    if (string.IsNullOrEmpty(id) || !int.TryParse(id, out var userId))
        throw new InvalidOperationException("Invalid user id claim.");
    return userId;
}
