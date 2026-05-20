using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Transport.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDriverPayoutDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BKashNumber",
                table: "DriverProfiles",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountNumber",
                table: "DriverProfiles",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankRoutingNumber",
                table: "DriverProfiles",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BKashNumber",
                table: "DriverProfiles");

            migrationBuilder.DropColumn(
                name: "BankAccountNumber",
                table: "DriverProfiles");

            migrationBuilder.DropColumn(
                name: "BankRoutingNumber",
                table: "DriverProfiles");
        }
    }
}
