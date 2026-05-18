namespace Transport.Api.Contracts;

public record LoginRequest(string Phone, string Password);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record ResetPasswordRequest(string NewPassword);

public record ForgotPasswordRequest(string Email);

public record ResetPasswordWithTokenRequest(string Token, string NewPassword);

public record AdminAccountDto(int UserId, string FullName, string Phone, string? Email);

public record UpdateAdminAccountRequest(string Phone, string? Email);

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
    decimal ShippingPrice,
    decimal AmountReceivedAtOrigin);

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
    decimal ShippingPrice,
    decimal AmountReceivedAtOrigin);

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
    decimal AmountReceivedAtOrigin,
    decimal AmountReceivedAtDestination,
    decimal DueAmount,
    string Status,
    DateTime CreatedAt);

public record CustomerListItemDto(
    string Phone,
    string? SenderName,
    string? SenderAddress,
    int SentCount,
    string? ReceiverName,
    string? ReceiverAddress,
    int ReceivedCount);

public record ProductPartyDto(string Name, string Phone, string Address);

public record ProductBranchManagerDto(string BranchName, string FullName, string Phone);

public record ProductTripDetailDto(
    Guid TripId,
    string Status,
    string DriverName,
    string DriverPhone,
    string VehicleNumber,
    string OriginBranchName,
    string DestinationBranchesLabel,
    decimal DriverPaymentAmount,
    DateTime LoadTime);

public record ProductDetailDto(
    Guid Id,
    string TrackingNumber,
    string Description,
    string Status,
    ProductPartyDto Sender,
    ProductPartyDto Receiver,
    string OriginBranchName,
    string DestinationBranchName,
    ProductBranchManagerDto? OriginBranchManager,
    ProductBranchManagerDto? DestinationBranchManager,
    ProductTripDetailDto? Trip,
    decimal ShippingPrice,
    decimal AmountReceivedAtOrigin,
    decimal AmountReceivedAtDestination,
    decimal DueAmount,
    DateTime CreatedAt,
    DateTime? DeliveredAt);

public record UpsertBranchRequest(
    string BranchName,
    string Code,
    string Address,
    string SettlementType,
    decimal? CommissionPercent);

public record BranchDto(
    int Id,
    string BranchName,
    string Code,
    string Address,
    string SettlementType,
    decimal? CommissionPercent);

public record BranchSettlementPaymentDto(
    int Id,
    decimal Amount,
    string Direction,
    string? Note,
    DateTime CreatedAt,
    string RecordedByName,
    string Status,
    string? BranchName = null);

public record BranchSettlementDto(
    int BranchId,
    string BranchName,
    string SettlementType,
    decimal? CommissionPercent,
    decimal CollectedAsOrigin,
    decimal CollectedAsDestination,
    decimal DestinationShippingTotal,
    decimal CommissionEarned,
    decimal NetSettlement,
    decimal PaidToAdmin,
    decimal PaidFromAdmin,
    decimal PendingToAdmin,
    decimal DueToAdmin,
    decimal DueFromAdmin,
    IReadOnlyList<BranchSettlementPaymentDto> RecentPayments);

public record RecordBranchSettlementPaymentRequest(decimal Amount, string Direction, string? Note);

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

/// <summary>Trips at the staff branch waiting for parcels to be loaded onto the vehicle.</summary>
public record AvailableTripForStaffDto(
    Guid TripId,
    int DriverProfileId,
    string FullName,
    string VehicleNumber,
    string DestinationBranchesLabel,
    decimal DriverPaymentAmount);

public record CreateTripRequest(int DriverProfileId, IReadOnlyList<int> DestinationBranchIds, decimal DriverPaymentAmount, int? OriginBranchId);

public record UpdateTripRequest(int DriverProfileId, IReadOnlyList<int> DestinationBranchIds, decimal DriverPaymentAmount);

public record TripListItemDto(
    Guid Id,
    int DriverProfileId,
    string DriverName,
    string VehicleNumber,
    int OriginBranchId,
    string OriginBranchName,
    IReadOnlyList<int> DestinationBranchIds,
    string DestinationBranchesLabel,
    string Status,
    decimal DriverPaymentAmount,
    int ProductCount,
    int InTransitCount,
    DateTime LoadTime);

public record DriverTripStateResponse(
    string Phase,
    Guid? TripId,
    string? DestinationBranchesLabel,
    decimal? DriverPaymentAmount,
    int ProductCount);

public record DriverEarningsRowDto(
    int DriverProfileId,
    string FullName,
    string VehicleNumber,
    int? BranchId,
    string? BranchName,
    decimal AccruedTripEarnings,
    decimal PaidToDriver,
    decimal Due);

public record DriverMyEarningsDto(
    decimal AccruedTripEarnings,
    decimal PaidToDriver,
    decimal Due);

public record PayDriverEarningsRequest(decimal Amount);

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

public record DriverProfileDto(
    int DriverProfileId,
    int UserId,
    string FullName,
    string Phone,
    string VehicleNumber,
    int? BranchId,
    string? BranchName,
    bool IsApproved);

public record UpdateDriverRequest(string Phone, string VehicleNumber, int BranchId);

public record PresenceRequest(bool IsOnline);

public record LocationRequest(decimal Latitude, decimal Longitude);

public record TripLoadRequest(Guid? TripId, int DriverProfileId, List<Guid> ProductIds);

public record TripLoadResponse(Guid TripId);

public record TripUnloadRequest(List<Guid> ProductIds);

public record DeliverProductRequest(string ReceiverPhone, decimal AmountReceivedAtDestination);

public record DriverStatusResponse(bool IsApproved, int? DriverProfileId);

/// <summary>
/// Per branch: money collected when this branch was the booking (origin) branch plus when it was the destination branch,
/// for shipments delivered in the report period (filtered by <c>DeliveredAt</c>).
/// </summary>
public record BranchCollectionRowDto(
    int BranchId,
    string BranchName,
    decimal CollectedAsOrigin,
    decimal CollectedAsDestination,
    decimal TotalCollection);

/// <summary>
/// Pending products still at the sending (origin) branch, grouped by destination (routing priority: highest count first).
/// </summary>
public record BookingsByDestinationRowDto(
    int DestinationBranchId,
    string DestinationBranchName,
    int ProductCount,
    decimal TotalShippingPrice);

public record BookingsByDestinationReportDto(
    int OriginBranchId,
    string OriginBranchName,
    IReadOnlyList<BookingsByDestinationRowDto> Rows);

public record AppConfigurationDto(string ConfigKey, string ConfigValue, DateTime UpdatedAt);

public record UpdateAppConfigurationRequest(string ConfigValue);

public record MapSettingsDto(string GoogleMapsApiKey);
