# Keeper Stress Test Notes

## Methodology
- Deploy keeper to ECS Fargate (1 task, 0.25 vCPU, 512MB RAM)
- Create N vaults with staggered expiry times
- Measure: time to detect due vaults, time to execute renewal, success rate, gas costs

## Expected Throughput
- Single keeper instance: ~50-100 vault renewals per minute
- Bottleneck: Sui RPC rate limits (check RPC provider docs)
- With circuit breaker: automatic backoff under RPC strain

## Key Metrics to Monitor
- Queue depth (pending vaults)
- Renewal latency (time from "due" to "executed")
- Success rate (target: >99%)
- Gas cost per renewal
- Circuit breaker state transitions

## Scale Testing Results
(To be filled after test runs)

| Vaults | Avg Latency | Success Rate | Gas Cost | Notes |
|--------|-------------|--------------|----------|-------|
| 10     | -           | -            | -        | -     |
| 100    | -           | -            | -        | -     |
| 1000   | -           | -            | -        | -     |

## Known Limits
- RPC rate limits: [provider-specific]
- PostgreSQL connection pool: max 20 connections
- ECS task memory: 512MB
