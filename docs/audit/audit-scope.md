# Walwatch — Smart Contract Audit Scope

## Overview
- **Project:** Walwatch — Auto-renewal for Walrus blob storage
- **Audit Target:** `contracts/sources/vault.move`
- **Language:** Sui Move (edition 2024.beta)
- **Package:** `auto_renewal::vault`
- **Lines of Code:** ~550
- **Dependencies:** walrus (testnet-v1.45.2), wal (testnet-v1.45.2)
- **Deployed:** Sui testnet at `0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7`

## Scope
### In Scope
- `auto_renewal::vault` — Complete module (all entry functions, view functions, structs, events)
- Access control for all admin functions (AdminCap pattern)
- Economic parameters (fees, storage pricing)
- Re-entrancy and flash loan considerations
- Integer overflow/underflow in fee calculations
- Object ownership and transfer safety
- Blob custody lifecycle (deposit → renew → reclaim)
- Event emission correctness

### Out of Scope
- Off-chain keeper (separate codebase, different risk profile)
- API server
- UI components
- Walrus system contracts (third-party dependency)
- WAL token contract (third-party dependency)

## Key Attack Vectors to Review
1. FeeConfig access control — can non-admin change fees?
2. estimate_renewal_cost — is the storage price oracle manipulation-resistant?
3. execute_renewal — can it be called on non-due blobs?
4. Vault custody — can blob be extracted by non-beneficiary?
5. Policy cap exhaustion — correct handling of max_total_epochs?
6. Balance management — dust accumulation, precision loss
7. Permissionless executor — griefing or DoS vectors

## Testing Coverage
- 15 unit tests (FeeConfig, vault operations, authorization)
- Tests cover: creation, deposit, withdraw, reclaim, policy updates, renewal authorization
- Remaining: 6 integration tests requiring Walrus System object (blocked on CI CPU arch)

## Suggested Auditors
- OtterSec (Sui-focused)
- MoveBit
- Zellic
