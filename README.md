# Transport Logistics System

Modular .NET 10 API (PostgreSQL, EF Core, JWT, SignalR), React (Vite) admin, and Expo mobile apps.

## Run everything with Docker

From the repository root:

```bash
docker compose up --build
```

Services:

| Service    | Port(s)      | Description                                      |
|-----------|--------------|--------------------------------------------------|
| `postgres` | 5432        | PostgreSQL 16 (`transport` database)             |
| `api`      | 5000 → 8080 | ASP.NET Core API + Swagger at `/swagger`        |
| `web`      | 3000 → 80   | Static admin UI (nginx)                          |
| `mobile`   | 8081, 19000–19002 | Expo dev server (Metro)                    |

- API health: `GET http://localhost:5000/health`
- Swagger UI: `http://localhost:5000/swagger`
- Admin UI: `http://localhost:3000` (login: `admin` / `Admin123!`)

### Configuration

- API reads `ConnectionStrings__DefaultConnection`, `Jwt__*`, and `Cors__Origins__*` (see [docker-compose.yml](docker-compose.yml)).
- Web image is built with `VITE_API_URL=http://localhost:5000` so the **browser** (on your host) calls the API on `localhost:5000`.
- Expo in Docker sets `EXPO_PUBLIC_API_URL=http://host.docker.internal:5000` so the packager can reach the API on Windows/Mac hosts. For a **physical phone**, use your PC’s LAN IP (e.g. `http://192.168.1.10:5000`) in `apps/mobile/.env` or export `EXPO_PUBLIC_API_URL` before `expo start`.

### Tooling

- EF migrations: `dotnet tool restore` then `dotnet ef database update --project src/Transport.Infrastructure --startup-project src/Transport.Api`

Seeded accounts (after first migration + seed): `admin` / `Admin123!`, `staff` / `Staff123!` (branch DHAKA-01).
