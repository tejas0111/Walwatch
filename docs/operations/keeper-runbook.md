# Keeper Runbook

## Normal Operation

The keeper runs on a cron schedule defined in `keeper/src/index.ts`:
- Default interval: 60 seconds
- Each cycle: scan due vaults → execute renewals → notify on events

## Health Indicators

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Last successful scan | < 2 min ago | 2-5 min ago | > 5 min ago |
| Renewal success rate | > 95% | 80-95% | < 80% |
| Circuit breaker state | CLOSED | — | OPEN |
| Queue depth | < 10 | 10-50 | > 50 |
| Keeper wallet balance | > 10 SUI | 1-10 SUI | < 1 SUI |
| Leader status | IS_LEADER | — | NOT_LEADER (if expected) |

## Common Failures

### Circuit Breaker OPEN
**Symptom:** `circuit-breaker.ts` logs "Circuit state: OPEN"
**Cause:** 5+ consecutive Sui RPC failures
**Action:** Check Sui RPC endpoint, wait for automatic half-open (30s)

### Leader Election Lost
**Symptom:** "Leader election lost" in logs
**Cause:** Another keeper instance acquired the lock
**Action:** None — this is normal for redundant keepers

### Insufficient Balance Events
**Symptom:** `InsufficientBalance` events emitted
**Cause:** Vault WAL balance too low for renewal
**Action:** Notify vault beneficiary to top up

### RPC Rate Limited
**Symptom:** HTTP 429 from Sui RPC
**Cause:** Exceeded RPC provider rate limit
**Action:** Circuit breaker opens automatically, retries with backoff

## Logs

```bash
# View keeper logs (CloudWatch)
aws logs tail /ecs/keeper --follow

# View keeper logs (local dev)
docker compose --profile keeper logs -f keeper

# Search for errors
aws logs filter-log-events \
  --log-group-name /ecs/keeper \
  --filter-pattern 'ERROR' \
  --start-time $(date -d '1 hour ago' +%s)000
```

## Manual Recovery

If the keeper is stuck and needs manual intervention:

1. Check if leader lock is stuck:
   ```sql
   SELECT * FROM leader_locks WHERE acquired_at < NOW() - INTERVAL '5 minutes';
   ```

2. Release stuck lock:
   ```sql
   DELETE FROM leader_locks WHERE lock_id = 'keeper-leader' AND acquired_at < NOW() - INTERVAL '5 minutes';
   ```

3. Restart keeper:
   ```bash
   aws ecs update-service --cluster walwatch --service keeper --force-new-deployment
   ```

4. Force a scan cycle (keeper admin endpoint — if available)

## Emergency Procedures

### Keeper Private Key Compromised
1. Revoke old key: `sui keytool delete $ADDRESS`
2. Generate new key: `sui client new-address ed25519`
3. Fund new address with SUI gas
4. Update KEEPER_PRIVATE_KEY in AWS Secrets Manager
5. Restart keeper: `aws ecs update-service --cluster walwatch --service keeper --force-new-deployment`

### Complete PostgreSQL Failure
See [disaster-recovery.md](disaster-recovery.md)
