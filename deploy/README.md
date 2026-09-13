# Production deploy (VPS + Docker Compose + Caddy)

Deploy path on the server: `/opt/agnyusha`.

## One-time server setup

1. VPS with Docker + Compose plugin, ports 80/443 open.
2. Copy `deploy/*` to `/opt/agnyusha`, create `.env` from `.env.example`.
3. `docker login ghcr.io` on the server (PAT with `read:packages`).
4. `chmod +x compose-up.sh && ./compose-up.sh`
5. Point DNS A-record when ready; switch `Caddyfile` → `Caddyfile.prod` and set `DOMAIN`.

## Auto-deploy (push to `main`)

| Repo | Image | Workflow |
|------|-------|----------|
| `agnyusha-api` | `ghcr.io/agnosticgit/agnyusha-api` | build + sync deploy + restart |
| `agnyusha-web` | `ghcr.io/agnosticgit/agnyusha-web` | build + restart `web` |

Settings → Actions → General → Workflow permissions → **Read and write** (both repos).

### Secrets — both repos

| Name | Notes |
|------|--------|
| `SSH_HOST` | e.g. `89.111.171.128` |
| `SSH_USER` | `root` |
| `SSH_KEY` | Private key contents (`~/.ssh/agnyusha_deploy`) |
| `SSH_PORT` | Optional, default `22` |
| `GHCR_TOKEN` | PAT with `read:packages` (server pulls images) |

### Secrets — `agnyusha-api` only

| Name |
|------|
| `POSTGRES_PASSWORD` |
| `GOOGLE_CLIENT_SECRET` |
| `RESEND_API_KEY` |
| `CDEK_CLIENT_ID` |
| `CDEK_CLIENT_SECRET` |
| `YANDEX_DELIVERY_TOKEN` |
| `POCHTA_ACCESS_TOKEN` |
| `POCHTA_AUTHORIZATION_KEY` |
| `OZON_PAY_ACCESS_KEY` |
| `OZON_PAY_NOTIFICATION_SECRET` |
| `OZON_DELIVERY_CLIENT_ID` |
| `OZON_DELIVERY_CLIENT_SECRET` |

### Variables — both repos

| Name | Notes |
|------|--------|
| `GHCR_USERNAME` | GitHub username / org that owns packages (e.g. `AgnosticGit`) |

### Variables — `agnyusha-api`

| Name | Example until domain |
|------|----------------------|
| `PUBLIC_WEB_URL` | `http://89.111.171.128` |
| `CORS_ORIGIN` | `http://89.111.171.128` |
| `GOOGLE_CALLBACK_URL` | `http://89.111.171.128/api/auth/google/callback` |
| `GOOGLE_CLIENT_ID` | from Google Cloud |
| `MAIL_FROM` | `Agnyusha <onboarding@resend.dev>` |
| `CDEK_API_URL` | `https://api.cdek.ru` |
| `CDEK_FROM_LOCATION` | warehouse / PVZ code |
| `CDEK_TARIFF_CODE` | `136` |
| `YANDEX_DELIVERY_API_URL` | `https://b2b-authproxy.taxi.yandex.net` |
| `YANDEX_PLATFORM_STATION_ID` | station UUID |
| `POCHTA_API_URL` | `https://otpravka-api.pochta.ru` |
| `POCHTA_FROM_INDEX` | sender index |
| `POCHTA_MAIL_TYPE` | `ONLINE_PARCEL` |
| `OZON_PAY_API_URL` | `https://payapi.ozon.ru/v1` |
| `OZON_DELIVERY_API_URL` | `https://api-delivery.ozon.ru` |
| `OZON_DELIVERY_SHIPMENT_METHOD_ID` | from Ozon cabinet |

### Variables — `agnyusha-web`

| Name | Notes |
|------|--------|
| `SITE_URL` | Public URL baked into Next build (`http://89.111.171.128` until domain) |
