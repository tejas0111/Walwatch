# WalWatch Deployment Runbook

## Overview

This document describes how to deploy all components of the WalWatch auto-renewal
system across environments. The system consists of:

| Component | Location | Description |
|-----------|----------|-------------|
| **Move Contract** | `contracts/` | Sui Move smart contract (`auto_renewal::vault`) |
| **REST API** | `api/` | Hono + Drizzle + PostgreSQL backend |
| **Keeper** | `keeper/` | Background worker (scanner + executor) |
| **Frontend** | `ui/` | Next.js web application |
| **Infrastructure** | `infra/` | Terraform (AWS ECS, RDS, ALB) |

## Prerequisites

```bash
# Required tools
sui          >= 1.45    (for contract deployment)
docker       >= 24
terraform    >= 1.5
aws          >= 2.0     (for AWS deployments)
jq           >= 1.6
node         >= 20      (for local dev)
pnpm         >= 9       (recommended package manager)
```

## Environment Setup

### 1. Configure Sui CLI

```bash
# Add the target network
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
sui client switch --env testnet

# Create or import a funded address
sui client new-address ed25519
# OR: sui client import   # (use interactive prompt — do NOT pass seed phrase as CLI arg)

# Verify
sui client active-address
sui client gas
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values (see .env.example for documentation)
```

## Local Development Deployment

For local development with Docker Compose:

```bash
# 1. Start PostgreSQL + dependencies
docker compose up -d postgres

# 2. Run database migrations
cd api && DATABASE_URL=postgres://walwatch:walwatch_dev@localhost:5432/walwatch npx drizzle-kit push

# 3. Start API (development mode)
cd api && pnpm dev

# 4. Start Keeper (separate terminal)
cd keeper && pnpm dev

# 5. Start UI (separate terminal)
cd ui && pnpm dev
```

Or run everything together:

```bash
export KEEPER_PRIVATE_KEY="<base64-key>"
docker compose --profile keeper up -d
```

## Testnet Deployment

### Step 1: Deploy the Move Contract

```bash
# Deploy the smart contract to Sui testnet
./scripts/deploy.sh testnet contract
```

**Expected output:**
```
Package ID:     0x...
FeeConfig ID:   0x...
AdminCap ID:    0x...
```

After deployment, **the FeeConfig treasury must be configured** using the AdminCap.
All admin operations go through a timelock (`AdminTimelock` shared object) — first
schedule, then execute after the delay (default 1 epoch ~24h on mainnet):

```bash
# Schedule treasury change
sui client call \
  --package <PACKAGE_ID> \
  --module vault \
  --function schedule_admin_action \
  --args <ADMIN_CAP_ID> <TIMELOCK_ID> 1 0 <TREASURY_ADDRESS> \
  --gas-budget 10000000

# Execute treasury change (after 1 epoch delay)
sui client call \
  --package <PACKAGE_ID> \
  --module vault \
  --function execute_admin_action \
  --args <TIMELOCK_ID> <FEE_CONFIG_ID> \
  --gas-budget 10000000
```

Optional — adjust fees (action types: 1=treasury, 2=fee_bps, 3=keeper_fee, 4=storage_price):

```bash
# Schedule protocol fee change (200 = 2%)
sui client call ... --function schedule_admin_action --args <ADMIN_CAP_ID> <TIMELOCK_ID> 2 200 0x0

# Schedule keeper fee change (1_000_000 MIST)
sui client call ... --function schedule_admin_action --args <ADMIN_CAP_ID> <TIMELOCK_ID> 3 1000000 0x0

# Execute pending action (anyone can call after delay)
sui client call ... --function execute_admin_action --args <TIMELOCK_ID> <FEE_CONFIG_ID>
```

### Step 2: Deploy Infrastructure

```bash
# Apply Terraform
./scripts/deploy.sh testnet infra
```

### Step 3: Deploy Backend

```bash
# Build and push Docker images, update ECS
./scripts/deploy.sh testnet backend
```

### Step 4: Run Database Migrations

```bash
export DATABASE_URL="<from-terraform-or-secrets-manager>"
./scripts/deploy.sh testnet db
```

## Mainnet Deployment

Follow the same steps as testnet but substitute `testnet` → `mainnet`:

```bash
./scripts/deploy.sh mainnet all
```

**Critical differences on mainnet:**
- SUI gas costs are real — ensure the deployer address has sufficient SUI
- WAL has real market value — test thoroughly on testnet first
- Set `SUI_RPC_URLS` to multiple reliable RPC providers for redundancy
- Configure notification channels (email, webhook) before going live
- Verify FeeConfig treasury is set to a multisig or secure address

## Post-Deployment Verification

### Contract

```bash
# Verify the package is published
sui client object <PACKAGE_ID>

# Verify FeeConfig exists and treasury is set
sui client object <FEE_CONFIG_ID>

# Check AdminCap owner
sui client object <ADMIN_CAP_ID>
```

### API

```bash
# Health check
curl https://<api-domain>/api/health

# Expected: {"status":"ok","db":"connected","suiRpc":"connected",...}
```

### Keeper

```bash
# Check metrics (if Prometheus scraping is configured)
curl http://<keeper-metrics-url>/metrics

# Check health
curl http://<keeper-metrics-url>/health

# Check logs (CloudWatch)
aws logs tail /ecs/walwatch-keeper --follow
```

### End-to-End Test

```bash
# Requires a funded testnet wallet
export SUI_PRIVATE_KEY="<base64-key>"
export PACKAGE_ID="<deployed-package-id>"
export FEE_CONFIG_ID="<deployed-fee-config-id>"

node scripts/e2e-test.mjs
```

## Upgrade Procedure

### Contract Upgrade

The Move contract supports upgrades via the `UpgradeCap` (see `Published.toml`):

```bash
cd contracts

# 1. Make changes to contract code
# 2. Build with upgrade compatibility
sui move build --edition 2024

# 3. Publish upgrade
sui client upgrade \
  --upgrade-capability <UPGRADE_CAP_ID> \
  --gas-budget 50000000 \
  --json
```

**Upgrade compatibility rules:**
- Public struct fields CANNOT be added/removed/reordered
- Public functions CAN be added but signatures CANNOT be removed
- `init()` is NOT re-run on upgrade (use migration functions)
- See [Sui Upgrade Docs](https://docs.sui.io/concepts/versioning) for details

### Database Migration

```bash
cd api
DATABASE_URL="..." npx drizzle-kit push
```

Drizzle Kit auto-generates migrations from schema changes. Review before applying:

```bash
DATABASE_URL="..." npx drizzle-kit generate
# Review generated SQL in api/drizzle/
DATABASE_URL="..." npx drizzle-kit migrate
```

## Disaster Recovery

### Scenario: Keeper Wallet Runs Out of Gas

1. Send SUI to the keeper's gas wallet address
2. The keeper will automatically resume on the next scan cycle (every 2 min)
3. To expedite: restart the keeper task

Prevention: Set up `KeeperGasBalance` CloudWatch alarm (configured in Terraform).

### Scenario: FeeConfig Treasury is @0x0

If treasury is not set, `execute_renewal` will abort with `ETreasuryNotSet` (error code 7).

Fix (via timelock):
```bash
# Schedule
sui client call --package <PACKAGE_ID> --module vault \
  --function schedule_admin_action \
  --args <ADMIN_CAP_ID> <TIMELOCK_ID> 1 0 <TREASURY_ADDRESS> \
  --gas-budget 10000000
# Execute (after delay)
sui client call --package <PACKAGE_ID> --module vault \
  --function execute_admin_action \
  --args <TIMELOCK_ID> <FEE_CONFIG_ID> \
  --gas-budget 10000000
```

### Scenario: RPC Endpoint Down

The keeper uses `SUI_RPC_URLS` (comma-separated) for multi-endpoint failover.
If all configured endpoints fail, the circuit breaker opens and stops making
requests for 30 seconds (configurable via `CIRCUIT_BREAKER_TIMEOUT`).

**To recover:**
1. Identify which endpoints are failing
2. Update `SUI_RPC_URLS` to remove failed endpoints
3. Restart the keeper (or wait for circuit breaker timeout)

### Scenario: Database Corruption

1. Restore from latest RDS snapshot:
```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier walwatch-restored \
  --db-snapshot-identifier walwatch-final-<DATE>
```
2. Verify data integrity
3. Point keeper/API to restored instance
4. Take application offline during restore

### Scenario: Contract Upgrade Breaks Backend

If a contract upgrade changes the expected types/shapes:

1. Rollback: Re-deploy the previous version from `Published.toml`
2. Or: Update backend env vars to point to a new package ID (parallel deployment)
3. The keeper and API check `PACKAGE_ID` environment variable

## Maintenance

### Backup Verification

```bash
# List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier walwatch \
  --query 'DBSnapshots[].DBSnapshotIdentifier'
```

### Log Rotation

Logs are shipped to CloudWatch Logs with the following retention:
- API: 30 days
- Keeper: 30 days
- Access logs: 90 days

### Metrics

Key metrics to monitor (available at `/metrics`):

| Metric | Description | Warning | Critical |
|--------|-------------|---------|----------|
| `walwatch_keeper_circuit_breaker_state` | 0=CLOSED, 1=HALF_OPEN, 2=OPEN | 1 | 2 |
| `walwatch_keeper_renewals_failed` | Consecutive renewal failures | >5/cycle | >20/cycle |
| `walwatch_keeper_queue_depth` | Vaults due for renewal | >50 | >200 |
| `walwatch_api_request_duration_ms` | API latency p99 | >500ms | >2000ms |
| `walwatch_rds_connections` | DB connection count | >50 | >100 |

## Architecture Diagram

```
                    ┌──────────────┐
                    │   Sui RPC    │
                    │  (multiple)  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
         │Scanner │  │Executor│  │  API   │
         │(keeper)│  │(keeper)│  │(Hono)  │
         └────┬───┘  └────┬───┘  └───┬────┘
              │            │          │
              └─────┬──────┘          │
                    │                 │
              ┌─────▼─────┐    ┌──────▼──────┐
              │ PostgreSQL │    │  PostgreSQL │
              │(leader     │    │  (app data) │
              │ election)  │    │             │
              └───────────┘    └─────────────┘

Leader Election: PG advisory lock ensures only one keeper runs
RPC Failover:   SuiClientPool with per-URL circuit breakers
Concurrency:    Bounded parallel renewal execution (default: 5)
```
