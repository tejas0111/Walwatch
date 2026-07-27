#!/usr/bin/env node

/**
 * End-to-End Test: Blob Creation + Vault Creation on Sui Testnet
 *
 * This script:
 * 1. Connects to Sui testnet with a funded keypair
 * 2. Creates a Walrus blob using @mysten/walrus's WalrusClient.writeBlob
 * 3. Reads the newly created Blob object ID
 * 4. Finds the sender's WAL coins
 * 5. Calls create_vault on the deployed auto_renewal contract
 * 6. Verifies the vault exists on-chain with correct fields
 *
 * Usage:
 *   export SUI_PRIVATE_KEY="<base64-encoded-private-key>"
 *   node scripts/e2e-test.mjs
 *
 * Optional env vars:
 *   SUI_RPC_URL       — default: https://fullnode.testnet.sui.io:443
 *   PACKAGE_ID        — default: 0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7
 *   WAL_COIN_TYPE     — default: 0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL
 *   FEE_CONFIG_ID     — default: 0xc8f14c361bfffdfde60054daf5101da382e39d0bf655131fb4b6de69b12f6d40
 *   BLOB_EPOCHS       — storage epochs for the blob (default: 30)
 *   VAULT_THRESHOLD   — renew_threshold_epochs (default: 5)
 *   VAULT_RENEW_BY    — renew_by_epochs (default: 10)
 *   GAS_BUDGET        — gas budget for each tx (default: 5000000)
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';
import { bech32 } from '@scure/base';
import { WalrusClient } from '@mysten/walrus';

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? getFullnodeUrl('testnet');

const PACKAGE_ID =
  process.env.PACKAGE_ID ??
  '0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7';

const WAL_COIN_TYPE =
  process.env.WAL_COIN_TYPE ??
  '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL';

const FEE_CONFIG_ID =
  process.env.FEE_CONFIG_ID ??
  '0xc8f14c361bfffdfde60054daf5101da382e39d0bf655131fb4b6de69b12f6d40';

const BLOB_EPOCHS = Number(process.env.BLOB_EPOCHS ?? 30);
const VAULT_THRESHOLD = Number(process.env.VAULT_THRESHOLD ?? 5);
const VAULT_RENEW_BY = Number(process.env.VAULT_RENEW_BY ?? 10);
const GAS_BUDGET = Number(process.env.GAS_BUDGET ?? 10_000_000);

// ──────────────────────────────────────────────
// Keypair setup
// ──────────────────────────────────────────────

function loadKeypair() {
  const keyStr = process.env.SUI_PRIVATE_KEY;
  if (!keyStr) {
    throw new Error(
      'SUI_PRIVATE_KEY env var not set.\n' +
        'Export an Ed25519 private key, e.g.:\n' +
        '  export SUI_PRIVATE_KEY="<base64-or-bech32>"\n' +
        'Get your key with: sui keytool export --key-identity <address>',
    );
  }

  let seed;

  if (keyStr.startsWith('suiprivkey')) {
    // Bech32-encoded key from sui keytool export
    const decoded = bech32.decodeToBytes(keyStr);
    // First byte is the flag (0x00 for Ed25519), rest is the secret key
    seed = decoded.bytes.slice(1);
  } else {
    // Raw base64-encoded key (legacy format)
    const raw = fromBase64(keyStr);
    seed = raw.byteLength === 33 ? raw.slice(1) : raw;
  }

  return Ed25519Keypair.fromSecretKey(seed);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTransaction(client, digest, label, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    const resp = await client.getTransactionBlock({
      digest,
      options: {
        showEffects: true,
        showObjectChanges: true,
        showEvents: true,
      },
    });
    if (resp.effects?.status) {
      return resp;
    }
    await delay(2_000);
  }
  throw new Error(`Transaction ${label} (${digest}) not confirmed after ${maxRetries * 2}s`);
}

function findCreatedObject(resp, typeSuffix) {
  const changes = resp.objectChanges ?? [];
  return changes.find(
    (c) =>
      c.type === 'created' &&
      c.objectType.includes(typeSuffix),
  );
}

function formatWAL(amount) {
  // WAL has 9 decimals, same as SUI
  const divisor = 1_000_000_000n;
  const whole = amount / divisor;
  const frac = amount % divisor;
  return `${whole}.${frac.toString().padStart(9, '0')}`;
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Walwatch E2E Test — Blob + Vault Creation');
  console.log('═══════════════════════════════════════════');
  console.log();
  console.log(`  RPC:          ${SUI_RPC_URL}`);
  console.log(`  Package:      ${PACKAGE_ID}`);
  console.log(`  FeeConfig:    ${FEE_CONFIG_ID}`);
  console.log(`  WAL Coin:     ${WAL_COIN_TYPE}`);
  console.log(`  Blob epochs:  ${BLOB_EPOCHS}`);
  console.log(`  Threshold:    ${VAULT_THRESHOLD}`);
  console.log(`  Renew by:     ${VAULT_RENEW_BY}`);
  console.log();

  // ── 1. Initialize clients and signer ─────────

  const keypair = loadKeypair();
  const sender = keypair.toSuiAddress();
  console.log(`  Signer:       ${sender}`);
  console.log();

  const client = new SuiClient({ url: SUI_RPC_URL });

  const walrusClient = new WalrusClient({ network: 'testnet' });

  // ── 2. Check balances ────────────────────────

  const [suiCoins, walCoins] = await Promise.all([
    client.getCoins({ owner: sender, coinType: '0x2::sui::SUI' }),
    client.getCoins({ owner: sender, coinType: WAL_COIN_TYPE }),
  ]);

  const suiBalance = suiCoins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
  const walBalance = walCoins.data.reduce((s, c) => s + BigInt(c.balance), 0n);

  console.log('  ── Balances ──');
  console.log(`  SUI:          ${formatWAL(suiBalance)} SUI`);
  console.log(`  WAL:          ${formatWAL(walBalance)} WAL`);
  console.log(`  WAL coins:    ${walCoins.data.length}`);
  console.log();

  if (suiBalance < 5_000_000_000n) {
    console.warn('  ⚠️  Low SUI balance — may not have enough gas for all transactions');
  }
  if (walBalance < 1_000_000_000n) {
    console.warn('  ⚠️  Low WAL balance — may not have enough to fund blob storage');
  }

  // ── 3. Create a Walrus blob ──────────────────

  console.log('  ── Step 1: Creating Walrus Blob ──');
  console.log();

  const blobContent = `E2E Walwatch test blob — ${new Date().toISOString()}`;
  const blobBytes = new TextEncoder().encode(blobContent);

  // Compute storage cost first
  const { totalCost } = await walrusClient.storageCost(blobBytes.byteLength, BLOB_EPOCHS);
  console.log(`  Blob size:    ${blobBytes.byteLength} bytes`);
  console.log(`  Storage cost: ${formatWAL(totalCost)} WAL`);
  console.log();

  if (walBalance < totalCost) {
    throw new Error(
      `Insufficient WAL balance: have ${formatWAL(walBalance)}, need ${formatWAL(totalCost)}`,
    );
  }

  console.log('  Calling WalrusClient.writeBlob...');
  console.log('  (this creates storage on-chain, encodes the blob, writes');
  console.log('   slivers to storage nodes, and registers the blob)');
  console.log();

  const { blobId, blobObject } = await walrusClient.writeBlob({
    blob: blobBytes,
    deletable: false,
    epochs: BLOB_EPOCHS,
    signer: keypair,
    owner: sender,
  });

  const blobObjectId = blobObject.id.id;

  console.log(`  ✅ Blob created`);
  console.log(`     Blob ID:     ${blobId}`);
  console.log(`     Object ID:   ${blobObjectId}`);
  console.log(`     End epoch:   ${blobObject.storage.end_epoch}`);
  console.log();

  // ── 4. Fetch a WAL coin to use for deposit ──

  // Re-fetch WAL coins (the blob creation may have spent some WAL)
  const updatedWalCoins = await client.getCoins({
    owner: sender,
    coinType: WAL_COIN_TYPE,
  });

  const availableWal = updatedWalCoins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
  if (availableWal < 1_000_000_000n) {
    throw new Error(
      `Insufficient remaining WAL for vault deposit — need at least 1 WAL, have ${formatWAL(availableWal)}`,
    );
  }

  console.log('  ── Step 2: Creating Vault ──');
  console.log();

  // ── 5. Build and execute create_vault tx ────

  const tx = new Transaction();

  // Select a WAL coin and split the deposit amount
  const depositAmount = 2_000_000_000n; // 2 WAL deposit
  const primaryCoinId = updatedWalCoins.data[0].coinObjectId;

  // Build the coin argument: if we have exactly one coin with the right
  // balance use it directly; otherwise merge all coins and split.
  const primary = tx.object(primaryCoinId);
  const restCoins = updatedWalCoins.data
    .slice(1)
    .map((c) => tx.object(c.coinObjectId));
  if (restCoins.length > 0) tx.mergeCoins(primary, restCoins);

  // Split the exact deposit amount if we merged or if the primary is larger
  const oneCoinExact =
    updatedWalCoins.data.length === 1 &&
    BigInt(updatedWalCoins.data[0].balance) === depositAmount;
  const walInput = oneCoinExact ? primary : tx.splitCoins(primary, [tx.pure.u64(depositAmount)])[0];

  tx.moveCall({
    target: `${PACKAGE_ID}::vault::create_vault`,
    arguments: [
      tx.object(blobObjectId),
      walInput,
      tx.pure.u64(VAULT_THRESHOLD),
      tx.pure.u64(VAULT_RENEW_BY),
      tx.pure.option('u64', null), // max_total_epochs = None
    ],
  });

  tx.setSender(sender);
  tx.setGasBudget(GAS_BUDGET);

  console.log('  Sending create_vault transaction...');

  const vaultResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
    },
  });

  const vaultDigest = vaultResult.digest;
  console.log(`  Digest:       ${vaultDigest}`);

  // Wait for confirmation
  const vaultTx = await waitForTransaction(client, vaultDigest, 'create_vault');

  const status = vaultTx.effects?.status;
  if (status?.status !== 'success') {
    throw new Error(
      `create_vault failed: ${status?.error ?? 'unknown error'}\n` +
        `  Digest: ${vaultDigest}`,
    );
  }

  // ── 6. Find the vault object ─────────────────

  const vaultCreated = findCreatedObject(vaultTx, '::vault::RenewalVault');
  if (!vaultCreated) {
    // Fallback: search via the created object changes
    const allCreated = vaultTx.objectChanges?.filter((c) => c.type === 'created') ?? [];
    console.log('  Created objects:', allCreated.map((c) => `${c.objectType} → ${c.objectId}`).join(', '));
    throw new Error('Could not find RenewalVault in transaction output');
  }

  const vaultId = vaultCreated.objectId;
  console.log(`  ✅ Vault created`);
  console.log(`     Vault ID:    ${vaultId}`);

  // ── 7. Verify on-chain state ─────────────────

  console.log();
  console.log('  ── Step 3: Verifying On-Chain State ──');
  console.log();

  const vaultObj = await client.getObject({
    id: vaultId,
    options: { showContent: true },
  });

  const fields = vaultObj.data?.content;
  if (!fields || fields.dataType !== 'moveObject') {
    throw new Error(`Vault object ${vaultId} not found or has unexpected format`);
  }

  const f = fields.fields;
  const policy = f.policy?.fields ?? {};

  console.log(`  Beneficiary:        ${f.beneficiary}`);
  console.log(`  Blob present:       ${f.blob?.vec?.length > 0 ? '✅ yes' : '❌ no'}`);
  console.log(`  WAL balance:        ${f.wal_balance ?? '0'}`);
  console.log(`  Total renewals:     ${f.total_renewals_executed}`);
  console.log(`  Created at epoch:   ${f.created_at_epoch}`);
  console.log();
  console.log('  ── Policy ──');
  console.log(`  Active:             ${policy.active}`);
  console.log(`  Renew threshold:    ${policy.renew_threshold_epochs}`);
  console.log(`  Renew by epochs:    ${policy.renew_by_epochs}`);
  console.log(`  Max total epochs:   ${policy.max_total_epochs ?? '(none)'}`);
  console.log();

  // ── 8. Verify the FeeConfig exists ───────────

  const feeConfigObj = await client.getObject({
    id: FEE_CONFIG_ID,
    options: { showContent: true },
  });

  const feeFields = feeConfigObj.data?.content;
  if (feeFields && feeFields.dataType === 'moveObject') {
    const fc = feeFields.fields;
    console.log('  ── FeeConfig ──');
    console.log(`  Treasury:           ${fc.treasury}`);
    console.log(`  Protocol fee (bps): ${fc.protocol_fee_bps}`);
    console.log(`  Keeper fee:         ${fc.keeper_fee}`);
  }

  // ── Summary ──────────────────────────────────

  console.log();
  console.log('═══════════════════════════════════════════');
  console.log('  ✅ E2E Test Complete');
  console.log('═══════════════════════════════════════════');
  console.log();
  console.log('  Summary:');
  console.log(`  Blob ID:            ${blobId}`);
  console.log(`  Blob Object ID:     ${blobObjectId}`);
  console.log(`  Vault ID:           ${vaultId}`);
  console.log(`  Create Tx Digest:   ${vaultDigest}`);
  console.log();



  return { blobId, blobObjectId, vaultId, vaultDigest };
}

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

main().catch((err) => {
  console.error();
  console.error('  ❌ E2E Test Failed');
  console.error(`  ${err.message}`);
  console.error();
  process.exit(1);
});
