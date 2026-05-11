using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Transport.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class TripMultipleDestinations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TripDestinations",
                columns: table => new
                {
                    TripId = table.Column<Guid>(type: "uuid", nullable: false),
                    BranchId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TripDestinations", x => new { x.TripId, x.BranchId });
                    table.ForeignKey(
                        name: "FK_TripDestinations_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TripDestinations_Trips_TripId",
                        column: x => x.TripId,
                        principalTable: "Trips",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TripDestinations_BranchId",
                table: "TripDestinations",
                column: "BranchId");

            migrationBuilder.Sql(
                """INSERT INTO "TripDestinations" ("TripId", "BranchId") SELECT "Id", "DestinationBranchId" FROM "Trips";""");

            migrationBuilder.DropForeignKey(
                name: "FK_Trips_Branches_DestinationBranchId",
                table: "Trips");

            migrationBuilder.DropIndex(
                name: "IX_Trips_DestinationBranchId",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "DestinationBranchId",
                table: "Trips");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TripDestinations");

            migrationBuilder.AddColumn<int>(
                name: "DestinationBranchId",
                table: "Trips",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_Trips_DestinationBranchId",
                table: "Trips",
                column: "DestinationBranchId");

            migrationBuilder.AddForeignKey(
                name: "FK_Trips_Branches_DestinationBranchId",
                table: "Trips",
                column: "DestinationBranchId",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
