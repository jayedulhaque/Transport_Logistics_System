namespace Transport.Api.Contracts;

public record LoginRequest(string Phone, string Password);

public record LoginResponse(
    string AccessToken,
    int UserId,
    string FullName,
    string Role,
    int? BranchId,
    int? DriverProfileId,
    bool DriverApproved);

public record RegisterDriverRequest(string FullName, string Phone, string Password, string VehicleNumber, int BranchId);

public record CreateProductRequest(
    string Description,
    string SenderName,
    string SenderPhone,
    string SenderAddress,
    string ReceiverName,
    string ReceiverPhone,
    string ReceiverAddress,
    int OriginBranchId,
    int DestinationBranchId,
    decimal ShippingPrice);

public record ProductCreatedResponse(Guid Id, string TrackingNumber, decimal ShippingPrice);

public record UpdateProductRequest(
    string Description,
    string SenderName,
    string SenderPhone,
    string SenderAddress,
    string ReceiverName,
    string ReceiverPhone,
    string ReceiverAddress,
    int OriginBranchId,
    int DestinationBranchId,
    decimal ShippingPrice);

public record ProductListItemDto(
    Guid Id,
    string TrackingNumber,
    string Description,
    string SenderName,
    string SenderPhone,
    string SenderAddress,
    string ReceiverName,
    string ReceiverPhone,
    string ReceiverAddress,
    int OriginBranchId,
    int DestinationBranchId,
    string OriginBranchName,
    string DestinationBranchName,
    decimal ShippingPrice,
    string Status,
    DateTime CreatedAt);

public record UpsertBranchRequest(string BranchName, string Code, string Address);

public record BranchDto(int Id, string BranchName, string Code, string Address);

public record PendingDriverDto(
    int Id,
    int UserId,
    string FullName,
    string Phone,
    string VehicleNumber,
    int? BranchId,
    string? BranchName);

public record ApprovedDriverDto(
    int Id,
    int UserId,
    string FullName,
    string Phone,
    string VehicleNumber,
    int? BranchId,
    string? BranchName,
    bool IsOnline);

public record DriverLivePositionDto(
    int DriverProfileId,
    string FullName,
    string VehicleNumber,
    decimal Latitude,
    decimal Longitude,
    DateTime? LastSeenAt,
    bool IsOnline);

public record AvailableDriverDto(int DriverProfileId, string FullName, string VehicleNumber, bool IsOnline);

public record StaffListItemDto(
    int Id,
    string FullName,
    string Phone,
    int? BranchId,
    string? BranchName,
    bool IsActive);

public record CreateStaffRequest(string FullName, string Phone, string Password, int BranchId);

public record UpdateStaffRequest(string FullName, string Phone, int BranchId, bool IsActive);

public record CreateBranchManagerRequest(string FullName, string Phone, string Password, int BranchId);

public record UpdateBranchManagerRequest(string FullName, string Phone, int BranchId, bool IsActive);

public record UpdateDriverBranchRequest(int BranchId);

public record PresenceRequest(bool IsOnline);

public record LocationRequest(decimal Latitude, decimal Longitude);

public record TripLoadRequest(int DriverProfileId, List<Guid> ProductIds);

public record TripLoadResponse(Guid TripId);

public record TripUnloadRequest(List<Guid> ProductIds);

public record DeliverProductRequest(string ReceiverPhone, bool PaidBySender, bool PaymentReceivedAtBranch);

public record DriverStatusResponse(bool IsApproved, int? DriverProfileId);

/// <summary>Delivered shipment revenue attributed to the destination branch.</summary>
public record BranchCollectionRowDto(int BranchId, string BranchName, decimal TotalCollection);

public record AppConfigurationDto(string ConfigKey, string ConfigValue, DateTime UpdatedAt);

public record UpdateAppConfigurationRequest(string ConfigValue);

public record MapSettingsDto(string GoogleMapsApiKey);
