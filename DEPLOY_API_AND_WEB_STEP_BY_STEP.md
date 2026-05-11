# Step-by-step: Deploy API and Web App

This document walks through deploying **only** the .NET API (`Transport.Api` in Docker) and the **Vite web app** (`apps/web`). Explanations accompany every command so you know what it does and why.

For mobile, cost tradeoffs, and a shorter overview, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## What you are deploying

| Piece | What it is | How it runs in production |
| ----- | ---------- | --------------------------- |
| **API** | ASP.NET Core app | Docker image on Azure Container Apps (or similar) listening on **port 8080** |
| **Web** | React/Vite SPA | Static files after `npm run build`; Azure Static Web Apps is the path used in this repo |
| **Database** | PostgreSQL | Managed PostgreSQL (Azure Flexible Server recommended here) |

The API Dockerfile is `docker/api/Dockerfile`. The web build output folder is `apps/web/dist`.

---

## Part 0 — Prerequisites

**Accounts**

- **Azure** — hosts registry, API container, database, and optionally Static Web App. [Azure free account](https://azure.microsoft.com/free).
- **GitHub** — your code and CI for the web app (this repo includes a Static Web Apps workflow).

**Software on your machine**

| Tool | Purpose |
| ---- | ------- |
| **Git** | Clone/push the repo |
| **Docker Desktop** | Build the API image locally before pushing to Azure Container Registry |
| **Azure CLI** | Create resources and deploy from the terminal. [Install Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) |
| **Node.js 20+** | Local web builds and troubleshooting (`npm` in `apps/web`) |
| **.NET SDK** (optional) | Local API runs/tests without Docker |

**Verify installations**

```powershell
# Windows PowerShell
az --version
docker --version
node --version
git --version
```

**Sign in to Azure**

```powershell
az login
```

Opens a browser to authenticate. After login:

```powershell
az account show
```

Shows the active subscription. If you have several subscriptions:

```powershell
az account list --output table
az account set --subscription "<SUBSCRIPTION_NAME_OR_ID>"
```

---

## Part 1 — Decide names and secrets (no cloud commands yet)

Pick values you will reuse everywhere. **Replace placeholders** with your own.

| Variable | Example | Meaning |
| -------- | ------- | ------- |
| `LOCATION` | `eastus` | Azure region where resources live |
| `RG` | `rg-transport-prod` | Resource group: a folder for all related Azure resources |
| `ACR` | `acrtransportprod123` | Azure Container Registry name: **3–50 chars**, alphanumeric only, globally unique |
| `ACA_ENV` | `aca-env-transport-prod` | Container Apps *environment* (shared networking/log layer for apps) |
| `API_APP` | `aca-transport-api` | Name of the Container App running the API |
| `PG_SERVER` | `pg-transport-prod-123` | PostgreSQL server hostname prefix (must be unique) |
| `PG_DB` | `transport` | Database name |
| `PG_USER` | `transportadmin` | PostgreSQL admin username |

**Secrets to generate before deploy** (store in a password manager; do not commit):

- **Strong DB password** — for `PG_USER` on Azure PostgreSQL.
- **JWT key** — at least 32 random characters for `Jwt__Key`.
- **JWT issuer / audience** — string identifiers for your tokens, e.g. `TransportProd` and `TransportClients`.

**URLs you will use after deploy**

- **API public URL** — first you get a default `*.azurecontainerapps.io` hostname; later you may add a custom domain.
- **Web public URL** — from Azure Static Web App (e.g. `*.azurestaticapps.net`).

The web app needs **build-time** variables (Vite bakes them into the JS bundle):

- `VITE_API_URL` — base URL of the API, e.g. `https://<your-api-hostname>`
- `VITE_SIGNALR_URL` — usually the **same** as the API URL for this project

Optional:

- `VITE_GOOGLE_MAPS_API_KEY` — fallback maps key; admin can set key in DB per [DEPLOYMENT.md](./DEPLOYMENT.md).

The API needs **runtime** configuration (see Part 5): connection string, JWT, CORS origins pointing at your **real** web URL(s).

---

## Part 2 — Set shell variables (PowerShell)

All following Azure commands assume these are set. **Edit the values** first.

```powershell
# Azure region
$env:LOCATION = "eastus"

# Resource names (must be unique where Azure requires it)
$env:RG = "rg-transport-prod"
$env:ACR = "acrtransportprod123"          # change: globally unique
$env:ACA_ENV = "aca-env-transport-prod"
$env:API_APP = "aca-transport-api"
$env:PG_SERVER = "pg-transport-prod-123"  # change: globally unique
$env:PG_DB = "transport"
$env:PG_USER = "transportadmin"

# After you create Postgres, set this to the real password you used
$env:PG_PASSWORD = "<STRONG_DB_PASSWORD>"
```

**Explanation:** PowerShell `$env:NAME` defines environment variables for the current session only. The Azure CLI reads `$env:RG` as `%RG%` would in cmd—here we use `$env:RG` inside PowerShell strings.

**Bash equivalent** (Git Bash / WSL / macOS/Linux):

```bash
export LOCATION=eastus
export RG=rg-transport-prod
export ACR=acrtransportprod123
export ACA_ENV=aca-env-transport-prod
export API_APP=aca-transport-api
export PG_SERVER=pg-transport-prod-123
export PG_DB=transport
export PG_USER=transportadmin
export PG_PASSWORD='<STRONG_DB_PASSWORD>'
```

---

## Part 3 — Create resource group

**Command (PowerShell):**

```powershell
az group create --name $env:RG --location $env:LOCATION
```

**What it does:** Creates an empty **resource group** named `RG` in `LOCATION`. All next resources attach to this group so you can delete or bill them as one unit.

**Success:** JSON output with `"provisioningState": "Succeeded"`.

---

## Part 4 — Create PostgreSQL (Flexible Server)

### 4.1 Create server

**Command:**

```powershell
az postgres flexible-server create `
  --resource-group $env:RG `
  --name $env:PG_SERVER `
  --location $env:LOCATION `
  --admin-user $env:PG_USER `
  --admin-password $env:PG_PASSWORD `
  --sku-name Standard_B1ms `
  --tier Burstable `
  --storage-size 32 `
  --version 16
```

**What it does:**

- **`flexible-server create`** — managed PostgreSQL with configurable compute/storage.
- **`--admin-user` / `--admin-password`** — superuser for the server (use your `$env:PG_USER` and strong password).
- **`--sku-name Standard_B1ms`** — small burstable VM size (cheap dev/small prod; adjust for load).
- **`--version 16`** — PostgreSQL major version.

**Note:** Azure may default firewall rules. For Container Apps you typically allow Azure services or add the outbound IPs of your environment later—see Azure docs for “PostgreSQL flexible server firewall” + Container Apps.

### 4.2 Create application database

```powershell
az postgres flexible-server db create `
  --resource-group $env:RG `
  --server-name $env:PG_SERVER `
  --database-name $env:PG_DB
```

**What it does:** Creates a database named `transport` (or your `$env:PG_DB`) inside the server, separate from the default `postgres` DB.

### 4.3 Get the database host FQDN

```powershell
az postgres flexible-server show `
  --resource-group $env:RG `
  --name $env:PG_SERVER `
  --query fullyQualifiedDomainName `
  --output tsv
```

**What it does:** Prints the hostname you need in the API connection string, e.g. `pg-transport-prod-123.postgres.database.azure.com`.

Save this as `PG_HOST` mentally or in a note. Your connection string will look like:

```text
Host=<PG_HOST>;Port=5432;Database=<PG_DB>;Username=<PG_USER>;Password=<PG_PASSWORD>;Ssl Mode=Require;Trust Server Certificate=true
```

**Explanation:** Npgsql uses this format. `Ssl Mode=Require` is normal for Azure PostgreSQL. Adjust if your policy forbids `Trust Server Certificate`.

---

## Part 5 — Azure Container Registry (ACR) and API image

### 5.1 Create registry

```powershell
az acr create --resource-group $env:RG --name $env:ACR --sku Basic
```

**What it does:** Creates a private Docker registry `ACR.azurecr.io` to store your API image. **Basic** SKU is enough to start.

### 5.2 Log in to ACR from your machine

```powershell
az acr login --name $env:ACR
```

**What it does:** Docker on your PC gets credentials to **push** images to this registry.

### 5.3 Build the API image (from repo root)

Open a terminal **at the repository root** (folder that contains `docker` and `src`).

```powershell
cd D:\Transport_Logistics_System

docker build -f docker/api/Dockerfile -t "$($env:ACR).azurecr.io/transport-api:1.0.0" .
```

**What it does:**

- **`docker build`** — builds an image using stages in `docker/api/Dockerfile` (SDK build, runtime image, port 8080).
- **`-f docker/api/Dockerfile`** — Dockerfile path.
- **`-t .../transport-api:1.0.0`** — image name **must** include your registry host and a **tag** (version).
- **`.`** — build context is repo root so `COPY src/...` paths work.

### 5.4 Push image to ACR

```powershell
docker push "$($env:ACR).azurecr.io/transport-api:1.0.0"
```

**What it does:** Uploads layers to Azure so Container Apps can pull the image.

---

## Part 6 — Container Apps environment and API

### 6.1 Create Container Apps environment

```powershell
az containerapp env create `
  --name $env:ACA_ENV `
  --resource-group $env:RG `
  --location $env:LOCATION
```

**What it does:** Provisions shared infrastructure (logging, virtual network integration options) for one or more **Container Apps**.

### 6.2 Create the API Container App (first deploy)

You must give Container Apps access to pull from ACR. The simplest pattern is enabling the registry’s admin user (okay for learning; production often uses managed identity).

**Enable admin user on ACR (optional but simple):**

```powershell
az acr update --name $env:ACR --admin-enabled true
```

**Get ACR username and password:**

```powershell
az acr credential show --name $env:ACR --query username -o tsv
az acr credential show --name $env:ACR --query "passwords[0].value" -o tsv
```

**Create the app** (replace `<ACR_USERNAME>` and `<ACR_PASSWORD>` with the output above):

```powershell
az containerapp create `
  --name $env:API_APP `
  --resource-group $env:RG `
  --environment $env:ACA_ENV `
  --image "$($env:ACR).azurecr.io/transport-api:1.0.0" `
  --target-port 8080 `
  --ingress external `
  --registry-server "$($env:ACR).azurecr.io" `
  --registry-username "<ACR_USERNAME>" `
  --registry-password "<ACR_PASSWORD>" `
  --cpu 0.5 `
  --memory 1.0Gi
```

**What each important flag does:**

| Flag | Meaning |
| ---- | ------- |
| `--image` | Full image reference in ACR |
| `--target-port 8080` | Matches `ASPNETCORE_URLS` / `EXPOSE` in Dockerfile |
| `--ingress external` | Gives a public HTTPS URL |
| `--registry-*` | Credentials so Azure can pull private images |

### 6.3 Set API environment variables (runtime)

Replace `<PG_HOST>`, connection pieces, JWT values, and web URLs with yours. Use a **single line** or PowerShell backtick continuation.

```powershell
az containerapp update `
  --name $env:API_APP `
  --resource-group $env:RG `
  --set-env-vars `
  "ASPNETCORE_ENVIRONMENT=Production" `
  "ASPNETCORE_URLS=http://+:8080" `
  "ConnectionStrings__DefaultConnection=Host=<PG_HOST>;Port=5432;Database=$($env:PG_DB);Username=$($env:PG_USER);Password=$($env:PG_PASSWORD);Ssl Mode=Require;Trust Server Certificate=true" `
  "Jwt__Key=<STRONG_JWT_KEY_MIN_32_CHARS>" `
  "Jwt__Issuer=TransportProd" `
  "Jwt__Audience=TransportClients" `
  "Cors__Origins__0=https://<YOUR_STATIC_WEB_APP_HOSTNAME>" `
  "Cors__Origins__1=https://<OPTIONAL_SECOND_ORIGIN>"
```

**What it does:**

- **`ASPNETCORE_ENVIRONMENT`** — Production behavior and logging.
- **`ConnectionStrings__DefaultConnection`** — `__` is how ASP.NET Core maps nested config from env vars.
- **`Jwt__*`** — signing and validation for auth tokens.
- **`Cors__Origins__0`** — browser may block the web app unless the **exact** web origin (scheme + host + port) is allowed.

**Get the API URL:**

```powershell
az containerapp show `
  --name $env:API_APP `
  --resource-group $env:RG `
  --query properties.configuration.ingress.fqdn `
  --output tsv
```

Example result: `aca-transport-api.<random>.eastus.azurecontainerapps.io`. Your API base URL is:

```text
https://<that-fqdn>
```

**Smoke test:**

```powershell
curl "https://<that-fqdn>/health"
```

(or open the URL in a browser)

---

## Part 7 — Deploy the web app (Azure Static Web Apps + GitHub)

The repo includes a workflow under `.github/workflows/` that deploys when you push to **`develop`**. It builds `apps/web` and publishes `dist`.

### 7.1 One-time: create Static Web App in Azure Portal

1. Azure Portal → **Create a resource** → **Static Web App**.
2. Link your **GitHub** org/repo and branch **`develop`** (or change the workflow to match your branch).
3. Build presets:
   - **App location:** `apps/web`
   - **Api location:** leave empty (API is separate)
   - **Output location:** `dist`
4. Finish creation. Azure adds a deployment token and may add/update the workflow file.

**Explanation:** Static Web Apps runs your GitHub Action on push; the action runs `npm install` / `npm run build` in `apps/web` and uploads `dist`.

### 7.2 GitHub repository secrets (web build-time)

In GitHub: **Repo → Settings → Secrets and variables → Actions**.

Add:

| Secret | Example value | Purpose |
| ------ | ------------- | ------- |
| `VITE_API_URL` | `https://<api-fqdn-from-part-6>` | Frontend calls REST API here |
| `VITE_SIGNALR_URL` | Same as `VITE_API_URL` | SignalR hub on same host |
| `VITE_GOOGLE_MAPS_API_KEY` | *(optional)* | Fallback if DB key not set |

Also required for this repo’s workflow:

- **`AZURE_STATIC_WEB_APPS_API_TOKEN_...`** — provided by Azure when you connect the app; name must match the workflow.

**Important:** The sample workflow file may list `VITE_OTHER_VARIABLE` as a placeholder. **Align** the workflow `env:` block with the variables your app actually reads (`VITE_API_URL`, `VITE_SIGNALR_URL`, etc.). Example snippet to use under `env:` for the build step:

```yaml
env:
  VITE_API_URL: ${{ secrets.VITE_API_URL }}
  VITE_SIGNALR_URL: ${{ secrets.VITE_SIGNALR_URL }}
  VITE_GOOGLE_MAPS_API_KEY: ${{ secrets.VITE_GOOGLE_MAPS_API_KEY }}
```

After changing secrets or workflow, push to **`develop`** (per current workflow) to trigger a rebuild.

### 7.3 Confirm web URL and CORS

After deploy, note the Static Web App URL (e.g. `https://<name>.azurestaticapps.net`).

1. Put that origin in API **`Cors__Origins__0`** (Part 6.3) if you have not already.
2. Redeploy or restart the Container App if CORS was wrong on first try.

---

## Part 8 — Order of operations (checklist)

1. Create RG → PostgreSQL → note `PG_HOST`.
2. ACR → build → push API image.
3. Container Apps env → create API app → set env vars including DB + CORS (use **temporary** CORS if web URL unknown, then update).
4. Get API HTTPS URL → test `/health`.
5. Create Static Web App → set GitHub secrets → fix workflow `env` → push `develop`.
6. Set CORS on API to final web URL → `az containerapp update` again if needed.

---

## Part 9 — Redeploy new API version

```powershell
docker build -f docker/api/Dockerfile -t "$($env:ACR).azurecr.io/transport-api:1.0.1" .
docker push "$($env:ACR).azurecr.io/transport-api:1.0.1"

az containerapp update `
  --name $env:API_APP `
  --resource-group $env:RG `
  --image "$($env:ACR).azurecr.io/transport-api:1.0.1"
```

**What it does:** New tag in ACR, then Container App pulls the new image and rolls out.

---

## Part 10 — Quick troubleshooting

| Symptom | What to check |
| ------- | --------------- |
| Web “Network error” / CORS | API `Cors__Origins__*` must match web URL exactly (`https://...`). |
| API won’t start | Connection string host/user/password/SSL; PostgreSQL firewall must allow Container Apps. |
| Old API URL in web | `VITE_*` are build-time; change GitHub secrets and **rebuild** Static Web App. |
| SignalR fails | `VITE_SIGNALR_URL` must point to API; ingress must support WebSockets (Container Apps does for HTTP/2 and websockets). |

---

## Reference — local-only commands (optional)

**Run web locally against local API:**

```powershell
cd D:\Transport_Logistics_System\apps\web
npm install
npm run dev
```

Copy `apps/web/.env.example` to `apps/web/.env` and set `VITE_API_URL` / `VITE_SIGNALR_URL` to your local API (e.g. `http://localhost:5000`).

**Run API locally** (without Docker): use your solution’s usual `dotnet run` on `Transport.Api` with local PostgreSQL or connection string pointing to Azure (not recommended for production secrets on dev machines).

---

You now have a single markdown file that lists **each major step**, the **exact style of commands** used in this repo (Dockerfile path, port 8080, `apps/web` / `dist`), and **why** each part matters for API + web together.
