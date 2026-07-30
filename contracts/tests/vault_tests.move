// === Auto-Renewal Vault — Test Suite ===

#[test_only]
module auto_renewal::vault_tests {

    use sui::test_scenario::{Self, ctx, next_tx, end};
    use sui::coin::{Self, Coin};
    use sui::tx_context::TxContext;
    use std::unit_test;
    use wal::wal::WAL;
    use walrus::system::{Self, System};
    use walrus::blob::Blob;
    use auto_renewal::vault::{Self, RenewalVault, FeeConfig, AdminCap, PauserCap};

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
        // Tx 0: manually init FeeConfig + AdminCap
        vault::init_for_testing(ctx(&mut s));
        // Advance to tx 1: now take AdminCap + FeeConfig to set treasury
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::set_treasury(&cap, &mut c, TREASURY);
        test_scenario::return_shared(c);
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
    fun put_config(s: &mut test_scenario::Scenario, config: FeeConfig) {
        test_scenario::return_shared(config);
    }

    /// Create a vault in the CURRENT tx. Caller must be in right sender tx.
    fun mk_vault(s: &mut test_scenario::Scenario, config: &FeeConfig) {
        let mut sys = sys(ctx(s));
        vault::create_vault(
            config,
            blob(&mut sys, 100, ctx(s)),
            wal(100_000_000, ctx(s)),
            5, 10, option::none(), U, 0, ctx(s),
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
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_beneficiary(&v) == U, 1);
        assert!(vault::get_wal_balance(&v) == 100_000_000, 2);
        assert!(vault::has_blob(&v) == true, 3);
        assert!(vault::policy_renew_threshold(&vault::get_policy(&v)) == 5, 4);
        assert!(vault::policy_renew_by(&vault::get_policy(&v)) == 10, 5);
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == true, 6);
        assert!(vault::policy_max_epochs(&vault::get_policy(&v)).is_none(), 7);
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
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::has_blob(&v) == false, 30);
        assert!(vault::policy_is_active(&vault::get_policy(&v)) == false, 31);
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
        vault::update_policy_fields(&config, &mut v, 3, 20, option::some(200), true, ctx(&mut s));
        test_scenario::return_shared(v);
        put_config(&mut s, config);
        next_tx(&mut s, U);
        let v = test_scenario::take_shared<RenewalVault>(&mut s);
        let p = vault::get_policy(&v);
        assert!(vault::policy_renew_threshold(&p) == 3, 40);
        assert!(vault::policy_renew_by(&p) == 20, 41);
        assert!(*vault::policy_max_epochs(&p).borrow() == 200, 42);
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
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
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
        vault::update_policy_fields(&config, &mut v, 5, 10, option::none(), false, ctx(&mut s));
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
        vault::create_vault(&config, blob(&mut sys, 200, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
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
    // Test 10: Insufficient Balance
    // ======================================================================
    #[test]
    #[expected_failure(abort_code = 4, location = auto_renewal::vault)]
    fun test_execute_renewal_insufficient_balance() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(1_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
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
    // Test 11: max_total_epochs Cap
    // ======================================================================
    #[test]
    fun test_execute_renewal_cap_reached() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::some(55), U, 0, ctx(&mut s));
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
        vault::update_policy_fields(&config, &mut v, 1, 1, option::none(), true, ctx(&mut s));
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
            5, 10, option::none(), K, 0, ctx(&mut s),
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
    fun test_withdraw_delay_enforced() {
        let mut s = init_env();
        next_tx(&mut s, U);
        let config = get_config(&mut s);
        let mut sys = sys(ctx(&mut s));
        vault::create_vault(
            &config,
            blob(&mut sys, 100, ctx(&mut s)),
            wal(100_000_000, ctx(&mut s)),
            5, 10, option::none(), U, 2, ctx(&mut s),
        );
        unit_test::destroy(sys);
        put_config(&mut s, config);
        // Initiate withdraw in same epoch 0
        next_tx(&mut s, U);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        vault::initiate_withdraw(&mut v, 30_000_000, ctx(&mut s));
        test_scenario::return_shared(v);
        // Try finalize in same epoch — should fail (delay = 2 epochs)
        next_tx(&mut s, K);
        let mut v = test_scenario::take_shared<RenewalVault>(&mut s);
        assert!(vault::get_wal_balance(&v) == 100_000_000, 140);
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
        vault::set_protocol_fee_bps(&cap, &mut c, 200);
        vault::set_keeper_fee(&cap, &mut c, 2_000_000);
        assert!(vault::protocol_fee_bps(&c) == 200, 70);
        assert!(vault::keeper_fee(&c) == 2_000_000, 71);
        assert!(vault::treasury_address(&c) == TREASURY, 72);
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
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
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
        let mut c = test_scenario::take_shared<FeeConfig>(&mut s);
        vault::set_protocol_fee_bps(&cap, &mut c, 20000);
        test_scenario::return_shared(c);
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
        vault::create_pauser_cap(&cap, OPERATOR, ctx(&mut s));
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
        // Tx 1: ADMIN creates PauserCap for OPERATOR
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        vault::create_pauser_cap(&cap, OPERATOR, ctx(&mut s));
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
        vault::create_vault(&config, blob(&mut sys, 100, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
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
        vault::create_vault(&config, blob(&mut sys, 50, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        test_scenario::return_shared(config);
        // Tx 2: ADMIN creates PauserCap
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        vault::create_pauser_cap(&cap, OPERATOR, ctx(&mut s));
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
        vault::create_vault(&config, blob(&mut sys, 100, ctx(&mut s)), wal(100_000_000, ctx(&mut s)), 5, 10, option::none(), U, 0, ctx(&mut s));
        unit_test::destroy(sys);
        test_scenario::return_shared(config);
        // Tx 2: ADMIN creates PauserCap
        next_tx(&mut s, ADMIN);
        let cap = test_scenario::take_from_sender<AdminCap>(&mut s);
        vault::create_pauser_cap(&cap, OPERATOR, ctx(&mut s));
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
