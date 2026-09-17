# Production deploy (VPS + Docker Compose + Caddy)

Deploy path: `/opt/agnyusha`.

- **Non-secrets** (domain, URLs, `MAIL_FROM`, provider IDs, …) live in `deploy/.env.example` and are applied to server `.env` on each API deploy.
- **Secrets** come only from GitHub Actions repository secrets.
- Compose still hardcodes `NODE_ENV`, `PORT`, and image pull names.

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
| `SENTRY_DSN` |

No repository **Variables** required.

Change domain / `MAIL_FROM` / tariffs in `deploy/.env.example`, push to `main`.  
Web build uses hardcoded `NEXT_PUBLIC_SITE_URL=https://agnyusha.ru` in its workflow.  
Also add Google OAuth redirect URI `https://agnyusha.ru/api/auth/google/callback`.
