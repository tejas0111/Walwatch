// === Auto-Renewal Keeper — Vault Module ===
//
// On-chain contract for permissionless, trust-minimized auto-renewal
// of Walrus blobs. Users deposit WAL and a Blob object into a RenewalVault,
// set a renewal policy, and anyone (keeper bots) can call execute_renewal
// when the blob is due for renewal, earning a keeper fee.
//
// Full spec: see spec.md §3.1
//
// Walrus Move API used:
//   - system::System       — global system state, epoch tracking
//   - system::extend_blob  — extends a blob's storage by paying WAL
//   - system::epoch        — returns the current epoch
//   - blob::Blob           — the Walrus blob object (held in custody)
//   - blob::end_epoch      — returns the blob's current storage end epoch
//   - blob::blob_id        — returns the blob's u256 identifier
//   - wal::wal::WAL        — the native WAL token type

module auto_renewal::vault {

    // ============================================================================
    // Imports
    // ============================================================================

    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::package::UpgradeCap;

    use wal::wal::WAL;
    use walrus::blob::{Self, Blob};
    use walrus::system::{Self, System};

    // ============================================================================
    // Constants
    // ============================================================================

    /// Default protocol fee as basis points (400 = 4%).
    /// Can be overridden via FeeConfig (requires AdminCap).
    const DEFAULT_PROTOCOL_FEE_BPS: u64 = 400;

    /// Minimum keeper fee in MIST-equivalent of WAL.
    /// Paid to whichever address successfully calls execute_renewal.
    const DEFAULT_KEEPER_FEE: u64 = 1_000_000;

    /// Maximum allowed protocol fee in basis points (100%).
    const MAX_PROTOCOL_FEE_BPS: u64 = 10000;

    /// Default storage price per epoch in MIST-equivalent of WAL.
    /// Used in estimate_renewal_cost until Walrus exposes on-chain pricing.
    const DEFAULT_STORAGE_PRICE_PER_EPOCH: u64 = 1_000_000;

    /// Current contract version. Incremented on each upgrade.
    /// Used by migrate() to determine which migrations to run.
    const CONTRACT_VERSION: u64 = 2;

    // ============================================================================
    // Error Codes
    // ============================================================================

    /// Caller is not the vault's beneficiary
    const ENotBeneficiary: u64 = 1;
    /// Renewal policy is not active
    const ENotActive: u64 = 2;
    /// Blob is not yet due for renewal
    const ENotDueForRenewal: u64 = 3;
    /// Vault WAL balance is insufficient for the renewal
    const EInsufficientBalance: u64 = 4;
    /// Blob has already been reclaimed from this vault
    const EBlobNotFound: u64 = 5;
    /// Protocol fee exceeds maximum allowed (10000 bps = 100%)
    const EInvalidFeeBps: u64 = 6;
    /// Treasury address has not been configured
    const ETreasuryNotSet: u64 = 7;
    /// Caller does not hold the AdminCap
    const ENotAdmin: u64 = 8;
    /// Vault still holds a blob or has remaining balance
    const EVaultNotEmpty: u64 = 9;
    /// System is paused
    const EPaused: u64 = 10;
    /// Caller is not the operator
    const ENotOperator: u64 = 11;
    /// Invalid address (e.g., zero address)
    const EInvalidAddress: u64 = 12;
    /// A withdrawal is already pending for this vault
    const EWithdrawAlreadyPending: u64 = 13;
    /// No pending withdrawal to finalize
    const ENoPendingWithdraw: u64 = 14;
    /// The withdrawal delay has not yet elapsed
    const EWithdrawDelayNotElapsed: u64 = 15;
    /// Invalid amount (e.g., zero)
    const EInvalidAmount: u64 = 16;
    /// Renewal would leave insufficient balance for a pending withdrawal
    const EPendingWithdrawShort: u64 = 17;

    // ============================================================================
    // Structs
    // ============================================================================

    /// Admin capability — required to change FeeConfig parameters.
    /// Created in init() and transferred to the deployer (one-time).
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Operator capability — required to pause/unpause the system.
    /// Created and transferred by the admin (holder of AdminCap).
    /// Separating operator from admin allows delegating emergency
    /// response without exposing full admin privileges.
    public struct PauserCap has key, store {
        id: UID,
    }

    /// Global fee configuration, created in init() and shared.
    public struct FeeConfig has key {
        id: UID,
        /// Address that receives protocol fees
        treasury: address,
        /// Protocol fee in basis points (e.g., 400 = 4%)
        protocol_fee_bps: u64,
        /// Fixed keeper fee paid to the executor
        keeper_fee: u64,
        /// Global pause flag — when true, all operations are blocked
        paused: bool,
        /// Estimated WAL cost per epoch of blob storage (in MIST)
        storage_price_per_epoch: u64,
        /// Current contract version — incremented on upgrade via migrate()
        version: u64,
    }

    /// Core vault object — holds the blob and WAL balance for auto-renewal.
    /// One vault per blob (v1 design, see spec §3.3).
    ///
    /// The `blob` field is wrapped in `Option<Blob>` to allow reclaiming:
    /// the beneficiary can call `reclaim_blob` which uses `option::extract`
    /// to move the Blob out of the vault and transfer it back.
    public struct RenewalVault has key {
        id: UID,
        /// The user who controls this vault (withdraw, reclaim, update policy)
        beneficiary: address,
        /// The Walrus Blob object held in custody (None after reclaimed)
        blob: Option<Blob>,
        /// Prepaid WAL balance for funding renewals
        wal_balance: Balance<WAL>,
        /// Renewal policy configuration
        policy: RenewalPolicy,
        /// Total number of successful renewals executed
        total_renewals_executed: u64,
        /// Total protocol fees collected (in MIST-equivalent of WAL)
        total_fees_paid: u64,
        /// Epoch when the vault was created
        created_at_epoch: u64,
        /// Number of epochs to delay before a withdrawal settles
        withdraw_delay_epochs: u64,
        /// Amount of pending withdrawal (0 means no pending withdraw)
        pending_withdraw_amount: u64,
        /// Epoch when the pending withdrawal was initiated
        pending_withdraw_init_epoch: u64,
    }

    /// Renewal policy controlling when and how much to renew.
    public struct RenewalPolicy has store, copy, drop {
        /// Trigger renewal when <= this many epochs remain on the blob
        renew_threshold_epochs: u64,
        /// How many epochs to extend per renewal call
        renew_by_epochs: u64,
        /// Optional safety cap — stop auto-renewing past this absolute end_epoch
        max_total_epochs: Option<u64>,
        /// Whether the policy is currently active (beneficiary can pause)
        active: bool,
    }

    // ============================================================================
    // Events
    // ============================================================================

    public struct VaultCreated has copy, drop {
        vault_id: ID,
        beneficiary: address,
        blob_id: u256,
        created_at_epoch: u64,
    }

    public struct Deposited has copy, drop {
        vault_id: ID,
        amount: u64,
        depositor: address,
    }

    public struct PolicyUpdated has copy, drop {
        vault_id: ID,
        renew_threshold_epochs: u64,
        renew_by_epochs: u64,
        max_total_epochs: Option<u64>,
        active: bool,
    }

    public struct Withdrawn has copy, drop {
        vault_id: ID,
        amount: u64,
        beneficiary: address,
    }

    public struct VaultMigrated has copy, drop {
        vault_id: ID,
        old_beneficiary: address,
        new_beneficiary: address,
    }

    public struct WithdrawPending has copy, drop {
        vault_id: ID,
        amount: u64,
        beneficiary: address,
        available_epoch: u64,
    }

    public struct WithdrawCancelled has copy, drop {
        vault_id: ID,
        amount: u64,
        beneficiary: address,
    }

    public struct BlobReclaimed has copy, drop {
        vault_id: ID,
        blob_id: u256,
        beneficiary: address,
    }

    public struct RenewalExecuted has copy, drop {
        vault_id: ID,
        blob_id: u256,
        new_end_epoch: u32,
        actual_cost: u64,
        protocol_fee_paid: u64,
        keeper_fee_paid: u64,
        executor: address,
    }

    public struct InsufficientBalance has copy, drop {
        vault_id: ID,
        required: u64,
        available: u64,
    }

    public struct PolicyExhausted has copy, drop {
        vault_id: ID,
        blob_id: u256,
        max_total_epochs: u64,
    }

    public struct FeeConfigUpdated has copy, drop {
        treasury: address,
        protocol_fee_bps: u64,
        keeper_fee: u64,
    }

    public struct Paused has copy, drop { }

    public struct Unpaused has copy, drop { }

    public struct OperatorSet has copy, drop {
        operator: address,
    }

    public struct StoragePriceUpdated has copy, drop {
        new_price_per_epoch: u64,
    }

    // ============================================================================
    // Initialization
    // ============================================================================

    /// Initialize the FeeConfig with default values and create AdminCap.
    /// The deployer receives the AdminCap and MUST configure the treasury
    /// address before any renewal can execute.
    fun init(ctx: &mut TxContext) {
        let fee_config = FeeConfig {
            id: object::new(ctx),
            treasury: @0x0,
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            keeper_fee: DEFAULT_KEEPER_FEE,
            paused: false,
            storage_price_per_epoch: DEFAULT_STORAGE_PRICE_PER_EPOCH,
            version: CONTRACT_VERSION,
        };
        transfer::share_object(fee_config);

        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    // ============================================================================
    // FeeConfig Administration
    // ============================================================================

    /// Set the treasury address that receives protocol fees.
    /// Requires AdminCap — only the deployer can call this.
    entry fun set_treasury(
        _admin: &AdminCap,
        config: &mut FeeConfig,
        new_treasury: address,
    ) {
        assert!(new_treasury != @0x0, ETreasuryNotSet);
        config.treasury = new_treasury;
        event::emit(FeeConfigUpdated {
            treasury: new_treasury,
            protocol_fee_bps: config.protocol_fee_bps,
            keeper_fee: config.keeper_fee,
        });
    }

    /// Set the protocol fee in basis points (0–10000 = 0%–100%).
    /// Requires AdminCap — only the deployer can call this.
    entry fun set_protocol_fee_bps(
        _admin: &AdminCap,
        config: &mut FeeConfig,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= MAX_PROTOCOL_FEE_BPS, EInvalidFeeBps);
        config.protocol_fee_bps = new_fee_bps;
        event::emit(FeeConfigUpdated {
            treasury: config.treasury,
            protocol_fee_bps: new_fee_bps,
            keeper_fee: config.keeper_fee,
        });
    }

    /// Set the keeper fee paid to the executor.
    /// Requires AdminCap — only the deployer can call this.
    entry fun set_keeper_fee(
        _admin: &AdminCap,
        config: &mut FeeConfig,
        new_fee: u64,
    ) {
        config.keeper_fee = new_fee;
        event::emit(FeeConfigUpdated {
            treasury: config.treasury,
            protocol_fee_bps: config.protocol_fee_bps,
            keeper_fee: new_fee,
        });
    }

    /// Set the estimated storage price per epoch.
    /// Requires AdminCap — only the deployer can call this.
    /// Adjusts the estimate_renewal_cost calculation without modifying
    /// actual Walrus storage pricing (which is determined at execution time).
    entry fun set_storage_price(
        _admin: &AdminCap,
        config: &mut FeeConfig,
        new_price: u64,
    ) {
        config.storage_price_per_epoch = new_price;
        event::emit(StoragePriceUpdated { new_price_per_epoch: new_price });
    }

    // ============================================================================
    // Operator & Pause Administration
    // ============================================================================

    /// Create a PauserCap and transfer it to the designated operator.
    /// Requires AdminCap — only the deployer can designate operators.
    /// The PauserCap authorizes emergency_pause / emergency_unpause.
    entry fun create_pauser_cap(
        _admin: &AdminCap,
        operator: address,
        ctx: &mut TxContext,
    ) {
        let cap = PauserCap { id: object::new(ctx) };
        transfer::transfer(cap, operator);

        event::emit(OperatorSet { operator });
    }

    /// Pause the system — blocks all vault operations.
    /// Requires PauserCap (held by the designated operator).
    entry fun emergency_pause(
        _cap: &PauserCap,
        config: &mut FeeConfig,
    ) {
        config.paused = true;
        event::emit(Paused { });
    }

    /// Unpause the system — restores all vault operations.
    /// Requires PauserCap (held by the designated operator).
    entry fun emergency_unpause(
        _cap: &PauserCap,
        config: &mut FeeConfig,
    ) {
        config.paused = false;
        event::emit(Unpaused { });
    }

    // ============================================================================
    // Internal Pause Guard
    // ============================================================================

    /// Abort with EPaused if the system is paused.
    fun assert_not_paused(config: &FeeConfig) {
        assert!(!config.paused, EPaused);
    }

    // ============================================================================
    // Entry Functions
    // ============================================================================

    /// Create a new auto-renewal vault, transferring the blob and initial
    /// WAL deposit into the contract's custody.
    entry fun create_vault(
        config: &FeeConfig,
        blob: Blob,
        initial_wal: Coin<WAL>,
        renew_threshold_epochs: u64,
        renew_by_epochs: u64,
        max_total_epochs: Option<u64>,
        beneficiary: address,
        withdraw_delay_epochs: u64,
        ctx: &mut TxContext
    ) {
        assert_not_paused(config);
        let current_epoch = tx_context::epoch(ctx);
        let blob_id = blob.blob_id();

        let vault = RenewalVault {
            id: object::new(ctx),
            beneficiary,
            blob: option::some(blob),
            wal_balance: coin::into_balance(initial_wal),
            policy: RenewalPolicy {
                renew_threshold_epochs,
                renew_by_epochs,
                max_total_epochs,
                active: true,
            },
            total_renewals_executed: 0,
            total_fees_paid: 0,
            created_at_epoch: current_epoch,
            withdraw_delay_epochs,
            pending_withdraw_amount: 0,
            pending_withdraw_init_epoch: 0,
        };

        let vault_id = object::id(&vault);
        transfer::share_object(vault);

        event::emit(VaultCreated {
            vault_id,
            beneficiary,
            blob_id,
            created_at_epoch: current_epoch,
        });
    }

    /// Top up the vault's WAL balance. Anyone can deposit.
    entry fun deposit(
        config: &FeeConfig,
        vault: &mut RenewalVault,
        coin: Coin<WAL>,
        _ctx: &mut TxContext
    ) {
        assert_not_paused(config);
        let amount = coin::value(&coin);
        balance::join(&mut vault.wal_balance, coin::into_balance(coin));

        event::emit(Deposited {
            vault_id: object::id(vault),
            amount,
            depositor: tx_context::sender(_ctx),
        });
    }

    /// Update the vault's renewal policy. Beneficiary only.
    entry fun update_policy(
        config: &FeeConfig,
        vault: &mut RenewalVault,
        new_policy: RenewalPolicy,
        ctx: &TxContext
    ) {
        assert_not_paused(config);
        assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
        vault.policy = new_policy;

        event::emit(PolicyUpdated {
            vault_id: object::id(vault),
            renew_threshold_epochs: vault.policy.renew_threshold_epochs,
            renew_by_epochs: vault.policy.renew_by_epochs,
            max_total_epochs: vault.policy.max_total_epochs,
            active: vault.policy.active,
        });
    }

    /// Convenience entry — same as update_policy but accepts individual fields
    /// so the TS SDK can pass them without BCS-serializing a struct.
    entry fun update_policy_fields(
        config: &FeeConfig,
        vault: &mut RenewalVault,
        renew_threshold_epochs: u64,
        renew_by_epochs: u64,
        max_total_epochs: Option<u64>,
        active: bool,
        ctx: &TxContext
    ) {
        update_policy(config, vault, RenewalPolicy {
            renew_threshold_epochs,
            renew_by_epochs,
            max_total_epochs,
            active,
        }, ctx);
    }

    /// Initiate a withdrawal from the vault. If withdraw_delay_epochs > 0,
    /// the WAL enters a pending state and can be finalized after the delay.
    /// If withdraw_delay_epochs == 0, the withdrawal settles immediately
    /// (same behavior as the original withdraw). Beneficiary only.
    entry fun initiate_withdraw(
        vault: &mut RenewalVault,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
        assert!(vault.pending_withdraw_amount == 0, EWithdrawAlreadyPending);
        assert!(amount > 0, EInvalidAmount);
        assert!(balance::value(&vault.wal_balance) >= amount, EInsufficientBalance);

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

        // Re-check balance — renewals may have reduced it since initiate
        assert!(balance::value(&vault.wal_balance) >= vault.pending_withdraw_amount, EInsufficientBalance);

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

    /// Reclaim the Blob object from the vault, cancelling auto-renewal.
    /// Beneficiary only. Transfers the blob back and deactivates the policy.
    entry fun reclaim_blob(
        vault: &mut RenewalVault,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);

        // Extract the blob from the Option, aborting if already reclaimed.
        let blob = option::extract(&mut vault.blob);
        let blob_id = blob.blob_id();

        vault.policy.active = false;

        // Transfer the blob back to the beneficiary.
        // Blob has `store` ability, so public_transfer is allowed.
        transfer::public_transfer(blob, vault.beneficiary);

        event::emit(BlobReclaimed {
            vault_id: object::id(vault),
            blob_id,
            beneficiary: vault.beneficiary,
        });
    }

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
        assert!(vault.pending_withdraw_amount == 0, EWithdrawAlreadyPending);

        let old_beneficiary = vault.beneficiary;
        vault.beneficiary = new_beneficiary;

        event::emit(VaultMigrated {
            vault_id: object::id(vault),
            old_beneficiary,
            new_beneficiary,
        });
    }

    /// Cancel a pending withdrawal. The beneficiary can use this to reset
    /// the pending state if they change their mind or need to recover from
    /// a stuck state (e.g., insufficient balance after renewal).
    entry fun cancel_pending_withdraw(
        vault: &mut RenewalVault,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
        assert!(vault.pending_withdraw_amount > 0, ENoPendingWithdraw);

        let amount = vault.pending_withdraw_amount;
        vault.pending_withdraw_amount = 0;
        vault.pending_withdraw_init_epoch = 0;

        event::emit(WithdrawCancelled {
            vault_id: object::id(vault),
            amount,
            beneficiary: vault.beneficiary,
        });
    }

    /// Destroy an empty vault after blob reclamation, reclaiming storage rebate.
    /// Beneficiary only. Vault must have no blob and zero WAL balance.
    entry fun destroy_vault(
        vault: RenewalVault,
        ctx: &TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.beneficiary, ENotBeneficiary);
        assert!(vault.blob.is_none(), EVaultNotEmpty);
        assert!(balance::value(&vault.wal_balance) == 0, EVaultNotEmpty);
        assert!(vault.pending_withdraw_amount == 0, EWithdrawAlreadyPending);

        let RenewalVault {
            id,
            blob,
            wal_balance,
            policy: _,
            beneficiary: _,
            total_renewals_executed: _,
            total_fees_paid: _,
            created_at_epoch: _,
            withdraw_delay_epochs: _,
            pending_withdraw_amount: _,
            pending_withdraw_init_epoch: _,
        } = vault;

        // blob is proven None by the assertion above — use destroy_none to
        // safely discard the Option<Blob> (Blob does not have drop ability)
        option::destroy_none(blob);
        balance::destroy_zero(wal_balance);
        id.delete();
    }

    /// Permissionless — anyone can call this to execute a due renewal.
    entry fun execute_renewal(
        vault: &mut RenewalVault,
        fee_config: &mut FeeConfig,
        system: &mut System,
        ctx: &mut TxContext
    ) {
        // 0. System must not be paused
        assert_not_paused(fee_config);

        // 1. Policy must be active and blob must exist
        assert!(vault.policy.active, ENotActive);
        assert!(vault.blob.is_some(), EBlobNotFound);

        let current_epoch = system::epoch(system);
        let end_epoch = vault.blob.borrow().end_epoch();

        // 2. Check if renewal is actually due
        assert!(
            (current_epoch as u64) + vault.policy.renew_threshold_epochs >= (end_epoch as u64),
            ENotDueForRenewal,
        );

        // 3. Apply max_total_epochs safety cap
        let mut actual_renew_epochs = vault.policy.renew_by_epochs;

        if (vault.policy.max_total_epochs.is_some()) {
            let max_epochs = *vault.policy.max_total_epochs.borrow();

            if ((end_epoch as u64) + actual_renew_epochs > max_epochs) {
                if (max_epochs <= (end_epoch as u64)) {
                    vault.policy.active = false;
                    event::emit(PolicyExhausted {
                        vault_id: object::id(vault),
                        blob_id: vault.blob.borrow().blob_id(),
                        max_total_epochs: max_epochs,
                    });
                    return
                };
                actual_renew_epochs = max_epochs - (end_epoch as u64);
            };
        };

        // 4. Compute fees and check balance
        let available = balance::value(&vault.wal_balance);
        let protocol_fee_bps = fee_config.protocol_fee_bps;
        let keeper_fee = fee_config.keeper_fee;
        let treasury = fee_config.treasury;

        // Ensure treasury has been configured before collecting protocol fees
        assert!(treasury != @0x0, ETreasuryNotSet);

        let estimated_cost = estimate_renewal_cost(actual_renew_epochs, fee_config.storage_price_per_epoch);
        let protocol_fee = (estimated_cost * protocol_fee_bps) / 10000;
        let total_needed = estimated_cost + protocol_fee + keeper_fee;

        if (available < total_needed) {
            event::emit(InsufficientBalance {
                vault_id: object::id(vault),
                required: total_needed,
                available,
            });
            abort EInsufficientBalance
        };

        // 4b. Ensure renewal doesn't dip below a pending withdrawal
        if (available - total_needed < vault.pending_withdraw_amount) {
            abort EPendingWithdrawShort
        };

        // 5. Split fees and call extend_blob
        let mut payment_coin = coin::take(&mut vault.wal_balance, total_needed, ctx);

        // Protocol fee to treasury
        let protocol_coin = coin::split(&mut payment_coin, protocol_fee, ctx);
        transfer::public_transfer(protocol_coin, treasury);

        // Keeper fee to executor
        if (keeper_fee > 0) {
            let keeper_coin = coin::split(&mut payment_coin, keeper_fee, ctx);
            transfer::public_transfer(keeper_coin, tx_context::sender(ctx));
        };

        let before_extend = coin::value(&payment_coin);

        // Extend the blob via Walrus system
        system::extend_blob(system, vault.blob.borrow_mut(), actual_renew_epochs as u32, &mut payment_coin);

        let actual_cost = before_extend - coin::value(&payment_coin);

        // Return leftover to vault
        let remaining = coin::into_balance(payment_coin);
        if (balance::value(&remaining) > 0) {
            balance::join(&mut vault.wal_balance, remaining);
        } else {
            remaining.destroy_zero();
        };

        // 6. Update state and emit event
        let new_end_epoch = vault.blob.borrow().end_epoch();

        vault.total_renewals_executed = vault.total_renewals_executed + 1;
        vault.total_fees_paid = vault.total_fees_paid + protocol_fee;

        event::emit(RenewalExecuted {
            vault_id: object::id(vault),
            blob_id: vault.blob.borrow().blob_id(),
            new_end_epoch,
            actual_cost,
            protocol_fee_paid: protocol_fee,
            keeper_fee_paid: keeper_fee,
            executor: tx_context::sender(ctx),
        });
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// Check if a vault is active and its blob is due for renewal.
    public fun is_due(vault: &RenewalVault, current_epoch: u32): bool {
        if (!vault.policy.active) return false;
        if (vault.blob.is_none()) return false;
        let end_epoch = vault.blob.borrow().end_epoch();
        (current_epoch as u64) + vault.policy.renew_threshold_epochs >= (end_epoch as u64)
    }

    /// Get the beneficiary address of a vault.
    public fun get_beneficiary(vault: &RenewalVault): address {
        vault.beneficiary
    }

    /// Get the current WAL balance of a vault.
    public fun get_wal_balance(vault: &RenewalVault): u64 {
        balance::value(&vault.wal_balance)
    }

    /// Get the blob ID if the vault still holds a blob.
    public fun get_blob_id(vault: &RenewalVault): Option<u256> {
        if (vault.blob.is_some()) {
            option::some(vault.blob.borrow().blob_id())
        } else {
            option::none()
        }
    }

    /// Get the blob's current storage end epoch, if the blob still exists.
    public fun get_end_epoch(vault: &RenewalVault): Option<u32> {
        if (vault.blob.is_some()) {
            option::some(vault.blob.borrow().end_epoch())
        } else {
            option::none()
        }
    }

    /// Get the current renewal policy.
    public fun get_policy(vault: &RenewalVault): RenewalPolicy {
        vault.policy
    }

    /// Get whether the vault still holds a blob (i.e., hasn't been reclaimed).
    public fun has_blob(vault: &RenewalVault): bool {
        vault.blob.is_some()
    }

    // ============================================================================
    // FeeConfig View Functions
    // ============================================================================

    /// Get the treasury address from FeeConfig.
    public fun treasury_address(config: &FeeConfig): address {
        config.treasury
    }

    /// Get the protocol fee in basis points.
    public fun protocol_fee_bps(config: &FeeConfig): u64 {
        config.protocol_fee_bps
    }

    /// Get the keeper fee.
    public fun keeper_fee(config: &FeeConfig): u64 {
        config.keeper_fee
    }

    /// Check whether the system is paused.
    public fun is_paused(config: &FeeConfig): bool {
        config.paused
    }

    /// Get the storage price per epoch.
    public fun storage_price(config: &FeeConfig): u64 {
        config.storage_price_per_epoch
    }

    /// Get the current contract version.
    public fun get_version(config: &FeeConfig): u64 {
        config.version
    }

    // ============================================================================
    // Policy Field Getters (needed by test modules in separate module)
    // ============================================================================

    /// Get the renew threshold from a policy.
    public fun policy_renew_threshold(policy: &RenewalPolicy): u64 {
        policy.renew_threshold_epochs
    }

    /// Get the renew-by epochs from a policy.
    public fun policy_renew_by(policy: &RenewalPolicy): u64 {
        policy.renew_by_epochs
    }

    /// Get the max_total_epochs cap from a policy.
    public fun policy_max_epochs(policy: &RenewalPolicy): Option<u64> {
        policy.max_total_epochs
    }

    /// Check whether the policy is active.
    public fun policy_is_active(policy: &RenewalPolicy): bool {
        policy.active
    }

    // ============================================================================
    // Test-Only Initialization
    // ============================================================================

    /// Test-only init: creates and shares FeeConfig, transfers AdminCap to caller.
    /// Must be called in the first next_tx of each test.
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        let fee_config = FeeConfig {
            id: object::new(ctx),
            treasury: @0x0,
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            keeper_fee: DEFAULT_KEEPER_FEE,
            paused: false,
            storage_price_per_epoch: DEFAULT_STORAGE_PRICE_PER_EPOCH,
            version: CONTRACT_VERSION,
        };
        transfer::share_object(fee_config);

        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    // ============================================================================
    // Upgrade Migration
    // ============================================================================

    /// Post-upgrade migration hook. Called by Sui framework after a package
    /// upgrade. Updates FeeConfig.version and runs version-specific migrations.
    ///
    /// This function MUST be called with the existing FeeConfig so it can
    /// update the version and run any data migrations. If no FeeConfig
    /// exists at upgrade time (fresh publish), this is a no-op via init().
    ///
    /// Migration chain (run in order):
    ///   - v1 → v2: (placeholder for future upgrades)
    #[ext(migration)]
    fun migrate(
        _upgrade_cap: &UpgradeCap,
        config: &mut FeeConfig,
        _ctx: &mut TxContext,
    ) {
        // Handle migration from previous versions
        if (config.version < CONTRACT_VERSION) {
            // v1 → v2: add new fields (handled by struct layout compat)
            config.version = CONTRACT_VERSION;
        };
    }

    // ============================================================================
    // Internal Helpers
    // ============================================================================

    /// Estimate the WAL cost of extending a blob by `epochs` epochs.
    ///
    /// Uses the configured `storage_price_per_epoch` from FeeConfig, which
    /// the admin can adjust via `set_storage_price()`.
    ///
    /// NOTE: This is an estimate. The actual Walrus `system::extend_blob`
    /// call determines the real cost at execution time based on storage
    /// pricing. The fee calculation (protocol_fee = estimate * bps / 10000)
    /// uses this estimate, meaning protocol fees may not exactly match the
    /// real cost.
    ///
    /// The leftover handling in `execute_renewal` returns any excess WAL
    /// to the vault, and the atomic transaction ensures fees are only paid
    /// if `extend_blob` succeeds. Under-estimation may cause
    /// `EInsufficientBalance` to abort valid renewals.
    ///
    /// TODO: Replace with `system::get_renewal_cost()` when Walrus exposes
    /// it in the Move API. Tracked in: https://github.com/MystenLabs/walrus/issues
    public fun estimate_renewal_cost(epochs: u64, storage_price_per_epoch: u64): u64 {
        epochs * storage_price_per_epoch
    }
}
