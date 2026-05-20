using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Transport.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentMethods : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PreferredPaymentMethod",
                table: "DriverProfiles",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentMethod",
                table: "BranchSettlementPayments",
                type: "text",
                nullable: false,
                defaultValue: "Cash");

            migrationBuilder.CreateTable(
                name: "DriverEarningsPayments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DriverProfileId = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PaymentMethod = table.Column<string>(type: "text", nullable: false),
                    RecordedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DriverEarningsPayments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DriverEarningsPayments_DriverProfiles_DriverProfileId",
                        column: x => x.DriverProfileId,
                        principalTable: "DriverProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DriverEarningsPayments_Users_RecordedByUserId",
                        column: x => x.RecordedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DriverEarningsPayments_DriverProfileId",
                table: "DriverEarningsPayments",
                column: "DriverProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_DriverEarningsPayments_RecordedByUserId",
                table: "DriverEarningsPayments",
                column: "RecordedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DriverEarningsPayments");

            migrationBuilder.DropColumn(
                name: "PreferredPaymentMethod",
                table: "DriverProfiles");

            migrationBuilder.DropColumn(
                name: "PaymentMethod",
                table: "BranchSettlementPayments");
        }
    }
}
