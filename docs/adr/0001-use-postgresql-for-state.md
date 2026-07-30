# ADR 0001: Use PostgreSQL for Application State

**Date:** 2026-07-23  
**Status:** Accepted

## Context
WalWatch needs persistent storage for user accounts, organizations, vault registrations, blob metadata, and audit logs.

## Decision
Use PostgreSQL as the primary data store, accessed via Drizzle ORM.

## Consequences
- ✅ Transactional integrity for billing and audit operations
- ✅ Rich query capability for analytics
- ✅ Drizzle ORM prevents SQL injection
- ❌ Manual schema migrations required on deploy
- ❌ Connection pooling needed for serverless compatibility
