#!/bin/bash
# Manual DB backup trigger
set -euo pipefail

DB_INSTANCE="${1:-wal-watch}"
SNAPSHOT_ID="manual-backup-$(date +%Y-%m-%d-%H%M)"

echo "Creating manual snapshot: $SNAPSHOT_ID"
aws rds create-db-snapshot \
  --db-instance-identifier "$DB_INSTANCE" \
  --db-snapshot-identifier "$SNAPSHOT_ID"

echo "Snapshot initiated. Check status with:"
echo "aws rds describe-db-snapshots --db-snapshot-identifier $SNAPSHOT_ID --query 'DBSnapshots[0].Status'"
