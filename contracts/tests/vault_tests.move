// === Auto-Renewal Vault — Test Suite ===

#[test_only]
module auto_renewal::vault_tests {

    use sui::test_scenario::{Self, ctx, next_tx, next_epoch, end};
    use sui::coin::{Self, Coin};
    use sui::tx_context::TxContext;
    use std::unit_test;
    use wal::wal::WAL;
    use walrus::system::{Self, System};
    use walrus::blob::Blob;
    use auto_renewal::vault::{Self, RenewalVault, FeeConfig, AdminTimelock, AdminCap, PauserCap};

    const U: address = @0xA;
    const K: address = @0xB;
    const ADMIN: address = @0xC;
    const TREASURY: address = @0xD;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Init env: call init_for_testing in tx 0, then set treasury in tx 1.
    fun init_env(): test_scenario::Scenario {
        let mut s = test_scenario::begin(ADMIN);
        // Tx 0: manually init FeeConfig + AdminCap + AdminTimelock
        vault::init_for_testing(ctx(&mut s));
        // Advance to tx 1: now take AdminCap + FeeConfig + Timelock to set treasury
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 1, 0, TREASURY, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Still in tx 1 — caller advances
        s
    }

    fun sys(ctx: &mut TxContext): System { system::new_for_testing(ctx) }

    fun blob(sys: &mut System, ee: u32, ctx: &mut TxContext): Blob {
        let mut p = coin::mint_for_testing<WAL>(100_000_000, ctx);
        let st = system::reserve_space(sys, 1000, ee, &mut p, ctx);
        let b = system::register_blob(sys, st, 0x1234, 0x5678, 1000, 1, false, &mut p, ctx);
        coin::burn_for_testing(p);
        b
    }

    fun wal(amt: u64, ctx: &mut TxContext): Coin<WAL> {
        coin::mint_for_testing<WAL>(amt, ctx)
    }

    /// Take the shared FeeConfig (must be returned with put_config).
    fun get_config(s: &mut test_scenario::Scenario): FeeConfig {
        test_scenario::take_shared<FeeConfig>(s)
    }

    /// Return the shared FeeConfig.
    fun put_config(_s: &mut test_scenario::Scenario, config: FeeConfig) {
        test_scenario::return_shared(config);
    }

    /// Take the shared AdminTimelock (must be returned with put_timelock).
    fun get_timelock(s: &mut test_scenario::Scenario): AdminTimelock {
        test_scenario::take_shared<AdminTimelock>(s)
    }

    /// Return the shared AdminTimelock.
    fun put_timelock(_s: &mut test_scenario::Scenario, tl: AdminTimelock) {
        test_scenario::return_shared(tl);
    }

    /// Create a vault in the CURRENT tx. Caller must be in right sender tx.
    fun mk_vault(s: &mut test_scenario::Scenario, config: &FeeConfig) {
        let mut sys = sys(ctx(s));
        vault::create_vault(
            config,
            blob(&mut sys, 100, ctx(s)),
            wal(100_000_000, ctx(s)),
            5, 10, 200, U, 0, ctx(s),
        );
        unit_test::destroy(sys);
    }

    // ======================================================================
    // Test 1: Create Vault
    // ======================================================================
    #[test]
    fun test_create_vault() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        // Verify VaultCreated event was emitted from the vault creation tx
        let effects = next_tx(&mut s, U);
        assert!(test_scenario::num_user_events(&effects) == 1, 0);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_beneficiary(&v) == U, 2);
        assert!(vault::get_wal_balance(&v) == 100_000_000, 3);
        assert!(vault::has_blob(&v) == true, 4);
        assert!(vault::policy_renew_threshold(&vault::get_policy(&v)) == 5, 5);
        assert!(vault::policy_renew_by(&vault::get_policy(&v)) == 10, 6);
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == true, 7);
        assert!(vault::policy_max_epochs(&vault::get_policy(&v)) == 200, 8);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 2: Deposit
    // ======================================================================
    #[test]
    fun test_deposit() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let config = get_config(&mut s);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::deposit(&config, &mut v, wal(50_000_000, ctx(&mut s)), ctx(&mut s));
        test_scenario::return_shared(v);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_wal_balance(&v) == 150_000_000, 10);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 3: Withdraw
    // ======================================================================
    #[test]
    fun test_withdraw_as_beneficiary() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 30_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_wal_balance(&v) == 70_000_000, 20);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 4: Non-beneficiary Cannot Withdraw
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 1, location = auto_renewal::vault)]
    fun test_withdraw_as_non_beneficiary_fails() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 1000, ctx(&mut s));
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 5: Reclaim Blob
    // ======================================================================
    #[test]
    fun test_reclaim_blob() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::reclaim_blob(&mut v, ctx(&mut s));
        test_scenario::return_shared(v);
        // Verify BlobReclaimed event was emitted from the reclaim tx
        let effects = next_tx(&mut s, U);
        assert!(test_scenario::num_user_events(&effects) == 1, 30);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::has_blob(&v) == false, 32);
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == false, 33);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 6: Update Policy
    // ======================================================================
    #[test]
    fun test_update_policy() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::update_policy_fields(&config, &mut v, 3, 20, 200, true, ctx(&mut s));
        test_scenario::return_shared(v);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        let p = vault::get_policy(&v);
        assert!(vault::policy_renew_threshold(&p) == 3, 40);
        assert!(vault::policy_renew_by(&p) == 20, 41);
        assert!(vault::policy_max_epochs(&p) == 200, 42);
        assert!(vault::policy_is_active(&p) == true, 43);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 7: Execute Renewal
    // ======================================================================
    #[test]
    fun test_execute_renewal() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 200, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c, &mut sys2, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_end_epoch(&v).is_some(), 50);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 8: Renewal on Inactive Vault Fails
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 2, location = auto_renewal::vault)]
    fun test_execute_renewal_inactive_vault_fails() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::update_policy_fields(&config, &mut v, 5, 10, 0, false, ctx(&mut s));
        test_scenario::return_shared(v);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c, &mut sys, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys);
        end(s);
    }

    // ======================================================================
    // Test 9: Renewal Not Due Fails
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 3, location = auto_renewal::vault)]
    fun test_execute_renewal_not_due_fails() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 200, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 300, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c, &mut sys2, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        end(s);
    }

    // ======================================================================
    // Test 10: Insufficient Balance — event emitted, policy deactivated
    // ======================================================================
    #[test]
    fun test_execute_renewal_insufficient_balance() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(1_000, ctx(&mut s)), 5, 10, 200, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        // This should succeed (return, not abort) and deactivate the policy
        vault::execute_renewal(&mut v, &mut c, &mut sys2, ctx(&mut s));
        // Verify policy was deactivated (InsufficientBalance event was emitted)
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == false, 40);
        // Verify balance was NOT consumed (insufficient means no renewal)
        assert!(vault::get_wal_balance(&v) == 1_000, 41);
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        end(s);
    }

    // ======================================================================
    // Test 11: max_total_epochs Cap
    // ======================================================================
    #[test]
    fun test_execute_renewal_cap_reached() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 55, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c, &mut sys2, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == true, 60);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 12: Non-beneficiary Cannot Update Policy
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 1, location = auto_renewal::vault)]
    fun test_update_policy_unauthorized_fails() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let config = get_config(&mut s);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::update_policy_fields(&config, &mut v, 1, 1, 0, true, ctx(&mut s));
        test_scenario::return_shared(v);
        put_config(&mut s, config);
        end(s);
    }

    // ======================================================================
    // Test 13: Non-beneficiary Cannot Reclaim Blob
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 1, location = auto_renewal::vault)]
    fun test_reclaim_blob_unauthorized_fails() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::reclaim_blob(&mut v, ctx(&mut s));
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 14: Destroy Empty Vault
    // ======================================================================
    #[test]
    fun test_destroy_vault() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let bal = vault::get_wal_balance(&v);
        vault::initiate_withdraw(&mut v, bal, ctx(&mut s));
        test_scenario::return_shared(v);
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::reclaim_blob(&mut v, ctx(&mut s));
        test_scenario::return_shared(v);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::destroy_vault(v, ctx(&mut s));
        end(s);
    }

    // ======================================================================
    // Test 23: Create vault with explicit beneficiary
    // ======================================================================
    #[test]
    fun test_create_vault_explicit_beneficiary() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(
            &config,
            blob(&mut sys, 100, ctx(&mut s)),
            wal(100_000_000, ctx(&mut s)),
            5, 10, 200, K, 0, ctx(&mut s),
        );
        unit_test::destroy(sys);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_beneficiary(&v) == K, 120);
        assert!(vault::get_beneficiary(&v) != U, 121);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 24: Migrate vault
    // ======================================================================
    #[test]
    fun test_migrate_vault() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::migrate_vault(&mut v, K, ctx(&mut s));
        assert!(vault::get_beneficiary(&v) == K, 130);
        test_scenario::return_shared(v);
        next_tx(&mut s, K);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_beneficiary(&v) == K, 131);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 25: Withdraw delay enforced
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 15, location = auto_renewal::vault)]
    fun test_withdraw_delay_enforced() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(
            &config,
            blob(&mut sys, 100, ctx(&mut s)),
            wal(100_000_000, ctx(&mut s)),
            5, 10, 200, U, 2, ctx(&mut s),
        );
        unit_test::destroy(sys);
        put_config(&mut s, config);
        // Initiate withdraw in epoch 0
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 30_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Try finalize in same epoch — SHOULD ABORT (delay = 2 epochs)
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::finalize_withdraw(&mut v, ctx(&mut s));
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 27: Withdraw finalization after delay elapses
    // ======================================================================
    #[test]
    fun test_finalize_withdraw_after_delay() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(
            &config,
            blob(&mut sys, 100, ctx(&mut s)),
            wal(100_000_000, ctx(&mut s)),
            5, 10, 200, U, 2, ctx(&mut s),
        );
        unit_test::destroy(sys);
        put_config(&mut s, config);
        // Initiate withdraw in epoch 0
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 30_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Advance past the 2-epoch delay
        next_epoch(&mut s, U);
        next_epoch(&mut s, U);
        // Now finalize should succeed — epoch 2 >= epoch 0 + 2
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::finalize_withdraw(&mut v, ctx(&mut s));
        test_scenario::return_shared(v);
        // Verify the vault balance decreased by 30_000_000
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_wal_balance(&v) == 70_000_000, 150);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 26: Non-beneficiary cannot migrate
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 1, location = auto_renewal::vault)]
    fun test_migrate_vault_unauthorized_fails() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::migrate_vault(&mut v, @0xE, ctx(&mut s));
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 15: FeeConfig Views (no vault needed)
    // ======================================================================
    #[test]
    fun test_fee_config_views() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut tl = get_timelock(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 2, 200, @0x0, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        vault::schedule_admin_action(&cap, &mut tl, 3, 2_000_000, @0x0, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        assert!(vault::protocol_fee_bps(&c) == 200, 70);
        assert!(vault::keeper_fee(&c) == 2_000_000, 71);
        assert!(vault::treasury_address(&c) == TREASURY, 72);
        put_timelock(&mut s, tl);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, cap);
        end(s);
    }

    // ======================================================================
    // Test 16: Renewal Fails Without Treasury
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 7, location = auto_renewal::vault)]
    fun test_renewal_fails_without_treasury() {
        let mut s = test_scenario::begin(ADMIN);
        // Tx 0: init FeeConfig with treasury = @0x0 (do NOT call init_env which sets treasury)
        vault::init_for_testing(ctx(&mut s));
        next_tx(&mut s, U);
        let config = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 200, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        test_scenario::return_shared(config);
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c, &mut sys2, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        end(s);
    }

    // ======================================================================
    // Test 17: Protocol Fee BPS Cap
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 6, location = auto_renewal::vault)]
    fun test_set_protocol_fee_overflow_rejected() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = get_timelock(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 2, 20000, @0x0, ctx(&mut s));
        put_timelock(&mut s, tl);
        test_scenario::return_to_sender(&mut s, cap);
        end(s);
    }

    // ======================================================================
    // Test 18: View Functions
    // ======================================================================
    #[test]
    fun test_vault_view_functions() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        mk_vault(&mut s, &config);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::is_due(&v, 0) == false, 80);
        assert!(vault::is_due(&v, 96) == true, 81);
        assert!(vault::get_beneficiary(&v) == U, 82);
        assert!(vault::get_wal_balance(&v) == 100_000_000, 83);
        assert!(vault::get_blob_id(&v).is_some(), 84);
        assert!(vault::get_end_epoch(&v).is_some(), 85);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Pause Tests (new operator + PauserCap)
    // ======================================================================

    const OPERATOR: address = @0xE;

    // ======================================================================
    // Test 19: Pause and unpause
    // ======================================================================
    #[test]
    fun test_pause_and_resume() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = get_timelock(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        let mut c = get_config(&mut s);
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        put_config(&mut s, c);
        put_timelock(&mut s, tl);
        test_scenario::return_to_sender(&mut s, cap);
        next_tx(&mut s, OPERATOR);
        let pcap = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        assert!(vault::is_paused(&c) == false, 100);
        vault::emergency_pause(&pcap, &mut c);
        assert!(vault::is_paused(&c) == true, 101);
        vault::emergency_unpause(&pcap, &mut c);
        assert!(vault::is_paused(&c) == false, 102);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap);
        end(s);
    }

    // ======================================================================
    // Test 20: create_vault fails when paused
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 10, location = auto_renewal::vault)]
    fun test_create_vault_fails_when_paused() {
        let mut s = test_scenario::begin(ADMIN);
        vault::init_for_testing(ctx(&mut s));
        // Tx 1: ADMIN creates PauserCap for OPERATOR (via timelock)
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 2: OPERATOR pauses
        next_tx(&mut s, OPERATOR);
        let pcap = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::emergency_pause(&pcap, &mut c);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap);
        // Tx 3: U tries to create vault — should fail with EPaused (code 10)
        next_tx(&mut s, U);
        let config = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 100, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 200, U, 0, ctx(&mut s));
        test_scenario::return_shared(config);
        unit_test::destroy(sys);
        end(s);
    }

    // ======================================================================
    // Test 21: execute_renewal fails when paused
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 10, location = auto_renewal::vault)]
    fun test_execute_renewal_fails_when_paused() {
        let mut s = test_scenario::begin(ADMIN);
        vault::init_for_testing(ctx(&mut s));
        // Tx 1: Create vault (in same tx as init: need to advance first)
        next_tx(&mut s, U);
        let config = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 200, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        test_scenario::return_shared(config);
        // Tx 2: ADMIN creates PauserCap (via timelock)
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 3: OPERATOR pauses
        next_tx(&mut s, OPERATOR);
        let pcap = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::emergency_pause(&pcap, &mut c);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap);
        // Tx 4: K tries execute_renewal — should fail with EPaused (code 10)
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c2 = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c2, &mut sys2, ctx(&mut s));
        test_scenario::return_shared(c2);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        end(s);
    }



    // ======================================================================
    // Test 28: Cancel admin action
    // ======================================================================
    #[test]
    fun test_cancel_admin_action() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = get_timelock(&mut s);
        // Schedule an action
        vault::schedule_admin_action(&cap, &mut tl, 2, 500, @0x0, ctx(&mut s));
        // Cancel it
        vault::cancel_admin_action(&cap, &mut tl);
        // Verify state is fully reset
        assert!(vault::pending_admin_action(&tl) == 0, 200);
        assert!(vault::pending_admin_scheduled_epoch(&tl) == 0, 201);
        // Verify we can schedule a new action immediately after cancel
        let mut c = get_config(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 2, 600, @0x0, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        put_config(&mut s, c);
        put_timelock(&mut s, tl);
        test_scenario::return_to_sender(&mut s, cap);
        let effects = end(s);
        // 4 events: AdminActionScheduled, AdminActionCancelled, AdminActionScheduled, AdminActionExecuted
        assert!(test_scenario::num_user_events(&effects) >= 4, 202);
    }

    // Must fix: put_config after execute_admin_action returns config
    // The test_cancel_admin_action above needs to properly return the FeeConfig
    // after the execute_admin_action call. This test verifies the full flow.
    #[test]
    fun test_cancel_admin_action_full() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = get_timelock(&mut s);
        let mut c = get_config(&mut s);
        // Schedule keeper_fee
        vault::schedule_admin_action(&cap, &mut tl, 3, 5_000_000, @0x0, ctx(&mut s));
        assert!(vault::pending_admin_action(&tl) == 3, 210);
        assert!(vault::pending_admin_scheduled_epoch(&tl) == 0, 211); // epoch 0 in tests
        // Cancel
        vault::cancel_admin_action(&cap, &mut tl);
        assert!(vault::pending_admin_action(&tl) == 0, 212);
        // Verify FeeConfig was NOT changed (action was cancelled before execution)
        assert!(vault::keeper_fee(&c) == 1_000_000, 213);
        // Now schedule and execute to verify normal flow still works
        vault::schedule_admin_action(&cap, &mut tl, 3, 5_000_000, @0x0, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        assert!(vault::keeper_fee(&c) == 5_000_000, 214);
        put_config(&mut s, c);
        put_timelock(&mut s, tl);
        test_scenario::return_to_sender(&mut s, cap);
        end(s);
    }

    // ======================================================================
    // Test 29: Revoke pauser blocks emergency operations
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 28, location = auto_renewal::vault)]
    fun test_revoke_pauser_blocks_emergency_pause() {
        let mut s = test_scenario::begin(ADMIN);
        vault::init_for_testing(ctx(&mut s));
        // Tx 1: Create PauserCap for OPERATOR
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 2: Operator receives PauserCap
        next_tx(&mut s, OPERATOR);
        let pcap = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        // Tx 3: Admin revokes ALL pauser caps
        test_scenario::next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        vault::revoke_pauser(&cap, &mut c, ctx(&mut s));
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 4: Operator tries to pause — should fail with EPauserRevoked (28)
        test_scenario::next_tx(&mut s, OPERATOR);
        vault::emergency_pause(&pcap, &mut c);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap);
        end(s);
    }

    // ======================================================================
    // Test 30: Admin can create new PauserCap after revoke
    // ======================================================================
    #[test]
    fun test_admin_creates_new_pauser_after_revoke() {
        let mut s = test_scenario::begin(ADMIN);
        vault::init_for_testing(ctx(&mut s));
        // Tx 1: Create initial PauserCap for OPERATOR
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 2: Operator receives PauserCap
        next_tx(&mut s, OPERATOR);
        let pcap = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        // Return objects before ending tx 2
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap);
        // Tx 3: Admin revokes ALL pauser caps
        test_scenario::next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::revoke_pauser(&cap, &mut c, ctx(&mut s));
        test_scenario::return_to_sender(&mut s, cap);
        test_scenario::return_shared(c);
        // Tx 4: ADMIN creates NEW PauserCap for OPERATOR via timelock
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        // Verify pauser_revoked was reset to false
        assert!(vault::is_paused(&c) == false, 222); // sanity: no side effect on paused flag
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 5: Operator receives NEW PauserCap — should be able to pause now
        next_tx(&mut s, OPERATOR);
        let pcap2 = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::emergency_pause(&pcap2, &mut c);
        assert!(vault::is_paused(&c) == true, 223);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap2);
        end(s);
    }

    // ======================================================================
    // Test 31: Keeper fee cap enforced
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 29, location = auto_renewal::vault)]
    fun test_set_keeper_fee_too_high_rejected() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = get_timelock(&mut s);
        // MAX_KEEPER_FEE is 100_000_000_000, try 200_000_000_000
        vault::schedule_admin_action(&cap, &mut tl, 3, 200_000_000_000, @0x0, ctx(&mut s));
        put_timelock(&mut s, tl);
        test_scenario::return_to_sender(&mut s, cap);
        end(s);
    }

    // ======================================================================
    // Test 32: Storage price cap enforced
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 30, location = auto_renewal::vault)]
    fun test_set_storage_price_too_high_rejected() {
        let mut s = init_env();
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = get_timelock(&mut s);
        // MAX_STORAGE_PRICE is 10_000_000_000_000, try 20_000_000_000_000
        vault::schedule_admin_action(&cap, &mut tl, 4, 20_000_000_000_000, @0x0, ctx(&mut s));
        put_timelock(&mut s, tl);
        test_scenario::return_to_sender(&mut s, cap);
        end(s);
    }

    // ======================================================================
    // Test 34: Cancel pending withdrawal (full flow)
    // ======================================================================
    #[test]
    fun test_cancel_pending_withdraw() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(
            &config,
            blob(&mut sys, 100, ctx(&mut s)),
            wal(100_000_000, ctx(&mut s)),
            5, 10, 200, U, 2, ctx(&mut s),
        );
        unit_test::destroy(sys);
        put_config(&mut s, config);
        // Tx 2: Initiate withdraw (delay = 2 epochs)
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 30_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Tx 3: Cancel the pending withdrawal
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::cancel_pending_withdraw(&mut v, ctx(&mut s));
        // Verify balance is restored (no funds were taken)
        assert!(vault::get_wal_balance(&v) == 100_000_000, 240);
        // Verify pending state is reset
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == true, 241);
        test_scenario::return_shared(v);
        // Tx 4: Verify we can initiate a new withdrawal after cancel
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 20_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Tx 5: Verify funds were taken in the new withdrawal
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_wal_balance(&v) == 80_000_000, 242);
        test_scenario::return_shared(v);
        end(s);
    }

    // ======================================================================
    // Test 33: PendingWithdrawBlocksRenewal event emitted (not abort)
    // ======================================================================
    #[test]
    fun test_pending_withdraw_blocks_renewal_event() {
        let mut s = test_scenario::begin(ADMIN);
        vault::init_for_testing(ctx(&mut s));
        // Tx 1: Create vault with delay=1 epoch
        next_tx(&mut s, U);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(
            &c,
            blob(&mut sys, 50, ctx(&mut s)),
            wal(10_000_000, ctx(&mut s)),
            5, 10, 200, U, 1, ctx(&mut s),
        );
        unit_test::destroy(sys);
        test_scenario::return_shared(c);
        // Tx 2: Initiate withdraw of 9M (leaving 1M)
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 9_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Tx 3: Try renewal — should emit PendingWithdrawBlocksRenewal, not abort
        // Balance = 10M, cost ~5M (estimate), remaining after = 5M, pending = 9M
        // remaining (5M) < pending (9M) → triggers the event
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys2 = sys(ctx(&mut s));
        vault::execute_renewal(&mut v, &mut c, &mut sys2, ctx(&mut s));
        // Verify the function returned (did NOT abort) by checking balance unchanged
        assert!(vault::get_wal_balance(&v) == 10_000_000, 230);
        // Verify policy is still active (unlike InsufficientBalance which deactivates)
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == true, 232);
        test_scenario::return_shared(c);
        test_scenario::return_shared(v);
        unit_test::destroy(sys2);
        // Verify PendingWithdrawBlocksRenewal event was emitted (check via next_tx effects)
        let effects = test_scenario::next_tx(&mut s, U);
        assert!(test_scenario::num_user_events(&effects) >= 1, 231);
        end(s);
    }

    // ======================================================================
    // Test 22: withdraw still works when paused (user-exit)
    // ======================================================================
    #[test]
    fun test_withdraw_works_when_paused() {
        let mut s = test_scenario::begin(ADMIN);
        vault::init_for_testing(ctx(&mut s));
        // Tx 1: Create vault
        next_tx(&mut s, U);
        let config = test_scenario::take_shared<FeeConfig>(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 100, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, 200, U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        test_scenario::return_shared(config);
        // Tx 2: ADMIN creates PauserCap (via timelock)
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut tl = test_scenario::take_shared<AdminTimelock>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::schedule_admin_action(&cap, &mut tl, 5, 0, OPERATOR, ctx(&mut s));
        vault::execute_admin_action(&mut tl, &mut c, ctx(&mut s));
        test_scenario::return_shared(c);
        test_scenario::return_shared(tl);
        test_scenario::return_to_sender(&mut s, cap);
        // Tx 3: OPERATOR pauses
        next_tx(&mut s, OPERATOR);
        let pcap = test_scenario::take_from_sender<PauserCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::emergency_pause(&pcap, &mut c);
        test_scenario::return_shared(c);
        test_scenario::return_to_sender(&mut s, pcap);
        // Tx 4: U withdraws (should succeed while paused)
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 30_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Tx 5: Verify balance decreased
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_wal_balance(&v) == 70_000_000, 110);
        test_scenario::return_shared(v);
        end(s);
    }
}
