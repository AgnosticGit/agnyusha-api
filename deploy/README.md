# Production deploy (VPS + Docker Compose + Caddy)

Deploy path: `/opt/agnyusha`.

Non-secret config (API URLs, warehouse IDs, `PUBLIC_WEB_URL`, etc.) lives in `deploy/.env.example` / server `.env`.  
GitHub Actions upserts **secrets only**.

## Auto-deploy (push to `main`)

| Repo | Image |
|------|-------|
| `agnyusha-api` | `ghcr.io/agnosticgit/agnyusha-api` |
| `agnyusha-web` | `ghcr.io/agnosticgit/agnyusha-web` |

Settings → Actions → General → Workflow permissions → **Read and write**.

### Repository secrets — both repos

| Name | Notes |
|------|--------|
| `SSH_HOST` | `89.111.171.128` |
| `SSH_USER` | `root` |
| `SSH_KEY` | private key (`~/.ssh/agnyusha_deploy`) |
| `SSH_PORT` | optional (`22`) |
| `GHCR_TOKEN` | PAT with `read:packages` |

### Repository secrets — `agnyusha-api` only

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

No Repository **Variables** required.

When you get a domain: edit `/opt/agnyusha/.env` (`PUBLIC_*`, `CORS_*`, `GOOGLE_CALLBACK_URL`), switch to `Caddyfile.prod`, and change `NEXT_PUBLIC_SITE_URL` in the web workflow build-arg.
