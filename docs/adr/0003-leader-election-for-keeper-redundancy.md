# ADR 0003: Leader Election for Keeper Redundancy

**Date:** 2026-07-23  
**Status:** Accepted

## Context
Multiple keeper instances would conflict if all tried to execute renewals simultaneously.

## Decision
Use PostgreSQL advisory locks for leader election. The leader executes renewals; followers stand by.

## Consequences
- ✅ Simple implementation, no external service needed
- ✅ Automatic failover
- ❌ Single PG point of failure affects leader election
