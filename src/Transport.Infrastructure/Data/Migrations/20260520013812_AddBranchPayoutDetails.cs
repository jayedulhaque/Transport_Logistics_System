using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Transport.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBranchPayoutDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BKashNumber",
                table: "Branches",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountNumber",
                table: "Branches",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankRoutingNumber",
                table: "Branches",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BKashNumber",
                table: "Branches");

            migrationBuilder.DropColumn(
                name: "BankAccountNumber",
                table: "Branches");

            migrationBuilder.DropColumn(
                name: "BankRoutingNumber",
                table: "Branches");
        }
    }
}
