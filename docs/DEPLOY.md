# Deployment Guide — VPS + `ask.ftrhq.my.id`

Single-subdomain deployment: **Caddy** reverse-proxies one HTTPS host, serving the
Next.js frontend at `/` and the FastAPI backend under `/api` (prefix stripped).
Caddy obtains and renews the Let's Encrypt certificate automatically. Only ports
80/443 are exposed; Postgres, Redis, the MCP server and the worker stay on the
internal Docker network.

```
Internet ──► :443 Caddy (ask.ftrhq.my.id)
                 ├── /api/*  ──► backend:8000   (SSE, /api stripped)
                 └── /*      ──► frontend:3000
        (postgres, redis, mcp-server, worker: internal only)
```

## 1. DNS

Point the subdomain at your VPS public IP (find it with `curl ifconfig.me`):

| Type | Name  | Value            |
|------|-------|------------------|
| A    | `ask` | `<YOUR_VPS_IP>`  |

`ask.ftrhq.my.id` → the VPS. (Add an `AAAA` record too if you have IPv6.)
Wait for it to resolve: `dig +short ask.ftrhq.my.id`.

## 2. Server prerequisites

- A VPS with Docker Engine + Docker Compose plugin installed.
- Firewall allows inbound **80** and **443** (80 is required for the ACME challenge).
  ```bash
  sudo ufw allow 80,443/tcp
  ```

## 3. Deploy

```bash
git clone <your-repo-url> knowledge-assistant-platform
cd knowledge-assistant-platform

cp .env.prod.example .env
nano .env          # set DOMAIN, ACME_EMAIL, strong POSTGRES_PASSWORD,
                   # OPENAI_API_KEY, TAVILY_API_KEY, APP_PASSWORD, AUTH_SECRET
                   # tip: openssl rand -hex 32   → good AUTH_SECRET / DB password

docker compose -f docker-compose.yaml -f docker-compose.prod.yml up -d --build
```

First boot takes a minute (image builds + certificate issuance). Then visit
**https://ask.ftrhq.my.id** — log in with `APP_PASSWORD`.

## 4. Verify

```bash
docker compose -f docker-compose.yaml -f docker-compose.prod.yml ps
curl -sS https://ask.ftrhq.my.id/api/health        # {"status":"ok",...}
docker compose -f docker-compose.yaml -f docker-compose.prod.yml logs -f caddy
```

## 5. Update / rollback

```bash
git pull
docker compose -f docker-compose.yaml -f docker-compose.prod.yml up -d --build
```

## Notes

- **SSE streaming:** Caddy proxies with `flush_interval -1`, so chat tokens stream
  without buffering.
- **No CORS needed:** the browser only ever calls the same origin
  (`https://ask.ftrhq.my.id/api/...`), which Caddy forwards internally.
- **Secrets:** `.env` is git-ignored — never commit real keys. Rotate `AUTH_SECRET`
  to invalidate all existing sessions.
- **Switching domains:** everything is driven by `DOMAIN` in `.env`; no code changes
  needed because the frontend calls the relative `/api` path.
```
