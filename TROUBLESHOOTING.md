# Troubleshooting Guide

## API Issues

### API won't start
- Ensure PostgreSQL is running: `docker compose up -d postgres`
- Ensure all env vars are set: see .env.example
- Run migrations: `cd api && npx drizzle-kit push`

### Database connection failed
- Check DATABASE_URL in .env
- Ensure PostgreSQL accepts connections: `psql $DATABASE_URL`
- Check firewall/security group rules

### "JWT verification failed"
- Token expired (max 15 min for access tokens)
- Use the refresh token endpoint: POST /api/auth/refresh
- Log in again: POST /api/auth/login

## Keeper Issues

### Keeper won't start
- Ensure KEEPER_PRIVATE_KEY is set (base64-encoded Ed25519 key)
- Check SUI_RPC_URL is reachable: `curl $SUI_RPC_URL`
- Ensure database is accessible

### "Circuit breaker open" in logs
- Sui RPC is failing repeatedly
- Check RPC endpoint health
- Circuit auto-closes after 30 seconds

### "No vaults found" / Keeper idle
- Ensure vaults exist on chain
- Check PACKAGE_ID matches deployed contract
- Verify vaults have `active: true` policy

### Leader election errors
- Multiple keepers competing? That's normal
- Check `leader_locks` table in PostgreSQL
- Verify DATABASE_URL is correct

## CLI Issues

### "Auth failed — try logging in again"
- Token expired. Run: `walwatch login`
- Token file permissions wrong: `chmod 600 ~/.walwatch/config.json`

### "API is unreachable"
- Check API server is running
- Check API URL in config: `walwatch config get apiUrl`
- Default: http://localhost:3001

## Contract Issues

### "Package not found"
- Ensure PACKAGE_ID in .env matches a deployed package
- Deploy: `cd contracts && sui client publish --gas-budget 100000000`

### Transaction fails
- Check Sui explorer for error details
- Ensure gas budget is sufficient
- Verify wallet has enough SUI

## Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| VALIDATION_ERROR | Invalid input | Check request body against API docs |
| AUTH_ERROR | Missing/invalid auth | Re-login or check API key |
| NOT_FOUND | Resource doesn't exist | Check IDs are correct |
| FORBIDDEN | Insufficient permissions | Check RBAC role |
| RATE_LIMITED | Too many requests | Wait and retry |
| PAYLOAD_TOO_LARGE | Request too big | Reduce payload size |
| INTERNAL_ERROR | Server error | Check server logs (search request ID) |
