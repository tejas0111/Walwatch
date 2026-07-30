#!/usr/bin/env node

/**
 * Comprehensive End-to-End Test
 *
 * Tests ALL flows:
 *   1. API: register, login, /me, key export
 *   2. On-chain: create vault, deposit, withdraw, renew (via keeper call)
 *   3. Contract-backend sync: ensure API returns correct vault/policy data
 *
 * Usage:
 *   node scripts/e2e-full-test.mjs
 *
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Sui testnet keypair with SUI + WAL balance
 *   - Contract deployed to testnet
 */

import { CoreClient as SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';
import { bech32 } from '@scure/base';
import { WalrusClient } from '@mysten/walrus';

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const API_URL = process.env.API_URL || 'http://localhost:3001';
const SUI_RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7';
const WAL_COIN_TYPE = process.env.WAL_COIN_TYPE ?? '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL';
const FEE_CONFIG_ID = process.env.FEE_CONFIG_ID ?? '0xc8f14c361bfffdfde60054daf5101da382e39d0bf655131fb4b6de69b12f6d40';
const SYSTEM_OBJECT_ID = process.env.SYSTEM_OBJECT_ID ?? '0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af';
const GAS_BUDGET = Number(process.env.GAS_BUDGET ?? 10_000_000);

let PASS = 0, FAIL = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    PASS++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    FAIL++;
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ──────────────────────────────────────────────
// Keypair
// ──────────────────────────────────────────────

function loadKeypair() {
  const keyStr = process.env.SUI_PRIVATE_KEY;
  if (!keyStr) throw new Error('SUI_PRIVATE_KEY not set');
  let seed;
  if (keyStr.startsWith('suiprivkey')) {
    const decoded = bech32.decodeToBytes(keyStr);
    seed = decoded.bytes.slice(1);
  } else {
    seed = fromBase64(keyStr);
    seed = seed.byteLength === 33 ? seed.slice(1) : seed;
  }
  return Ed25519Keypair.fromSecretKey(seed);
}

// ──────────────────────────────────────────────
// API helpers
// ──────────────────────────────────────────────

async function apiGet(path, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ──────────────────────────────────────────────
// On-chain helpers
// ──────────────────────────────────────────────

async function waitForTx(client, digest, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    const tx = await client.getTransactionBlock({
      digest,
      options: { showEffects: true, showObjectChanges: true, showEvents: true },
    });
    if (tx.effects?.status) return tx;
    await delay(2000);
  }
  throw new Error(`Tx ${digest} not confirmed after ${maxRetries * 2}s`);
}

function formatWAL(amount) {
  const d = 1_000_000_000n;
  return `${amount / d}.${(amount % d).toString().padStart(9, '0')}`;
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  WALWATCH COMPREHENSIVE E2E TEST');
  console.log('═══════════════════════════════════════════════════\n');

  // ── PHASE 0: Setup ───────────────────────────
  console.log('── Phase 0: Prerequisites ──\n');

  // Check API health
  const health = await apiGet('/api/v1');
  assert('API reachable', health.status === 200 || health.status === 404,
    `Got ${health.status}`);

  const apiHealth = await apiGet('/health');
  assert('Health endpoint', apiHealth.status === 200,
    `Got ${apiHealth.status}: ${JSON.stringify(apiHealth.body)}`);

  // Load keypair for on-chain ops
  let keypair, sender;
  try {
    keypair = loadKeypair();
    sender = keypair.toSuiAddress();
    assert(`On-chain signer loaded: ${sender.slice(0, 10)}...`, !!sender);
  } catch (e) {
    assert('Load keypair', false, e.message);
    console.log('\n⚠ Cannot continue without SUI_PRIVATE_KEY for on-chain ops\n');
  }

  const client = new SuiClient({ url: SUI_RPC_URL });
  const walrusClient = new WalrusClient({ network: 'testnet' });

  // Check balances (skip if no keypair available)
  if (sender && keypair) {
    const [suiCoins, walCoins] = await Promise.all([
      client.getCoins({ owner: sender, coinType: '0x2::sui::SUI' }),
      client.getCoins({ owner: sender, coinType: WAL_COIN_TYPE }),
    ]);
    const suiBal = suiCoins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
    const walBal = walCoins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
    console.log(`  SUI: ${formatWAL(suiBal)} SUI | WAL: ${formatWAL(walBal)} WAL\n`);
  }

  // ── PHASE 1: API Authentication ──────────────
  console.log('── Phase 1: API Authentication ──\n');

  const testEmail = `e2e-test-${Date.now()}@walwatch.test`;
  const testPass = 'TestPass123!';

  // Register
  const reg = await apiPost('/api/v1/auth/register', {
    email: testEmail, password: testPass, name: 'E2E Test User'
  });
  assert('1a. Register new user', reg.status === 201, JSON.stringify(reg.body));
  const userId = reg.body?.user?.id;
  const authToken = reg.body?.token;
  assert('1b. Got auth token', !!authToken);

  // /me endpoint
  const me = await apiGet('/api/v1/auth/me', authToken);
  assert('1c. GET /me', me.status === 200 && me.body?.user?.email === testEmail,
    JSON.stringify(me.body));
  assert('1d. /me returns correct email', me.body?.user?.email === testEmail);

  // Login
  const login = await apiPost('/api/v1/auth/login', {
    email: testEmail, password: testPass
  });
  assert('1e. Login', login.status === 200, JSON.stringify(login.body));
  assert('1f. Login returns token', !!login.body?.token);

  // Duplicate register
  const dupReg = await apiPost('/api/v1/auth/register', {
    email: testEmail, password: testPass
  });
  assert('1g. Duplicate register rejected', dupReg.status === 409,
    dupReg.body?.error?.message);

  // Invalid login
  const badLogin = await apiPost('/api/v1/auth/login', {
    email: testEmail, password: 'WrongPass1!'
  });
  assert('1h. Wrong password rejected', badLogin.status === 401);

  // ── PHASE 2: Key Export (requires re-auth) ──
  console.log('\n── Phase 2: Key Export ──\n');

  // With a fresh token (auth_time within 15 min), key export should work
  const keyExport = await apiGet('/api/v1/keys/export', authToken);
  // Without zkLogin, this should return 404 (no zkLogin keys)
  assert('2a. GET /keys/export returns 404 (no zklogin keys)',
    keyExport.status === 404,
    JSON.stringify(keyExport.body));
  // The error message should explain
  assert('2b. Clear error message',
    keyExport.body?.error?.message?.includes('zkLogin'),
    JSON.stringify(keyExport.body));

  // ── PHASE 3: Vault API Operations ───────────
  console.log('\n── Phase 3: Vault API (authorization check) ──\n');

  // Vault endpoints require X-Org-Id header — without it, expect 403
  const vaultsList = await apiGet('/api/v1/vaults', authToken);
  assert('3. Vault list without X-Org-Id returns 403',
    vaultsList.status === 403,
    `Got ${vaultsList.status}: ${JSON.stringify(vaultsList.body).slice(0, 100)}`);

  // ── PHASE 4: On-Chain E2E ───────────────────
  console.log('\n── Phase 4: On-Chain Vault Lifecycle ──\n');

  if (keypair && sender) {
    // 4a. Create Walrus blob
    console.log('  4a. Creating Walrus blob...');
    const blobContent = `E2E test blob — ${new Date().toISOString()}`;
    const blobBytes = new TextEncoder().encode(blobContent);
    const { totalCost } = await walrusClient.storageCost(blobBytes.byteLength, 30);
    console.log(`     Size: ${blobBytes.byteLength} bytes | Cost: ${formatWAL(totalCost)} WAL`);

    let blobId, blobObjectId;
    try {
      const result = await walrusClient.writeBlob({
        blob: blobBytes, deletable: false, epochs: 30,
        signer: keypair, owner: sender,
      });
      blobId = result.blobId;
      blobObjectId = result.blobObject.id.id;
      assert('4a. Blob created', !!blobId, `blobId: ${blobId}`);
    } catch(e) {
      assert('4a. Blob creation', false, e.message);
    }

    if (blobId) {
      // 4b. Create vault
      console.log('  4b. Creating vault...');
      const tx = new Transaction();
      const updatedWalCoins = await client.getCoins({ owner: sender, coinType: WAL_COIN_TYPE });
      const primaryCoinId = updatedWalCoins.data[0]?.coinObjectId;

      if (primaryCoinId) {
        const depositAmount = 1_000_000_000n; // 1 WAL
        const primary = tx.object(primaryCoinId);
        tx.moveCall({
          target: `${PACKAGE_ID}::vault::create_vault`,
          arguments: [
            tx.object(FEE_CONFIG_ID),
            tx.object(blobObjectId),
            tx.splitCoins(primary, [tx.pure.u64(depositAmount)])[0],
            tx.pure.u64(5),       // threshold
            tx.pure.u64(10),      // renew_by
            tx.pure.u64(100),     // max_total_epochs
            tx.pure.address(sender),
            tx.pure.u64(3),       // withdraw_delay_epochs
          ],
        });
        tx.setSender(sender);
        tx.setGasBudget(GAS_BUDGET * 2);

        try {
          const vaultResult = await client.signAndExecuteTransaction({
            signer: keypair, transaction: tx,
            options: { showEffects: true, showObjectChanges: true, showEvents: true },
          });
          const vaultTx = await waitForTx(client, vaultResult.digest);
          assert('4b. Vault creation succeeded',
            vaultTx.effects?.status?.status === 'success',
            vaultTx.effects?.status?.error);

          // Find vault ID
          const vaultChange = vaultTx.objectChanges?.find(
            c => c.type === 'created' && c.objectType.includes('RenewalVault')
          );
          const vaultId = vaultChange?.objectId;
          assert('4b. Vault ID found', !!vaultId);

          if (vaultId) {
            // 4c. Verify vault on chain
            const vaultObj = await client.getObject({
              id: vaultId, options: { showContent: true }
            });
            const fields = vaultObj.data?.content?.fields;
            assert('4c. Vault exists on-chain', !!fields);
            if (fields) {
              assert('4c. Beneficiary matches', fields.beneficiary === sender);
              assert('4c. Blob present', fields.blob?.vec?.length > 0);
              assert('4c. Policy active', fields.policy?.fields?.active === true);
              assert('4c. Threshold = 5', fields.policy?.fields?.renew_threshold_epochs === 5);
            }

            // 4d. Deposit more WAL
            console.log('  4d. Depositing WAL...');
            const depositTx = new Transaction();
            const walCoinsAfter = await client.getCoins({ owner: sender, coinType: WAL_COIN_TYPE });
            if (walCoinsAfter.data[0]) {
          const coinArg = depositTx.object(walCoinsAfter.data[0].coinObjectId);
          depositTx.moveCall({
            target: `${PACKAGE_ID}::vault::deposit`,
            arguments: [
              depositTx.object(FEE_CONFIG_ID),
              depositTx.object(vaultId),
              depositTx.splitCoins(coinArg, [depositTx.pure.u64(500_000_000)])[0],
            ],
              });
              depositTx.setSender(sender);
              depositTx.setGasBudget(GAS_BUDGET);
              try {
                const depositResult = await client.signAndExecuteTransaction({
                  signer: keypair, transaction: depositTx,
                  options: { showEffects: true },
                });
                const depositTxn = await waitForTx(client, depositResult.digest);
                assert('4d. Deposit succeeded',
                  depositTxn.effects?.status?.status === 'success',
                  depositTxn.effects?.status?.error);
              } catch(e) {
                assert('4d. Deposit', false, e.message);
              }
            }

            // 4e. Initiate withdraw (using withdraw_delay_epochs=0 for immediate settlement)
            // Since the vault was created with withdraw_delay_epochs=3, first verify pending state
            console.log('  4e. Initiating withdraw (delayed)...');
            const withdrawTx = new Transaction();
            withdrawTx.moveCall({
              target: `${PACKAGE_ID}::vault::initiate_withdraw`,
              arguments: [
                withdrawTx.object(vaultId),
                withdrawTx.pure.u64(100_000_000),
              ],
            });
            withdrawTx.setSender(sender);
            withdrawTx.setGasBudget(GAS_BUDGET);
            try {
              const withdrawResult = await client.signAndExecuteTransaction({
                signer: keypair, transaction: withdrawTx,
                options: { showEffects: true, showObjectChanges: true },
              });
              const withdrawTxn = await waitForTx(client, withdrawResult.digest);
              assert('4e. initiate_withdraw succeeded (pending)',
                withdrawTxn.effects?.status?.status === 'success',
                withdrawTxn.effects?.status?.error);
              // Verify pending state
              const vAfter = await client.getObject({
                id: vaultId, options: { showContent: true }
              });
              const pendingAmt = vAfter.data?.content?.fields?.pending_withdraw_amount;
              assert('4e. Pending withdraw recorded', Number(pendingAmt) > 0,
                `pending: ${pendingAmt}`);
            } catch(e) {
              assert('4e. initiate_withdraw', false, e.message);
            }

            // 4f. Cancel pending withdraw (to allow cleanup)
            console.log('  4f. Cancelling pending withdraw...');
            const cancelTx = new Transaction();
            cancelTx.moveCall({
              target: `${PACKAGE_ID}::vault::cancel_pending_withdraw`,
              arguments: [cancelTx.object(vaultId)],
            });
            cancelTx.setSender(sender);
            cancelTx.setGasBudget(GAS_BUDGET);
            try {
              const cancelResult = await client.signAndExecuteTransaction({
                signer: keypair, transaction: cancelTx,
                options: { showEffects: true },
              });
              const cancelTxn = await waitForTx(client, cancelResult.digest);
              assert('4f. Cancel withdraw succeeded',
                cancelTxn.effects?.status?.status === 'success',
                cancelTxn.effects?.status?.error);
            } catch(e) {
              assert('4f. Cancel withdraw', false, e.message);
            }

            // 4g. Attempt execute_renewal (expected to fail — blob not yet due)
            // This validates the contract function is reachable and the error path works.
            console.log('  4g. Attempting renewal (expected to fail - not due)...');
            const renewTx = new Transaction();
            renewTx.moveCall({
              target: `${PACKAGE_ID}::vault::execute_renewal`,
              arguments: [
                renewTx.object(vaultId),
                renewTx.object(FEE_CONFIG_ID),
                renewTx.object(SYSTEM_OBJECT_ID),
              ],
            });
            renewTx.setSender(sender);
            renewTx.setGasBudget(GAS_BUDGET);
            try {
              const renewResult = await client.signAndExecuteTransaction({
                signer: keypair, transaction: renewTx,
                options: { showEffects: true },
              });
              const renewTxBlock = await waitForTx(client, renewResult.digest);
              // Blob end_epoch is current+30, threshold is 5, current+5 < current+30, so not due
              // Expected: status = 'failure' with Move abort code 3 (ENotDueForRenewal)
              const status = renewTxBlock.effects?.status;
              assert('4g. Renewal correctly fails (not due)',
                status?.status === 'failure',
                JSON.stringify(status));
              
              // Check error contains "3" (the Move abort code for ENotDueForRenewal)
              const errMsg = status?.error || '';
              assert('4g. Error is MoveAbort code 3 (ENotDueForRenewal)',
                errMsg.includes('MoveAbort') && errMsg.includes('3'),
                `Error: ${errMsg}`);
            } catch(e) {
              assert('4g. Renewal attempt', false, e.message);
            }

            // Note: finalize_withdraw is not tested here because it requires advancing
            // Sui epochs on testnet (which is impractical in an automated script).
            // The Move contract test suite (contracts/tests/vault_tests.move) covers
            // the full pending-withdraw → finalize flow via test_scenario::next_epoch.

            // 4h. Check FeeConfig
            console.log('  4h. Checking FeeConfig...');
            const feeConfigObj = await client.getObject({
              id: FEE_CONFIG_ID, options: { showContent: true }
            });
            const feeFields = feeConfigObj.data?.content?.fields;
            if (feeFields) {
              assert('4h. FeeConfig treasury set',
                feeFields.treasury && feeFields.treasury !== '@0x0');
              assert('4h. Protocol fee within bounds',
                Number(feeFields.protocol_fee_bps) <= 10000);
              assert('4h. Keeper fee set', Number(feeFields.keeper_fee) > 0);
              // pauser_revoked field only exists after contract v3→v4 upgrade.
              // Gracefully handle pre-upgrade contracts.
              if ('pauser_revoked' in feeFields) {
                assert('4h. FeeConfig has pauser_revoked (v4 contract)', true);
              } else {
                console.log('  ℹ️  pauser_revoked not present — pre-upgrade contract (v3)');
              }
            }
          }
        } catch(e) {
          assert('4b-4e. On-chain operations', false, e.message);
        }
      } else {
        assert('4b. WAL coins available', false, 'No WAL coins found');
      }
    }
  } else {
    console.log('  ⏭ Skipping on-chain tests (SUI_PRIVATE_KEY not provided)\n');
  }

  // ── SUMMARY ──────────────────────────────────
  const total = PASS + FAIL;
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  RESULTS: ${PASS}/${total} passed, ${FAIL}/${total} failed`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n  ❌ E2E Test crashed:', err.message);
  process.exit(1);
});
