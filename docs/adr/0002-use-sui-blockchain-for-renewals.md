# ADR 0002: Use Sui Blockchain for Vault Renewals

**Date:** 2026-07-23  
**Status:** Accepted

## Context
WalWatch automates blob storage renewal on the Walrus decentralized storage network.

## Decision
Use the Sui blockchain for all vault and blob registration operations. Smart contracts in Move manage fee splitting, policy enforcement, and renewal execution.

## Consequences
- ✅ Permissionless, non-custodial architecture
- ✅ On-chain fee splitting (protocol, keeper, referrer)
- ❌ Dependent on Sui RPC availability
- ❌ Gas costs for keeper operations
