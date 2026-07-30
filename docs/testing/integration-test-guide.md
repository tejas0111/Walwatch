# Integration Testing Guide

## Prerequisites
- Running PostgreSQL (via Docker Compose)
- Sui testnet access
- Valid package deployment

## Test Environment Setup
1. Start dependencies: `docker compose up -d`
2. Deploy contracts: `cd contracts && sui client publish --gas-budget 100000000`
3. Note the published package ID
4. Set environment variables (see .env.example)

## Running Integration Tests

### API Integration Tests
```bash
cd api
# Tests use Testcontainers for Postgres
npx vitest run --config vitest.integration.ts
```

### Keeper Integration Tests
```bash
cd keeper
# Requires Sui testnet RPC
SUI_RPC_URL=https://fullnode.testnet.sui.io npx vitest run
```

### Full System Test
```bash
# 1. Start all services
docker compose --profile keeper up -d

# 2. Run health checks
curl http://localhost:3001/health
curl http://localhost:9090/health

# 3. Create test user
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test123!","name":"Test User"}'

# 4. Verify keeper is scanning
docker compose logs keeper
```

## Cleanup
```bash
docker compose down -v
```
