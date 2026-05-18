using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Transport.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBranchSettlementPaymentApproval : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ApprovedAt",
                table: "BranchSettlementPayments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ApprovedByUserId",
                table: "BranchSettlementPayments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "BranchSettlementPayments",
                type: "text",
                nullable: false,
                defaultValue: "Approved");

            migrationBuilder.CreateIndex(
                name: "IX_BranchSettlementPayments_ApprovedByUserId",
                table: "BranchSettlementPayments",
                column: "ApprovedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_BranchSettlementPayments_Users_ApprovedByUserId",
                table: "BranchSettlementPayments",
                column: "ApprovedByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BranchSettlementPayments_Users_ApprovedByUserId",
                table: "BranchSettlementPayments");

            migrationBuilder.DropIndex(
                name: "IX_BranchSettlementPayments_ApprovedByUserId",
                table: "BranchSettlementPayments");

            migrationBuilder.DropColumn(
                name: "ApprovedAt",
                table: "BranchSettlementPayments");

            migrationBuilder.DropColumn(
                name: "ApprovedByUserId",
                table: "BranchSettlementPayments");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "BranchSettlementPayments");
        }
    }
}
