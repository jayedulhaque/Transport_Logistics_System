# Deployment Guide (Azure First + Free Alternatives)

This guide helps you deploy the full Transport Logistics System from scratch:
- API (`Transport.Api`, .NET container)
- Web (`apps/web`, Vite + Nginx)
- Database (PostgreSQL)
- Mobile release flow (`apps/mobile`, Expo EAS)

It is written for beginners and uses an Azure-first approach, with free/low-cost alternatives if Azure free quota is not enough.

---

## 1) What you can host for free (realistic)

### Azure free reality
- Azure gives free credits/trials for new accounts, but **always-on production apps** usually exceed fully free limits.
- You can still start with Azure using low-cost SKUs and keep costs small.

### Practical recommendation
- **Primary path (recommended):** Azure for API + DB + Web.
- **Fallback path (cheaper/free):**
  - API: Render or Railway
  - DB: Render PostgreSQL, Railway PostgreSQL, or Supabase free tier
  - Web: Vercel or Netlify
  - Mobile: Expo EAS (cloud build)

---

## 2) Production architecture for this repo

Your current `docker-compose.yml` is for development. In production:
- Deploy API as one container service
- Deploy Web as static site or containerized Nginx site
- Use managed PostgreSQL (not local container volume)
- Mobile app is not a long-running server; release it via app distribution

---

## 3) Prerequisites (from scratch)

Create these accounts:
- Azure account: [https://azure.microsoft.com/free](https://azure.microsoft.com/free)
- GitHub account/repository for this project
- Expo account: [https://expo.dev/signup](https://expo.dev/signup)

Install locally:
- Git
- Docker Desktop
- Azure CLI: [https://learn.microsoft.com/cli/azure/install-azure-cli](https://learn.microsoft.com/cli/azure/install-azure-cli)
- Node.js 20+
- .NET SDK (for diagnostics)
- Expo/EAS CLI:
  - `npm install -g eas-cli`

Login checks:
```bash
az login
az account show
docker --version
node --version
eas --version
```

---

## 4) Prepare production secrets and environment values

Do **not** use development defaults (`postgres/postgres`, dev JWT key, localhost CORS).

Create a secure value set first:
- `JWT_KEY` (min 32 chars, random)
- `JWT_ISSUER` (e.g., `TransportProd`)
- `JWT_AUDIENCE` (e.g., `TransportClients`)
- `DB_PASSWORD` (strong random password)
- `API_DOMAIN` (e.g., `api.yourdomain.com`)
- `WEB_DOMAIN` (e.g., `app.yourdomain.com`)

Example production env template (reference only):

```env
# API
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://+:8080
ConnectionStrings__DefaultConnection=Host=<PG_HOST>;Port=5432;Database=transport;Username=<PG_USER>;Password=<PG_PASSWORD>;Ssl Mode=Require;Trust Server Certificate=true
Jwt__Key=<VERY_STRONG_RANDOM_KEY_32_PLUS_CHARS>
Jwt__Issuer=TransportProd
Jwt__Audience=TransportClients
Cors__Origins__0=https://app.yourdomain.com
Cors__Origins__1=https://admin.yourdomain.com

# Web build-time
VITE_API_URL=https://api.yourdomain.com
VITE_SIGNALR_URL=https://api.yourdomain.com
# Optional fallback only (primary key source is DB/admin panel)
VITE_GOOGLE_MAPS_API_KEY=<OPTIONAL_FALLBACK_MAPS_KEY>

# Mobile build-time
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

Security minimum:
- Rotate all seeded passwords after first deployment
- Restrict CORS to real domains only
- Use HTTPS only
- Keep secrets in Azure/host secret settings (not committed files)

---

## 5) Azure primary deployment (step by step)

This section uses:
- Azure Container Registry (ACR)
- Azure Container Apps (API)
- Azure Database for PostgreSQL Flexible Server (DB)
- Azure Static Web Apps (Web, easiest for Vite)

You can replace Static Web Apps with App Service if needed.

### 5.1 Create resource group and basic variables

```bash
# set your values
export LOCATION=eastus
export RG=rg-transport-prod
export ACR=acrtransportprod123
export ACA_ENV=aca-env-transport-prod
export API_APP=aca-transport-api
export PG_SERVER=pg-transport-prod-123
export PG_DB=transport
export PG_USER=transportadmin
```

PowerShell equivalents:
```powershell
$env:LOCATION="eastus"
$env:RG="rg-transport-prod"
$env:ACR="acrtransportprod123"
$env:ACA_ENV="aca-env-transport-prod"
$env:API_APP="aca-transport-api"
$env:PG_SERVER="pg-transport-prod-123"
$env:PG_DB="transport"
$env:PG_USER="transportadmin"
```

Create resource group:
```bash
az group create --name $RG --location $LOCATION
```

### 5.2 Create PostgreSQL Flexible Server

```bash
az postgres flexible-server create \
  --resource-group $RG \
  --name $PG_SERVER \
  --location $LOCATION \
  --admin-user $PG_USER \
  --admin-password "<STRONG_DB_PASSWORD>" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16
```

Create database:
```bash
az postgres flexible-server db create \
  --resource-group $RG \
  --server-name $PG_SERVER \
  --database-name $PG_DB
```

Get host:
```bash
az postgres flexible-server show \
  --resource-group $RG \
  --name $PG_SERVER \
  --query fullyQualifiedDomainName -o tsv
```

### 5.3 Create ACR and push API image

```bash
az acr create --resource-group $RG --name $ACR --sku Basic
az acr login --name $ACR
```

Build and push API image from repo root:
```bash
docker build -f docker/api/Dockerfile -t $ACR.azurecr.io/transport-api:1.0.0 .
docker push $ACR.azurecr.io/transport-api:1.0.0
```

### 5.4 Create Container Apps environment and API app

```bash
az containerapp env create \
  --name $ACA_ENV \
  --resource-group $RG \
  --location $LOCATION
```

Create API app:
```bash
az containerapp create \
  --name $API_APP \
  --resource-group $RG \
  --environment $ACA_ENV \
  --image $ACR.azurecr.io/transport-api:1.0.0 \
  --target-port 8080 \
  --ingress external \
  --registry-server $ACR.azurecr.io \
  --cpu 0.5 \
  --memory 1Gi
```

Set API environment variables:
```bash
az containerapp update \
  --name $API_APP \
  --resource-group $RG \
  --set-env-vars \
  ASPNETCORE_ENVIRONMENT=Production \
  ASPNETCORE_URLS=http://+:8080 \
  ConnectionStrings__DefaultConnection="Host=<PG_HOST>;Port=5432;Database=transport;Username=<PG_USER>;Password=<PG_PASSWORD>;Ssl Mode=Require;Trust Server Certificate=true" \
  Jwt__Key="<STRONG_JWT_KEY>" \
  Jwt__Issuer=TransportProd \
  Jwt__Audience=TransportClients \
  Cors__Origins__0="https://<YOUR_WEB_DOMAIN>" \
  Cors__Origins__1="https://<YOUR_SECOND_WEB_DOMAIN>"
```

Get API URL:
```bash
az containerapp show \
  --name $API_APP \
  --resource-group $RG \
  --query properties.configuration.ingress.fqdn -o tsv
```

Your API base URL becomes:
`https://<returned-fqdn>`

### 5.5 Deploy web app (Azure Static Web Apps)

Best practice: deploy `apps/web` via GitHub Actions generated by Azure Static Web Apps.

Steps:
1. Push repository to GitHub.
2. In Azure Portal, create **Static Web App**.
3. Link GitHub repo and branch.
4. Configure:
   - App location: `apps/web`
   - Build command: `npm run build`
   - Output location: `dist`
5. In Static Web App configuration, set build environment variables:
   - `VITE_API_URL=https://<API_FQDN>`
   - `VITE_SIGNALR_URL=https://<API_FQDN>`
   - `VITE_GOOGLE_MAPS_API_KEY=<OPTIONAL_FALLBACK_KEY>`
6. Redeploy.

After first deploy, set the primary Google Maps key in app DB (admin only):
1. Login as `admin`
2. Open **Configuration** page (`/configuration`)
3. Save **Google Maps API key**

Notes:
- The live map now fetches key at runtime from `GET /api/tracking/map-settings`.
- Changing key from admin panel takes effect after page refresh (no web rebuild required).
- If DB key is empty/unavailable, the web falls back to `VITE_GOOGLE_MAPS_API_KEY`.

### 5.6 Custom domain + HTTPS

For both API and web:
- Add custom domain in Azure service settings
- Add required DNS records at your domain provider
- Wait for certificate provisioning (managed TLS)

After DNS:
- `https://api.yourdomain.com/health` should return healthy response
- web should load and authenticate against API

---

## 6) If Azure free/trial is not enough (free alternatives)

### Option A (popular low-cost/free stack)
- API: Render Web Service (Docker deploy from repo)
- DB: Render PostgreSQL
- Web: Vercel (from `apps/web`)
- Mobile: Expo EAS

### Option B
- API + DB: Railway
- Web: Netlify or Vercel

### Option C
- API: Fly.io
- DB: Supabase PostgreSQL
- Web: Netlify/Vercel

### Environment variable mapping (same across hosts)
Always set these in provider dashboards:
- API service:
  - `ASPNETCORE_ENVIRONMENT=Production`
  - `ConnectionStrings__DefaultConnection=...`
  - `Jwt__Key`, `Jwt__Issuer`, `Jwt__Audience`
  - `Cors__Origins__0=https://<web-domain>`
- Web service:
  - `VITE_API_URL=https://<api-domain>`
  - `VITE_SIGNALR_URL=https://<api-domain>`
  - `VITE_GOOGLE_MAPS_API_KEY=<optional-fallback-key>`
- Mobile build:
  - `EXPO_PUBLIC_API_URL=https://<api-domain>`

---

## 7) Mobile deployment (Expo EAS) from scratch

Your `mobile` Docker service is for development only. Production mobile is delivered as app builds.

### 7.1 Configure EAS

From repo root:
```bash
cd apps/mobile
npm install
eas login
eas init
```

Set mobile public API:
```bash
# PowerShell
$env:EXPO_PUBLIC_API_URL="https://api.yourdomain.com"
```

Or define in `eas.json`/project env for build profiles.

### 7.2 Android build

```bash
eas build --platform android --profile preview
```

For Play Store release:
```bash
eas build --platform android --profile production
```

### 7.3 iOS build (macOS/Apple account required)

```bash
eas build --platform ios --profile production
```

### 7.4 Internal distribution

```bash
eas submit --platform android
```

(and iOS submit when ready)

Important:
- Every build must point to your production API URL
- Test login, tracking, and SignalR features on real devices

---

## 8) Validation checklist after deployment

### API checks
- `GET /health` returns success
- Swagger loads (if enabled in production)
- Login works for admin/staff/driver
- JWT-protected endpoints return 401 without token, 200 with valid token

### Functional checks
- Create product
- Load trip
- Driver location update
- Unload trip
- Deliver product
- Branch collection report
- Admin can update Google Maps key in Configuration page and map loads with the updated key

### Realtime checks
- SignalR events arrive in web/mobile when driver updates location

### CORS checks
- Browser requests from your web domain succeed
- Unknown origins are blocked

---

## 9) Hardening checklist (must-do)

- Change all seeded user passwords immediately
- Keep only production CORS origins
- Disable any Development-only behavior in API config
- Enforce HTTPS redirect and secure headers
- Restrict PostgreSQL firewall/network access
- Enable database backups and verify restore process
- Enable app logs and alerts (error rate, restart count, high latency)
- Rotate JWT key and DB password on a schedule

---

## 10) Operations runbook (day-2)

### Deploy new API version
1. Build and push new image tag (`1.0.1`)
2. Update Container App image to new tag
3. Validate `/health` and smoke tests

Example:
```bash
docker build -f docker/api/Dockerfile -t $ACR.azurecr.io/transport-api:1.0.1 .
docker push $ACR.azurecr.io/transport-api:1.0.1
az containerapp update --name $API_APP --resource-group $RG --image $ACR.azurecr.io/transport-api:1.0.1
```

### Rollback
If new release fails:
1. Re-point Container App to previous stable image tag
2. Restart app
3. Re-run health + critical smoke tests

### Backups
- Keep automated PostgreSQL backups enabled
- Before major schema changes, take on-demand backup/snapshot
- Document last known good restore point

---

## 11) Common issues and fixes

### Issue: Web cannot call API (CORS)
- Ensure API has exact web URL in `Cors__Origins__*`
- Confirm frontend uses `https://` API URL

### Issue: API fails to start due to DB connection
- Verify host, username, password, SSL mode
- Ensure PostgreSQL firewall/network allows API service

### Issue: Mobile app points to localhost
- Set `EXPO_PUBLIC_API_URL` to public API domain
- Rebuild app with EAS after env change

### Issue: SignalR not connecting
- Confirm `VITE_SIGNALR_URL` points to API domain
- Validate reverse proxy / ingress supports websockets (Container Apps does)

---

## 12) Minimal cost strategy (recommended order)

1. Start on Azure trial credits.
2. Keep API small (`0.5 CPU`, `1Gi`) and Burstable PostgreSQL.
3. If costs increase, move web to Vercel and optionally move API/DB to Render/Railway.
4. Keep same env variable schema to migrate quickly.

This lets you go live quickly, stay mostly free/low-cost early, and scale later.
