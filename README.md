# Lifetech4Cloud

Lifetech4Cloud is an open-source platform that combines Discord-first authentication, a coin-based VPS marketplace, rewarded ads, and an automated worker fleet for provisioning NVIDIA-powered lab machines. The backend is a production FastAPI stack with PostgreSQL + Redis, the workers are Puppeteer-driven Node services that keep NVIDIA DLI sessions alive, and the UI layer uses a Vite + React dashboard that can be iterated from Lovable.

## Highlights
- **Discord OAuth2 login** with PostgreSQL persistence, signed HttpOnly sessions, health checks, and a minimal test client for quick verification.
- **Coin economy + VPS marketplace** that lets end users buy Linux, Windows, or sandbox VMs while admins manage balances, products, and worker pools.
- **Worker automation tier** (Node.js + Puppeteer + Cloudflared) that logs into NVIDIA DLI, creates VMs, streams logs/RDP credentials, and enforces slot/timer policies entirely server-side.
- **Rewarded ads stack** (Monetag, Google Ad Manager/IMA, nonce-protected claims, Turnstile bot guard, adaptive throttling, Prometheus metrics) to let users earn credits before provisioning a VPS.
- **Support inbox & assistant tooling** featuring Kyaro AI prompts, inbox escalation, and audit trails so operators can close the loop with users.
- **Open governance** via the [Attribution Certificate](CERTIFICATE.md) that keeps reuse possible while guaranteeing credit for the original maintainers.

## Repository Map
| Path | Description |
|------|-------------|
| `backend/` | FastAPI application, Alembic migrations, ads reward logic, admin/user APIs, docs, and the Lovable-generated React frontend (`backend/frontend/`). |
| `backend/generate_vps/` | Legacy Playwright-based VM generator rewritten from Node to Python, useful for migration references or air-gapped deployments. |
| `worker/` | Standalone Node.js worker service (Express + Puppeteer + cloudflared) that authenticates against NVIDIA, spawns Linux/Windows/Dummy sessions, and streams logs. |
| `.github/` | GitHub workflows, issue templates, and metadata for CI/CD. |
| `worker/Workers_Docs.md`, `backend/WORKER_SYSTEM_SUMMARY.md`, `backend/API_USAGE_GUIDE.md` | Deep dives into worker APIs, provisioning flows, and available HTTP endpoints. |

## Architecture Overview
```
Users <-> FastAPI backend <-> PostgreSQL/Redis
          |
      Worker selector ---> Worker servers (Node + Puppeteer + NVIDIA DLI)
          |
     Ads providers / Turnstile / Prometheus
```

- **Backend (FastAPI)** - Handles Discord OAuth2, sessions, coins ledger, rewarded ads, SSE streaming, admin dashboards, and serves static assets from `root-be/`. Alembic migrations run automatically on startup. Rewarded ads support Monetag and Google IMA with nonce issuance, Turnstile verification, SSV checks, and adaptive throttling.
- **Worker fleet (Node.js)** - Each worker exposes `/yud-ranyisi`, `/vm-loso`, `/log/:route`, and `/stop/:route`. Workers keep a `worker-tokens.json`, enforce slot TTLs, and proxy SSH/RDP endpoints via cloudflared tunnels. The backend never exposes worker URLs to clients; it proxies all log and stop requests.
- **Frontend** - A React + Vite dashboard (generated via Lovable) consumes the backend REST + SSE APIs. You can keep using Lovable for AI-assisted edits or run it locally with `npm run dev` inside `backend/frontend/`.

## Quick Start
### Prerequisites
- Docker + Docker Compose (for the FastAPI stack, PostgreSQL, Redis, and worker simulator)
- Python 3.11+ with `pip` if you plan to run the backend outside Docker
- Node.js 20+ for the worker service
- pnpm/npm if you want to iterate on the Lovable frontend locally

### Run the backend
```bash
cp backend/.env.example backend/.env
docker compose -f backend/docker-compose.yml up --build
```
The stack exposes FastAPI on `http://localhost:8000`. Visit `/` for the OAuth test client, `/docs` for the OpenAPI schema, and `/health` for readiness. Environment variables for Discord, ads, Turnstile, Redis, and Postgres are documented in `backend/README.md`.

### Run a worker
```bash
cd worker
npm install
npm run start   # requires Chrome/Chromium for Puppeteer
```
Workers default to port 4000, log in to NVIDIA DLI via Puppeteer, and keep tunnels alive. Use `npm run start:tunnel` if you want the worker and cloudflared tunnel to run side-by-side during local testing.

### Develop the Lovable frontend
```bash
cd backend/frontend
npm install
npm run dev
```
Lovable automatically syncs commits back to this repository, but running it locally gives you full control over Tailwind, shadcn, and the Vite dev server.

## Key Workflows
- **VPS lifecycle** - `POST /vps/purchase-and-create` deducts coins, selects the least-loaded worker, calls `/vm-loso`, persists the worker route, and streams progress via `/vps/sessions/{id}/events`. Deleting a VPS calls `/stop/:route` and releases the token slot.
- **Rewarded ads** - `/ads/prepare` issues signed nonces after Turnstile, `/ads/claim` validates provider payloads (Monetag ticket or GAM SSV), applies throttling, and credits wallets through Redis-backed idempotency locks.
- **Support + AI inbox** - Admins can triage tickets, edit Kyaro AI prompts, and audit assistant actions using the helper scripts and docs under `backend/docs/`.

## Testing & Tooling
- **Backend** - Run `pytest`, `ruff check`, and `mypy .` from `backend/`. Compose files ship a Postgres container so integration tests can run locally. See `backend/API_USAGE_GUIDE.md` for HTTP fixtures.
- **Worker** - Use `npm run dev` plus `curl`ing the `/health`, `/vm-loso`, and `/log/:route` endpoints. The `worker/Workers_Docs.md` file doubles as a contract/integration checklist.
- **Frontend** - Standard Vite workflow: `npm run lint` and `npm run test` (if configured) inside `backend/frontend/`. Lovable deployments can be published from the project dashboard.

## Contributing
1. Fork and clone the repository.
2. Create feature branches targeting `main`.
3. Keep backend typing + linting green and include worker contract tests or recorded logs whenever you change provisioning logic.
4. Document new APIs in `backend/docs/` and update this README if you add/break major flows.
5. Open a pull request; GitHub Actions will run backend tests automatically.

Need support? Check the docs under `backend/docs/` or open a discussion in the repository.

## Attribution Certificate (Required)
This project is distributed under the [Lifetech4Cloud Attribution Certificate v1.0](CERTIFICATE.md). Any redistribution, fork, or commercial deployment **must** include prominent credit to **Lê Hùng Quang Minh** and **Phạm Minh Đức** in end-user documentation, UI footers, and README files, alongside an unmodified copy of the certificate. See the certificate file for the full terms.
