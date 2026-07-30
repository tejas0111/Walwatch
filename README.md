# WalWatch

Automated Walrus blob renewal platform — sign once, renew forever.

## Architecture

```
┌──────────┐      ┌──────┐      ┌──────────┐
│  UI      │─────▶│ API  │─────▶│ Postgres │
│ (Next.js)│      │(Hono)│      │    16    │
└──────────┘      └──┬───┘      └──────────┘
                     │
                     │ reads vaults
                     ▼
               ┌──────────┐      ┌──────────┐
               │  Keeper  │─────▶│   Sui    │
               │ (worker) │      │ Testnet  │
               └──────────┘      └──────────┘
```

| Service | Description | Port |
|---------|-------------|------|
| **API** | REST API — vault CRUD, auth, transaction building | 3001 |
| **Keeper** | Background worker — scans and executes renewals | — |
| **UI** | Next.js dashboard for managing vaults | 3000 |
| **Postgres** | Persistent state for vaults and auth | 5432 |
| **Contracts** | Move smart contracts for on-chain vault logic | — |

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use Docker)
- Docker & Docker Compose (optional, for one-command startup)
- Sui CLI (for contract deployment)

## Quick Start

```bash
docker compose up --build
```

This starts Postgres, API, and UI. The keeper is opt-in:

```bash
docker compose --profile keeper up --build
```

## Manual Setup

### Database

```bash
docker run -d --name walwatch-pg \
  -e POSTGRES_DB=walwatch \
  -e POSTGRES_USER=walwatch \
  -e POSTGRES_PASSWORD=walwatch_dev \
  -p 5432:5432 \
  postgres:16-alpine
```

### API

```bash
cd api
cp ../.env.example .env   # edit with your values
npm install
npm run dev                # http://localhost:3001
```

### Keeper

```bash
cd keeper
cp ../.env.example .env   # edit with your values
npm install
npm run dev
```

### UI

```bash
cd ui
npm install
npm run dev                # http://localhost:3000
```

### Contracts

```bash
cd contracts
sui move build
sui move test
sui client publish --gas-budget 100000000
```

## Environment Variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `DATABASE_URL` | API, Keeper | `postgres://postgres:postgres@localhost:5432/walwatch` | PostgreSQL connection string |
| `JWT_SECRET` | API | `dev-secret-change-in-production` | Secret for JWT signing |
| `JWT_EXPIRES_IN` | API | `7d` | JWT token lifetime |
| `PORT` | API | `3001` | API listen port |
| `SUI_RPC_URL` | API, Keeper | `https://fullnode.testnet.sui.io:443` | Sui RPC endpoint |
| `PACKAGE_ID` | API, Keeper | — | Deployed Move package ID |
| `SYSTEM_OBJECT_ID` | API, Keeper | — | Walrus System shared object ID |
| `WAL_COIN_TYPE` | API | — | WAL coin type (optional) |
| `ALLOWED_ORIGINS` | API | `http://localhost:3000,http://localhost:5173` | Comma-separated CORS origins |
| `REQUEST_SIZE_LIMIT` | API | `1mb` | Max request body size |
| `KEEPER_HEALTH_URL` | API | — | URL to check keeper health |
| `KEEPER_PRIVATE_KEY` | Keeper | — | Ed25519 private key (base64, 64-byte) |
| `SCAN_SCHEDULE` | Keeper | `*/2 * * * *` | Cron schedule for vault scanning |
| `MAX_VAULTS_PER_CYCLE` | Keeper | `50` | Max vaults per scan cycle |
| `RETRY_DELAY_MS` | Keeper | `5000` | Delay between retries |
| `ENABLE_LEADER_ELECTION` | Keeper | `false` | Use PG advisory locks for leader election |
| `ENABLE_EVENT_FALLBACK` | Keeper | `false` | Use event queries when object queries fail |
| `NOTIFICATION_EMAIL` | Keeper | — | Email for alerts |
| `NOTIFICATION_WEBHOOK_URL` | Keeper | — | Webhook URL for alerts |
| `NOTIFICATION_WEBHOOK_SECRET` | Keeper | — | HMAC secret for webhook signing |
| `RESEND_API_KEY` | Keeper | — | Resend API key for email delivery |
| `NOTIFICATION_FROM_EMAIL` | Keeper | `alerts@autorenewal.app` | Sender email for Resend |
| `VITE_SUI_RPC_URL` | UI | `https://fullnode.testnet.sui.io:443` | Sui RPC for frontend |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript / build UI |
| `npm run start` | Start production server |
| `npm run test` | Run test suite |
| `npm run lint` | Run linter |

Each service (api, keeper, ui) has its own `package.json` — run commands from within the respective directory.

## Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution guidelines
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — common issues and fixes
- [docs/](./docs/) — architecture decision records, deployment guides, runbooks
- [spec.md](./spec.md) — full technical specification
