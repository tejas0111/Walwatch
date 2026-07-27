# Walwatch — Testnet Dry Run Plan

## Objectives
1. Validate end-to-end flow: create vault → deposit → execute renewal
2. Verify keeper operates correctly against testnet
3. Confirm API ↔ contract integration
4. Gather real performance metrics

## Prerequisites
- [ ] Keeper private key funded with testnet SUI and WAL
- [ ] API server running with testnet configuration
- [ ] Test Walrus blob created and available
- [ ] Monitor dashboard accessible

## Test Scenarios
### 1. Vault Creation
- [ ] Create vault with valid blob + WAL deposit
- [ ] Verify VaultCreated event
- [ ] Verify vault appears in scanner's findDueVaults()

### 2. Deposit
- [ ] Deposit additional WAL into existing vault
- [ ] Verify balance update
- [ ] Verify Deposited event

### 3. Renewal Execution
- [ ] Set threshold high enough to trigger immediate renewal
- [ ] Wait for keeper cycle (up to 2 min)
- [ ] Verify RenewalExecuted event
- [ ] Verify blob end_epoch increased
- [ ] Verify keeper fee paid

### 4. Policy Management
- [ ] Update policy fields
- [ ] Verify PolicyUpdated event
- [ ] Pause and resume policy

### 5. Withdraw and Reclaim
- [ ] Beneficiary withdraws WAL
- [ ] Beneficiary reclaims blob
- [ ] Verify blob transferred back

### 6. Edge Cases
- [ ] Execute renewal with insufficient balance → InsufficientBalance event
- [ ] Execute renewal at max_total_epochs cap → PolicyExhausted
- [ ] Non-beneficiary attempts withdraw → abort
- [ ] Multi-instance keeper leader election

## Success Criteria
- [ ] All test scenarios pass
- [ ] Keeper successfully executes 10+ renewals autonomously
- [ ] API queries return correct vault state
- [ ] No unexpected aborts or errors
