# Disaster Recovery Guide

## Recovery Point Objective (RPO): 5 minutes
## Recovery Time Objective (RTO): 30 minutes

## Failure Scenarios

### 1. Database Failure

**Symptoms:** API returns 500s, health check shows DB as unhealthy, keeper can't acquire leader lock.

**Impact:** Complete service outage for API and keeper.

**Recovery:**
1. Verify RDS status in AWS Console
2. If Multi-AZ, failover should be automatic (~1-2 min)
3. If single-AZ failure:
   ```bash
   # Restore from latest automated snapshot
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier walwatch-restored \
     --db-snapshot-identifier $(aws rds describe-db-snapshots \
       --db-instance wal-watch --query 'sort_by(DBSnapshots,&SnapshotCreateTime)[-1].DBSnapshotIdentifier' \
       --output text)
   ```
4. Update DATABASE_URL in ECS task definitions to point to restored instance
5. Force new deployment:
   ```bash
   aws ecs update-service --cluster walwatch --service api --force-new-deployment
   aws ecs update-service --cluster walwatch --service keeper --force-new-deployment
   ```

**Prevention:**
- Enable Multi-AZ deployment
- Enable automated backups (7-day retention)
- Set RDS backup window during low-traffic hours

### 2. Keeper Failure

**Symptoms:** No renewals being executed, circuit breaker logs, leader election timeouts.

**Impact:** Blobs may not be renewed on schedule (permissionless design mitigates — anyone can call execute_renewal).

**Recovery:**
1. Check ECS service events: `aws ecs describe-services --cluster walwatch --services keeper`
2. Check task logs: `aws logs get-log-events --log-group /ecs/keeper --log-stream-name $(aws logs describe-log-streams --log-group /ecs/keeper --query 'logStreams[-1].logStreamName' --output text)`
3. If out of gas: fund keeper wallet with SUI
4. If circuit breaker open: wait for automatic retry (30s timeout)
5. Force restart: `aws ecs update-service --cluster walwatch --service keeper --force-new-deployment`

**Prevention:**
- Run 2+ keeper instances (leader election ensures one active)
- Monitor gas balance with CloudWatch alarm
- Set up auto-scaling (CPU > 70%)

### 3. API Failure

**Symptoms:** UI shows errors, CLI returns "API unreachable", health check fails.

**Impact:** Users can't manage vaults, create new vaults, or view dashboard.

**Recovery:**
1. Check ALB target group health: `aws elbv2 describe-target-health --target-group-arn $TG_ARN`
2. Check ECS service events
3. Check application logs for errors
4. Force restart: `aws ecs update-service --cluster walwatch --service api --force-new-deployment`

**Prevention:**
- Run 2+ API tasks behind ALB
- Auto-scaling based on CPU/memory
- Health check ensures only healthy targets receive traffic

### 4. Full Region Failure

**Impact:** Complete service outage.

**Recovery:**
1. Deploy infrastructure to secondary region using Terraform
2. Restore RDS from cross-region snapshot
3. Update DNS to point to secondary region ALB
4. Redeploy keeper contract pointers if needed

**Prevention:**
- Store Terraform state in S3 with cross-region replication
- Document disaster recovery runbook (this file)
- Practice recovery quarterly

## Backup Verification

```bash
# List available snapshots
aws rds describe-db-snapshots --db-instance wal-watch

# Verify snapshot is restorable
aws rds restore-db-instance-from-db-snapshot --db-instance-identifier walwatch-verify --db-snapshot-identifier $SNAPSHOT_ID --no-cli-pager

# Test the restored instance (then delete it)
aws rds delete-db-instance --db-instance-identifier walwatch-verify --skip-final-snapshot
```
