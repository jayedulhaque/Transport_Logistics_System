FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /app

COPY src/Transport.Domain/Transport.Domain.csproj Transport.Domain/
COPY src/Transport.Infrastructure/Transport.Infrastructure.csproj Transport.Infrastructure/
COPY src/Transport.Api/Transport.Api.csproj Transport.Api/

RUN dotnet restore Transport.Api/Transport.Api.csproj

COPY src/Transport.Domain/ Transport.Domain/
COPY src/Transport.Infrastructure/ Transport.Infrastructure/
COPY src/Transport.Api/ Transport.Api/

WORKDIR /app/Transport.Api
RUN dotnet publish -c Release -o /out/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Transport.Api.dll"]
