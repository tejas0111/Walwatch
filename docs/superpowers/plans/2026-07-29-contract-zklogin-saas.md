# Move Contract: zkLogin SaaS Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `create_vault` for zero-trust beneficiary model, add `migrate_vault` for package migration, and add `withdraw_delay_epochs` for withdrawal protection — all in the Move contract.

**Architecture:** Three structural changes to `vault.move` (beneficiary parameter, migration function, delay field) plus corresponding test updates. Deploy new package to testnet. Old package remains unchanged — keeper tracks both during migration.

**Tech Stack:** Sui Move, `sui client publish`, BCS-compatible entry functions for TS SDK

## Global Constraints

- PACKAGE_ID is set at deploy time — no on-chain constant, update `.env` files after publish
- `CONTRACT_VERSION` constant must be incremented on each upgrade (currently `1`)
- All new entry functions must be callable by the app's ephemeral key (no AdminCap gating unless explicitly justified)
- New struct fields must have `store` ability if they need to be read by TS SDK
- Keep `assert_not_paused` guards on all entry functions that manage funds or state
- Test with `sui::test_scenario` — existing tests use `@0xA` (user), `@0xB` (keeper), `@0xC` (admin)

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `contracts/sources/vault.move` | Modify | `create_vault` gets `beneficiary: address` param, `RenewalVault` gets `withdraw_delay_epochs` field, new `migrate_vault` entry function |
| `contracts/tests/vault_tests.move` | Modify | Update all `create_vault` call sites, add tests for `migrate_vault` and delay-field behavior |
| `contracts/Move.toml` | Inspect only | Verify `auto_renewal = "0x0"` placeholder — no change needed |
| `keeper/.env` | Modify | After deploy: add new PACKAGE_ID (keep old one too — both in list) |
| `api/.env.example` | Modify | After deploy: update default PACKAGE_ID |
| `api/src/services/vaultService.ts` | Modify | Update `PACKAGE_ID` constant, add `withdraw_delay_epochs` to vault parsing |

---

### Task 1: Add `beneficiary` parameter to `create_vault`

**Files:**
- Modify: `contracts/sources/vault.move:375-414`
- Modify: `contracts/tests/vault_tests.move` (all `create_vault` call sites)
- Test: `contracts/tests/vault_tests.move`

**Interfaces:**
- Consumes: existing `create_vault` signature at line 375
- Produces: new signature `create_vault(config, blob, initial_wal, renew_threshold_epochs, renew_by_epochs, max_total_epochs, beneficiary: address, ctx)`

- [ ] **Step 1: Write the failing test — create_vault with explicit beneficiary**

```move
#[test]
fun test_create_vault_with_explicit_beneficiary() {
    let mut s = init_env();
    let mut s2 = test_scenario::begin(U);
    let mut sys = sys(ctx(&mut s2));

    // User creates a blob and funds
    let b = blob(&mut sys, 100, ctx(&mut s2));
    let w = wal(1_000_000, ctx(&mut s2));

    // Create vault with explicit beneficiary = K (not the sender U)
    // This should succeed — test that the vault's beneficiary is K, not U
    next_tx(&mut s2, U);
    vault::create_vault(
        test_scenario::take_shared<FeeConfig>(&mut s2),
        b,
        w,
        5,   // threshold
        10,  // by
        option::none(),
        @0xK,  // explicit beneficiary
        ctx(&mut s2),
    );

    // Verify vault belongs to K (not the sender U)
    let v = test_scenario::take_shared<RenewalVault>(&mut s2);
    assert!(v.beneficiary == @0xK, 0);
    assert!(v.beneficiary != @0xA, 0);
    test_scenario::return_shared(v);
    end(s);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sui move test`
Expected: Compilation error — `create_vault` signature doesn't match (old version lacks `beneficiary` param)

- [ ] **Step 3: Modify `create_vault` to accept explicit beneficiary**

In `contracts/sources/vault.move:375`, change the signature:

```move
entry fun create_vault(
    config: &FeeConfig,
    blob: Blob,
    initial_wal: Coin<WAL>,
    renew_threshold_epochs: u64,
    renew_by_epochs: u64,
    max_total_epochs: Option<u64>,
    beneficiary: address,  // NEW: explicit beneficiary
    ctx: &mut TxContext
) {
    assert_not_paused(config);
    // REMOVED: let beneficiary = tx_context::sender(ctx);
    // beneficiary is now the passed parameter
    let current_epoch = tx_context::epoch(ctx);
    // ... rest unchanged
```

- [ ] **Step 4: Remove the `let beneficiary = tx_context::sender(ctx);` line**

At line 385, delete:
```move
let beneficiary = tx_context::sender(ctx);
```
The `beneficiary` parameter from the function signature is now used directly.

- [ ] **Step 5: Update all test call sites in `vault_tests.move`**

Search for every `vault::create_vault(` call and add the beneficiary parameter. The user address `@0xA` is the standard test user — pass it as beneficiary:

```move
vault::create_vault(
    test_scenario::take_shared<FeeConfig>(&mut scenario),
    b,
    w,
    5,
    10,
    option::none(),
    @0xA,  // ← new beneficiary param
    ctx(&mut scenario),
);
```

- [ ] **Step 6: Run tests**

Run: `sui move test`
Expected: All 22 original tests pass + new test passes

- [ ] **Step 7: Commit**

```bash
git add contracts/sources/vault.move contracts/tests/vault_tests.move
git commit -m "feat(contract): add explicit beneficiary param to create_vault"
```

---

### Task 2: Add `migrate_vault` entry function

**Files:**
- Modify: `contracts/sources/vault.move` — add `migrate_vault` after `destroy_vault`
- Modify: `contracts/tests/vault_tests.move` — add migration tests

**Interfaces:**
- Consumes: `RenewalVault` struct, `withdraw` logic, `reclaim_blob` pattern
- Produces: `migrate_vault(vault: &mut RenewalVault, new_beneficiary: address, ctx: &mut TxContext)` entry function

- [ ] **Step 1: Write the failing test — migrate vault to new beneficiary**

```move
#[test]
fun test_migrate_vault() {
    let mut s = init_env();
    let mut s2 = test_scenario::begin(U);
    let mut sys = sys(ctx(&mut s2));
    let b = blob(&mut sys, 100, ctx(&mut s2));
    let w = wal(1_000_000, ctx(&mut s2));

    // Create vault
    next_tx(&mut s2, U);
    vault::create_vault(
        test_scenario::take_shared<FeeConfig>(&mut s2), b, w, 5, 10, option::none(), @0xA, ctx(&mut s2),
    );

    // Migrate from U to K
    next_tx(&mut s2, U);
    let v = test_scenario::take_shared<RenewalVault>(&mut s2);
    vault::migrate_vault(&mut v, @0xK, ctx(&mut s2));
    test_scenario::return_shared(v);

    // Verify: vault beneficiary is now K
    // (test helper reads vault.beneficiary)
    // Verify: old beneficiary (U) can no longer withdraw
    end(s2);
    end(s);
}
```

- [ ] **Step 2: Run test — should fail with "function not found"**

Run: `sui move test`
Expected: Compilation error — `migrate_vault` not defined

- [ ] **Step 3: Implement `migrate_vault`**

Add after `destroy_vault` (around line 530):

```move
/// Migrate the vault to a new beneficiary address.
/// Beneficiary only. Used during contract migration periods and for
/// users who want to transfer vault ownership (e.g., zkLogin → hardware wallet).
/// Emits a VaultMigrated event.
entry fun migrate_vault(
    vault: &mut RenewalVault,
    new_beneficiary: address,
    ctx: &mut TxContext
) {
    assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
    assert!(new_beneficiary != @0x0, EInvalidAddress);

    let old_beneficiary = vault.beneficiary;
    vault.beneficiary = new_beneficiary;

    event::emit(VaultMigrated {
        vault_id: object::id(vault),
        old_beneficiary,
        new_beneficiary,
    });
}
```

Add the `EInvalidAddress` error constant (around line 85):
```move
/// Invalid address (e.g., zero address)
const EInvalidAddress: u64 = 12;
```

Add the event struct (around line 340, in the Events section):
```move
/// Emitted when a vault is migrated to a new beneficiary
public struct VaultMigrated has copy, drop {
    vault_id: ID,
    old_beneficiary: address,
    new_beneficiary: address,
}
```

- [ ] **Step 4: Run tests**

Run: `sui move test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add contracts/sources/vault.move contracts/tests/vault_tests.move
git commit -m "feat(contract): add migrate_vault entry function"
```

---

### Task 3: Add `withdraw_delay_epochs` field to vault struct + delayed withdraw

**Files:**
- Modify: `contracts/sources/vault.move` — add field to `RenewalVault`, update `create_vault`, split `withdraw` into initiate/finalize
- Modify: `contracts/tests/vault_tests.move` — add delay tests

**Interfaces:**
- Consumes: `RenewalVault` struct at line 128, `create_vault` signature at line 375, `withdraw` at line 474
- Produces: New struct field `withdraw_delay_epochs: u64`, new `initiate_withdraw` entry, new `finalize_withdraw` entry, `WithdrawPending` event

- [ ] **Step 1: Write the failing test — withdraw with delay**

```move
#[test]
fun test_withdraw_delay_enforced() {
    let mut s = init_env();
    let mut s2 = test_scenario::begin(U);
    let mut sys = sys(ctx(&mut s2));
    let b = blob(&mut sys, 100, ctx(&mut s2));
    let w = wal(1_000_000, ctx(&mut s2));

    // Create vault with 2 epoch delay
    next_tx(&mut s2, U);
    vault::create_vault(
        test_scenario::take_shared<FeeConfig>(&mut s2), b, w, 5, 10, option::none(), @0xA, 2, ctx(&mut s2),
    );

    // Try to withdraw immediately — should fail (delay not elapsed)
    let v = test_scenario::take_shared<RenewalVault>(&mut s2);
    // ... initiate withdraw ...
    // ... try finalize in same epoch — should abort ...
    test_scenario::return_shared(v);

    end(s2);
    end(s);
}
```

- [ ] **Step 2: Run test — should fail (old struct lacks field)**

Run: `sui move test`
Expected: Compilation error

- [ ] **Step 3: Add `withdraw_delay_epochs` to `RenewalVault`**

```move
public struct RenewalVault has key {
    id: UID,
    beneficiary: address,
    blob: Option<Blob>,
    wal_balance: Balance<WAL>,
    policy: RenewalPolicy,
    total_renewals_executed: u64,
    total_fees_paid: u64,
    created_at_epoch: u64,
    withdraw_delay_epochs: u64,  // NEW: delay in epochs before withdraw settles
    // For pending withdrawals (only set when a withdraw is initiated):
    pending_withdraw_amount: u64,       // NEW: 0 means no pending withdraw
    pending_withdraw_init_epoch: u64,   // NEW: epoch when withdraw was initiated
}
```

- [ ] **Step 4: Update `create_vault` — accept `withdraw_delay_epochs` param**

```move
entry fun create_vault(
    config: &FeeConfig,
    blob: Blob,
    initial_wal: Coin<WAL>,
    renew_threshold_epochs: u64,
    renew_by_epochs: u64,
    max_total_epochs: Option<u64>,
    beneficiary: address,
    withdraw_delay_epochs: u64,  // NEW
    ctx: &mut TxContext
) {
    // ...
    let vault = RenewalVault {
        // ... existing fields ...
        withdraw_delay_epochs,          // NEW
        pending_withdraw_amount: 0,     // NEW
        pending_withdraw_init_epoch: 0, // NEW
    };
```

- [ ] **Step 5: Replace single `withdraw` with initiate/finalize pair**

Remove the old `withdraw` function. Add two new functions:

```move
/// Initiate a withdrawal from the vault. If withdraw_delay_epochs > 0,
/// the WAL enters a pending state and can be finalized after the delay.
/// If withdraw_delay_epochs == 0, the withdrawal settles immediately
/// (same behavior as the original withdraw).
entry fun initiate_withdraw(
    vault: &mut RenewalVault,
    amount: u64,
    ctx: &mut TxContext
) {
    assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
    assert!(vault.pending_withdraw_amount == 0, EWithdrawAlreadyPending);
    assert!(amount > 0, EInvalidAmount);
    assert!(coin::balance_value(&vault.wal_balance) >= amount, EInsufficientBalance);

    if (vault.withdraw_delay_epochs == 0) {
        // No delay — settle immediately
        let withdrawn = coin::take(&mut vault.wal_balance, amount, ctx);
        transfer::public_transfer(withdrawn, vault.beneficiary);

        event::emit(Withdrawn {
            vault_id: object::id(vault),
            amount,
            beneficiary: vault.beneficiary,
        });
    } else {
        // Delay enabled — record pending state
        vault.pending_withdraw_amount = amount;
        vault.pending_withdraw_init_epoch = tx_context::epoch(ctx);

        event::emit(WithdrawPending {
            vault_id: object::id(vault),
            amount,
            beneficiary: vault.beneficiary,
            available_epoch: vault.pending_withdraw_init_epoch + vault.withdraw_delay_epochs,
        });
    }
}

/// Finalize a pending withdrawal after the delay has elapsed.
/// Anyone can call this — the funds always go to vault.beneficiary.
entry fun finalize_withdraw(
    vault: &mut RenewalVault,
    ctx: &mut TxContext
) {
    assert!(vault.pending_withdraw_amount > 0, ENoPendingWithdraw);
    assert!(
        tx_context::epoch(ctx) >= vault.pending_withdraw_init_epoch + vault.withdraw_delay_epochs,
        EWithdrawDelayNotElapsed
    );

    let amount = vault.pending_withdraw_amount;
    let withdrawn = coin::take(&mut vault.wal_balance, amount, ctx);
    transfer::public_transfer(withdrawn, vault.beneficiary);

    vault.pending_withdraw_amount = 0;
    vault.pending_withdraw_init_epoch = 0;

    event::emit(Withdrawn {
        vault_id: object::id(vault),
        amount,
        beneficiary: vault.beneficiary,
    });
}
```

Add error constants:
```move
const EWithdrawAlreadyPending: u64 = 13;
const ENoPendingWithdraw: u64 = 14;
const EWithdrawDelayNotElapsed: u64 = 15;
const EInvalidAmount: u64 = 16;
```

Add event struct:
```move
public struct WithdrawPending has copy, drop {
    vault_id: ID,
    amount: u64,
    beneficiary: address,
    available_epoch: u64,
}
```

- [ ] **Step 6: Update `destroy_vault` to check for no pending withdrawal**

```move
entry fun destroy_vault(
    vault: &mut RenewalVault,
    ctx: &mut TxContext
) {
    assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
    assert!(option::is_none(&vault.blob), EVaultNotEmpty);
    assert!(coin::balance_value(&vault.wal_balance) == 0, EVaultNotEmpty);
    assert!(vault.pending_withdraw_amount == 0, EWithdrawAlreadyPending);
    // ... rest unchanged
}
```

- [ ] **Step 7: Update all test call sites for the new `create_vault` signature**

Add `withdraw_delay_epochs: 0` and the two new fields to every test's vault creation calls.

- [ ] **Step 8: Run tests**

Run: `sui move test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add contracts/sources/vault.move contracts/tests/vault_tests.move
git commit -m "feat(contract): add withdraw_delay_epochs with initiate/finalize withdraw"
```

---

**Keeper finalize_withdraw dependency:** After this contract change is deployed, the keeper's new `finalizeWithdraw` job (Backend Plan, Task 9) is required to complete the withdrawal flow. The keeper must scan for vaults with `pending_withdraw_amount > 0` past their `available_epoch` and call `finalize_withdraw`. Without this, zkLogin withdrawals (which default to `withdraw_delay_epochs = 1`) will get stuck in "pending" forever. This is not optional — the contract change and the keeper job are a single deploy unit.

---

### Task 4: Build, publish to testnet, update package references

**Files:**
- Modify: `keeper/.env` — add new PACKAGE_ID
- Modify: `api/.env.example` — update default PACKAGE_ID
- Modify: `api/src/services/vaultService.ts` — update PACKAGE_ID and object IDs

**Interfaces:**
- Consumes: Published package ID, new object IDs from `sui client publish` output
- Produces: Updated `.env` files and TypeScript constants

- [ ] **Step 1: Build the contract**

Run: `sui move build`
Expected: Success — no warnings, package compiled

- [ ] **Step 2: Publish to testnet**

Run: `sui client publish --gas-budget 50000000 contracts/`
Expected: Publish succeeds, output contains new PACKAGE_ID, FeeConfig object ID, System object ID

- [ ] **Step 3: Extract object IDs from publish output**

Save the following from the publish output:
- `PACKAGE_ID` — the published package address
- `FEE_CONFIG_OBJECT_ID` — the shared FeeConfig object (created in `init()`)
- `SYSTEM_OBJECT_ID` — the Walrus system object ID

- [ ] **Step 4: Update `keeper/.env`**

```env
# Keep old package ID for existing vaults
PACKAGE_ID_OLD=0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7
# New package ID for newly created vaults
PACKAGE_ID_NEW=<new-package-id>
# Both — keeper scans both
PACKAGE_IDS=<old>,<new>
FEE_CONFIG_ID=<new-fee-config-id>
SYSTEM_OBJECT_ID=<same-as-before-or-new-if-changed>
```

- [ ] **Step 5: Update `api/.env.example`**

```env
PACKAGE_ID=<new-package-id>
FEE_CONFIG_OBJECT_ID=<new-fee-config-id>
SYSTEM_OBJECT_ID=<...>
WAL_COIN_TYPE=0x...::wal::WAL
```

- [ ] **Step 6: Run create_vault end-to-end on testnet**

Use the API to create a vault with the new contract. Confirm:
- Vault appears on Suiscan with correct `beneficiary` address
- `withdraw` with destination ≠ `vault.beneficiary` is rejected (regardless of signer)
- Owner can withdraw to their own address

- [ ] **Step 7: Commit**

```bash
git add keeper/.env api/.env.example
git commit -m "chore: publish updated vault contract to testnet"
```
