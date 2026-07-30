# Backend: zkLogin SaaS Redesign (API + Keeper)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the API/keeper from unsigned-tx-building middle layer into a full zkLogin-powered backend that signs and submits transactions for users, manages ephemeral keys, and handles sponsored gas.

**Architecture:** Upgrade @mysten/sui to v2, rewrite vaultService to sign+submit (not just build), add zkLogin service for key/proof management, add OAuth auth flow, add gas wallet management, add rate limiting, and update keeper for dual-package tracking.

**Tech Stack:** Node.js/TypeScript, @mysten/sui ^2.22.1, Drizzle ORM/PostgreSQL, JWT (HS256), Google OAuth, GitHub OAuth

## Global Constraints

- `@mysten/sui` must be upgraded to ^2.22.1 in BOTH `api/` and `keeper/` — neither can remain on 1.0.0
- `TransactionBlock` class is replaced by `Transaction` in v2 — all tx building code must use the new API
- JWT secret, OAuth client IDs, gas wallet key all live in env vars — never hardcoded
- zkLogin ephemeral keys expire after 30 days (Sui protocol max)
- PACKAGE_ID is a list for the keeper (`PACKAGE_IDS` env var, comma-separated); a single `PACKAGE_ID` for the API (new vaults only)
- Withdrawals require fresh OAuth re-auth (session < 15 min) — enforced in vaultService
- All new DB columns must get a Drizzle migration
- Rate limits enforced in middleware before tx building (not after)

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `api/package.json` | Modify | Upgrade @mysten/sui 1.0.0 → ^2.22.1, add Google/GitHub OAuth libs |
| `api/src/services/vaultService.ts` | Rewrite | Build+sign+submit txs using `Transaction` + ephemeral keys; enforce spend caps + re-auth |
| `api/src/services/zklogin-service.ts` | Create | Ephemeral key gen, proof storage/retrieval, address derivation, key rotation |
| `api/src/services/gas-wallet-service.ts` | Create | Gas wallet management, balance monitoring, multi-wallet fallback |
| `api/src/services/auth-service.ts` | Modify | Add OAuth login/register, link OAuth to existing account |
| `api/src/middleware/auth.ts` | Modify | Support OAuth tokens, add re-auth check endpoint |
| `api/src/middleware/rate-limiter.ts` | Create | Per-org sliding-window rate limits for sponsored txs |
| `api/src/routes/auth.ts` | Modify | Add `/auth/google`, `/auth/github`, `/auth/oauth/callback` endpoints |
| `api/src/routes/vaults.ts` | Modify | POST /vaults executes tx (not just build); add withdraw endpoint with re-auth |
| `api/src/routes/keys.ts` | Create | GET /keys/export — self-serve key export (rate-limited, re-auth gated) |
| `api/src/db/schema.ts` | Modify | Add zkLogin fields, ZK proof fields, gas wallet fields |
| `api/src/db/migrations/` | Create | New migration for schema changes |
| `api/src/lib/sui-pool.ts` | Create | Coin selection with per-address mutex, gas coin management |
| `api/src/config.ts` | Modify | Add OAuth config, gas wallet config, zkLogin config |
| `api/.env.example` | Modify | Add OAuth client IDs, GAS_WALLET_PRIVATE_KEY, APP_SALT_SECRET, etc. |
| `keeper/package.json` | Modify | Upgrade @mysten/sui 1.0.0 → ^2.22.1 |
| `keeper/src/index.ts` | Modify | Read `PACKAGE_IDS` as list, pass to scanner + executor |
| `keeper/src/scanner.ts` | Modify | Scan vaults across all package IDs |
| `keeper/src/executor.ts` | Modify | Target correct package ID per vault, handle dual-package tx building |
| `keeper/.env` | Modify | PACKAGE_ID → PACKAGE_IDS (comma-separated) |

---

### Task 1: Upgrade @mysten/sui to ^2.22.1 in both api/ and keeper/

**Files:**
- Modify: `api/package.json`
- Modify: `keeper/package.json`
- Modify: `api/src/services/vaultService.ts` — fix imports and API calls
- Modify: `keeper/src/executor.ts` — fix imports and API calls
- Modify: `keeper/src/scanner.ts` — fix imports
- Modify: `keeper/src/sui-pool.ts` — fix imports

**Interfaces:**
- Consumes: Current `@mysten/sui` v1 API (`TransactionBlock`, `SuiClient`, etc.)
- Produces: `@mysten/sui` v2 API (`Transaction`, `SuiClient`, etc.)

- [ ] **Step 1: Update both package.json files**

```json
// api/package.json and keeper/package.json
"dependencies": {
  "@mysten/sui": "^2.22.1",
  "redis": "^4.6.0",
  // ... keep other deps
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd api && npm install
cd ../keeper && npm install
```

- [ ] **Step 3: Fix vaultService.ts imports and API calls**

```typescript
// BEFORE (v1):
import { TransactionBlock } from '@mysten/sui/transactions';
import { SuiClient, SuiObjectResponse } from '@mysten/sui/client';
const tx = new TransactionBlock();
tx.moveCall({ target: `${PACKAGE_ID}::vault::create_vault`, arguments: [...] });
const serialized = tx.serialize();

// AFTER (v2):
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, SuiObjectResponse } from '@mysten/sui/client';
const tx = new Transaction();
tx.moveCall({ target: `${PACKAGE_ID}::vault::create_vault`, arguments: [...] });
const serialized = tx.serialize();  // API unchanged here, but Transaction replaces TransactionBlock
```

Key changes:
- `TransactionBlock` → `Transaction` (import path stays `@mysten/sui/transactions`)
- `transactionBlock` property → `transaction` property on responses
- `signAndExecuteTransactionBlock` → `signAndExecuteTransaction`
- `executeTransactionBlock` → `executeTransaction`
- `getTransactionBlock` → `getTransaction`
- `suix_queryObjects` → `queryObjects` (method names dropped `suix_` prefix)
- Object response types may have nested shape changes — check `data.content` vs `data.content.fields`

- [ ] **Step 4: Fix keeper imports**

```typescript
// keeper/src/executor.ts
// BEFORE:
import { TransactionBlock } from '@mysten/sui/transactions';
// AFTER:
import { Transaction } from '@mysten/sui/transactions';
```

- [ ] **Step 5: Build and fix all type errors**

```bash
cd api && npx tsc --noEmit
cd ../keeper && npx tsc --noEmit
```

Fix all type errors until both compile clean.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json keeper/package.json keeper/package-lock.json api/src/ keeper/src/
git commit -m "build: upgrade @mysten/sui 1.0.0 → ^2.22.1 across api and keeper"
```

---

### Task 2: Add DB schema fields and migration

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: `api/src/db/migrations/XXXX_add_zklogin_fields.ts`

**Interfaces:**
- Consumes: Existing `users` table, existing `subscriptions` table
- Produces: Users table with `oauth_provider`, `oauth_subject`, `oauth_email`, `zklogin_address`, `ephemeral_key_encrypted`, `ephemeral_key_expiry`, `zklogin_proof_encrypted`, `zklogin_jwt_randomness`, `zklogin_max_epoch` columns

- [ ] **Step 1: Add columns to users table in schema.ts**

```typescript
// In the users table definition:
export const users = pgTable('users', {
  // ... existing columns ...
  oauthProvider: text('oauth_provider'),
  oauthSubject: text('oauth_subject'),
  oauthEmail: text('oauth_email'),
  zkloginAddress: text('zklogin_address'),
  ephemeralKeyEncrypted: text('ephemeral_key_encrypted'),
  ephemeralKeyExpiry: timestamp('ephemeral_key_expiry'),
  zkloginProofEncrypted: text('zklogin_proof_encrypted'),
  zkloginJwtRandomness: text('zklogin_jwt_randomness'),
  zkloginMaxEpoch: bigint('zklogin_max_epoch', { mode: 'number' }),
});
```

- [ ] **Step 2: Add columns to subscriptions table**

```typescript
export const subscriptions = pgTable('subscriptions', {
  // ... existing columns ...
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  paymentMethod: text('payment_method'),
});
```

- [ ] **Step 3: Generate migration**

```bash
cd api && npx drizzle-kit generate
```

- [ ] **Step 4: Apply migration to local dev DB**

```bash
cd api && npx drizzle-kit migrate
```

- [ ] **Step 5: Commit**

```bash
git add api/src/db/schema.ts api/src/db/migrations/
git commit -m "feat(db): add zkLogin and subscription fields"
```

---

### Task 3: Create zkLogin service

**Files:**
- Create: `api/src/services/zklogin-service.ts`

**Interfaces:**
- Produces: `generateKeypair(userId, oauthProvider, oauthSubject): { address, encryptedKeypair, proof, jwtRandomness, maxEpoch }`
- Produces: `deriveZkLoginAddress(iss, sub, aud, salt): string`
- Produces: `getEphemeralKeypair(userId): { keypair, proof, jwtRandomness, maxEpoch }`
- Produces: `rotateExpiredKeys(): number`
- Produces: `computeSalt(oauthSubject): string`

- [ ] **Step 1: Write the test file**

```typescript
// tests/services/zklogin-service.test.ts
import { describe, it, expect } from 'vitest';
import { computeSalt, deriveZkLoginAddress } from '../../src/services/zklogin-service';

describe('zklogin-service', () => {
  it('computes deterministic salt from oauth subject', () => {
    const salt = computeSalt('12345');
    expect(salt).toBeTypeOf('string');
    expect(salt.length).toBeGreaterThan(0);
  });

  it('derives same address for same inputs', () => {
    const a1 = deriveZkLoginAddress('https://accounts.google.com', '12345', 'web-client-id', 'test-salt');
    const a2 = deriveZkLoginAddress('https://accounts.google.com', '12345', 'web-client-id', 'test-salt');
    expect(a1).toBe(a2);
  });

  it('derives different address for different aud', () => {
    const a1 = deriveZkLoginAddress('https://accounts.google.com', '12345', 'web-client-id', 'test-salt');
    const a2 = deriveZkLoginAddress('https://accounts.google.com', '12345', 'mobile-client-id', 'test-salt');
    expect(a1).not.toBe(a2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/services/zklogin-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement zklogin-service.ts**

```typescript
import { genAddressSeed, generateNonce, generateRandomness, jwtToAddress } from '@mysten/sui/zklogin';
import { getZkLoginSignature, parseZkLoginSignature } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { createHash, randomBytes } from 'crypto';
import { env } from '../config';

const APP_SALT_SECRET = env.APP_SALT_SECRET;

export function computeSalt(oauthSubject: string): string {
  const hmac = createHash('sha256')
    .update(`${oauthSubject}:${APP_SALT_SECRET}`)
    .digest('hex');
  // Ensure it fits within a u256 for Sui
  return BigInt('0x' + hmac).toString();
}

export function deriveZkLoginAddress(
  iss: string,
  sub: string,
  aud: string,
  salt: string,
): string {
  // Step 1: Compute the address seed (the "sub" claim specifically, salted)
  const addressSeed = genAddressSeed(BigInt(salt), 'sub', sub, aud, iss);

  // Step 2: Convert seed to bech32 Sui address.
  // jwtToAddress derives the full zkLogin address from the issuer and seed.
  // This matches the on-chain address derivation that Sui validators use.
  return jwtToAddress(iss, addressSeed);
}

export async function generateKeypair(
  userId: string,
  oauthProvider: string,
  oauthSubject: string,
  jwtToken: string, // the raw JWT from OAuth
): Promise<{
  address: string;
  encryptedKeypair: string;
  proof: string;
  jwtRandomness: string;
  maxEpoch: number;
}> {
  // 1. Generate ephemeral keypair (valid for 30 days)
  const keypair = new Ed25519Keypair();
  const maxEpoch = Math.floor(Date.now() / 1000 / 86400) + 30; // 30 days from now

  // 2. Generate randomness for the ZK proof
  const jwtRandomness = generateRandomness();

  // 3. Call Mysten's prover to get the ZK proof
  // (or self-hosted prover — configured via env var)
  const proof = await generateZkProof(jwtToken, keypair.getPublicKey(), jwtRandomness, maxEpoch);

  // 4. Derive the zkLogin address
  const salt = computeSalt(oauthSubject);
  const aud = env.OAUTH_CLIENT_ID; // frozen load-bearing parameter
  const address = deriveZkLoginAddress(
    getIssuer(oauthProvider),
    oauthSubject,
    aud,
    salt,
  );

  // 5. Encrypt the keypair for storage
  const encryptedKeypair = encrypt(keypair.export(), env.EPHEMERAL_KEY_ENCRYPTION_KEY);

  return {
    address,
    encryptedKeypair,
    proof: encrypt(proof, env.EPHEMERAL_KEY_ENCRYPTION_KEY),
    jwtRandomness,
    maxEpoch,
  };
}

function getIssuer(provider: string): string {
  switch (provider) {
    case 'google': return 'https://accounts.google.com';
    case 'github': return 'https://github.com/login/oauth';
    default: throw new Error(`Unknown OAuth provider: ${provider}`);
  }
}

function encrypt(data: string, key: string): string {
  // AES-256-GCM encrypt — use a crypto library
  // Return base64-encoded ciphertext
}

function decrypt(encrypted: string, key: string): string {
  // AES-256-GCM decrypt
}
```

- [ ] **Step 4: Run tests**

Run: `cd api && npx vitest run tests/services/zklogin-service.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add api/src/services/zklogin-service.ts
git commit -m "feat: add zklogin service for key generation and address derivation"
```

---

### Task 4: Rewrite vaultService — sign + submit, spend caps, re-auth

**Files:**
- Modify: `api/src/services/vaultService.ts` (full rewrite)
- Modify: `api/src/routes/vaults.ts` — POST /vaults executes tx

**Interfaces:**
- Consumes: `zklogin-service` for key retrieval, `gas-wallet-service` for sponsored gas, `Transaction` from @mysten/sui v2
- Produces: `createVault(userId, orgId, params): { vaultId, digest, status }`
- Produces: `depositToVault(userId, vaultId, amount): { digest }`
- Produces: `withdrawFromVault(userId, vaultId, amount): { digest }` — re-auth gated
- Produces: `updatePolicy(userId, vaultId, params): { digest }`

- [ ] **Step 1: Write the test file**

```typescript
// tests/services/vaultService.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('vaultService', () => {
  it('rejects withdraw when spend cap exceeded', async () => {
    // Mock zklogin service, gas wallet, sui client
    // Call vaultService.withdrawFromVault with amount > allowed cap
    // Expect: throws SpendCapExceededError
  });

  it('rejects withdraw without fresh re-auth', async () => {
    // Mock auth session older than 15 min
    // Expect: throws ReAuthRequiredError
  });

  it('creates vault and returns digest on success', async () => {
    // Full mock of the tx building + signing + submission
    // Expect: returns { vaultId, digest, status: 'confirmed' }
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `cd api && npx vitest run tests/services/vaultService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the vault service rewrite**

```typescript
// api/src/services/vaultService.ts

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { env } from '../config';
import { getEphemeralKeypair } from './zklogin-service';
import { selectGasCoin, getGasWallet } from './gas-wallet-service';

const PACKAGE_ID = env.PACKAGE_ID;
const FEE_CONFIG_ID = env.FEE_CONFIG_OBJECT_ID;
const WAL_COIN_TYPE = env.WAL_COIN_TYPE;

const client = new SuiClient({ url: getFullnodeUrl('testnet') });

// Redis-backed spend cap tracker (required for horizontal scaling — same reasoning as rate-limiter.ts).
// Falls back to in-memory if Redis is unavailable.
const planLimitsCache = new Map<string, { maxPerTx: number; maxPerDay: number; maxTxPerHour: number }>();

interface SpendWindow {
  txCount: number;
  windowStart: number;
  dayTotal: number;
  dayStart: number;
}

// Per-address mutex for coin selection concurrency
const addressLocks = new Map<string, Promise<void>>();

function withAddressLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const prev = addressLocks.get(address) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  addressLocks.set(address, next);
  return next;
}

export class SpendCapExceededError extends Error {
  constructor(limit: string) { super(`Spend cap exceeded: ${limit}`); }
}

export class ReAuthRequiredError extends Error {
  constructor() { super('Withdraw requires fresh OAuth re-authentication (session < 15 min)'); }
}

async function checkWithdrawCaps(orgId: string, amount: number): Promise<void> {
  const now = Date.now();

  // Get plan limits (from DB or config)
  const limits = await getPlanLimits(orgId);

  if (amount > limits.maxPerTx) throw new SpendCapExceededError(`${limits.maxPerTx} WAL per tx`);

  // Check rolling 24h total via Redis (or local fallback)
  const dayTotal = await getSpendTotal(orgId, 'day');
  if (dayTotal + amount > limits.maxPerDay) throw new SpendCapExceededError(`${limits.maxPerDay} WAL per day`);

  const hourCount = await getSpendCount(orgId, 'hour');
  if (hourCount >= limits.maxTxPerHour) throw new SpendCapExceededError(`${limits.maxTxPerHour} txs per hour`);

  // Record this spend
  await recordSpend(orgId, amount);
}

async function getSpendTotal(orgId: string, window: 'hour' | 'day'): Promise<number> {
  const windowMs = window === 'hour' ? 3600000 : 86400000;
  const key = `spend:${orgId}:total:${windowMs}`;
  try {
    const val = await redis.get(key);
    return val ? Number(val) : 0;
  } catch {
    return 0; // Redis unavailable — allow through (dev mode)
  }
}

async function getSpendCount(orgId: string, window: 'hour' | 'day'): Promise<number> {
  const windowMs = window === 'hour' ? 3600000 : 86400000;
  const key = `spend:${orgId}:count:${windowMs}`;
  try {
    const members = await redis.zCount(key, Date.now() - windowMs, Date.now());
    return members;
  } catch {
    return 0;
  }
}

async function recordSpend(orgId: string, amount: number): Promise<void> {
  const now = Date.now();
  try {
    const dayKey = `spend:${orgId}:total:${86400000}`;
    await redis.incrBy(dayKey, amount);
    await redis.expire(dayKey, 86401);

    const hourKey = `spend:${orgId}:count:${3600000}`;
    await redis.zAdd(hourKey, { score: now, value: `${now}-${Math.random()}` });
    await redis.expire(hourKey, 3601);
  } catch {
    // Redis unavailable — skip tracking (dev mode, instances may drift)
  }
}

function checkReAuth(sessionAgeMs: number): void {
  if (sessionAgeMs > 15 * 60 * 1000) {
    throw new ReAuthRequiredError();
  }
}

export async function createVault(
  userId: string,
  orgId: string,
  params: {
    blobId: string;
    amount: number;
    threshold: number;
    extension: number;
    maxEpochs?: number;
    withdrawDelayEpochs: number;
  },
): Promise<{ vaultId: string; digest: string; status: string }> {
  return withAddressLock(userId, async () => {
    // 1. Load user's ephemeral keypair + ZK proof
    const { keypair, proof, jwtRandomness, maxEpoch } = await getEphemeralKeypair(userId);

    // 2. Build the Move call
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::vault::create_vault`,
      arguments: [
        tx.object(FEE_CONFIG_ID),
        tx.object(params.blobId),
        await selectWalCoin(tx, userId, params.amount),
        tx.pure.u64(params.threshold),
        tx.pure.u64(params.extension),
        tx.pure.option('u64', params.maxEpochs ?? null),
        tx.pure.address(keypair.toSuiAddress()),
        tx.pure.u64(params.withdrawDelayEpochs),
      ],
    });

    // 3. Attach gas coin and set sender BEFORE signing.
    //    For sponsored transactions, the sender is the user (ephemeral key)
    //    and the gas sponsor provides a separate gas coin + signature.
    tx.setSender(keypair.toSuiAddress());
    const gasBudget = 10_000_000; // 0.01 SUI in MIST
    tx.setGasBudget(gasBudget);
    // Note: Gas coin selection happens server-side. The keeper's gas wallet
    // coin is added as a `tx.gas` override when submitting (see Step 5).

    // 4. Sign with user's ephemeral key (sender + args committed to signature)
    const { bytes, signature: userSig } = await tx.sign({
      client,
      signer: keypair,
    });

    // 5. Create zkLogin signature (wraps the user's ephemeral signature)
    const zkLoginSig = getZkLoginSignature({
      inputs: { ...proof },
      maxEpoch,
      userSignature: userSig,
    });

    // 6. Submit with gas wallet as sponsor.
    //    Re-deserialize the signed tx bytes, attach a gas coin from the
    //    app's gas wallet, and submit with both signatures.
    const gasWallet = getGasWallet();
    const txToExec = Transaction.from(bytes);
    // Attach a specific gas coin from the gas wallet rather than auto-selection:
    const gasCoinId = await selectGasCoin(gasWallet.address);
    txToExec.setGasPayment([{ objectId: gasCoinId, version: '0', digest: '' }]);
    // Sign with the gas wallet's keypair for the sponsorship signature
    const { signature: gasSig } = await txToExec.sign({
      client,
      signer: gasWallet.keypair,
    });
    const result = await client.executeTransaction({
      transaction: txToExec,
      signature: [zkLoginSig, gasSig],
      options: { showEffects: true },
    });

    return {
      vaultId: result.effects?.created?.[0]?.reference?.objectId ?? '',
      digest: result.digest,
      status: result.effects?.status?.status ?? 'failure',
    };
  });
}

export async function withdrawFromVault(
  userId: string,
  orgId: string,
  vaultId: string,
  amount: number,
  sessionAgeMs: number,
): Promise<{ digest: string }> {
  // 1. Check re-auth requirement
  checkReAuth(sessionAgeMs);

  // 2. Check spend caps
  checkWithdrawCaps(orgId, amount);

  return withAddressLock(userId, async () => {
    const { keypair, proof, jwtRandomness, maxEpoch } = await getEphemeralKeypair(userId);

    const tx = new Transaction();
    tx.setSender(keypair.toSuiAddress());
    tx.setGasBudget(5_000_000);
    tx.moveCall({
      target: `${PACKAGE_ID}::vault::initiate_withdraw`,
      arguments: [
        tx.object(vaultId),
        tx.pure.u64(amount),
      ],
    });

    // Sign with user's ephemeral key (sender is set before signing)
    const { bytes, signature: userSig } = await tx.sign({ client, signer: keypair });
    const zkLoginSig = getZkLoginSignature({ inputs: { ...proof }, maxEpoch, userSignature: userSig });

    // Re-deserialize and attach gas coin from gas wallet
    const gasWallet = getGasWallet();
    const txToExec = Transaction.from(bytes);
    const gasCoinId = await selectGasCoin(gasWallet.address);
    txToExec.setGasPayment([{ objectId: gasCoinId, version: '0', digest: '' }]);
    const { signature: gasSig } = await txToExec.sign({ client, signer: gasWallet.keypair });
    const result = await client.executeTransaction({
      transaction: txToExec,
      signature: [zkLoginSig, gasSig],
      options: { showEffects: true },
    });

    return { digest: result.digest };
  });
}

async function selectWalCoin(tx: Transaction, owner: string, amount: number): Promise<TransactionArgument> {
  const coins = await client.getCoins({ owner, coinType: WAL_COIN_TYPE });
  // Find a single coin with sufficient balance
  const sufficient = coins.data.find(c => BigInt(c.balance) >= BigInt(amount));
  if (sufficient) {
    // Split off just enough — return the split coin as the payment argument
    return tx.splitCoins(tx.object(sufficient.coinObjectId), [tx.pure.u64(amount)])[0];
  }

  // No single coin suffices — merge all coins into the first, then split.
  if (coins.data.length === 0) throw new Error(`No WAL coins at ${owner}`);
  const total = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
  if (total < BigInt(amount)) {
    throw new Error(`Insufficient total WAL balance: ${total} < ${amount}`);
  }
  // Build merge instructions into the transaction
  for (let i = 1; i < coins.data.length; i++) {
    tx.mergeCoins(tx.object(coins.data[0].coinObjectId), [tx.object(coins.data[i].coinObjectId)]);
  }
  // Split required amount from the merged coin — return as payment argument
  return tx.splitCoins(tx.object(coins.data[0].coinObjectId), [tx.pure.u64(amount)])[0];
}

async function getPlanLimits(orgId: string): Promise<{ maxPerTx: number; maxPerDay: number; maxTxPerHour: number }> {
  // Read from the org's plan record in DB, then look up limits from
  // rate-limiter.ts's planLimits table (the single source of truth).
  // Cache in planLimitsCache with 5-min TTL to avoid DB hits per request.
  // PSEUDOCODE — replace with actual DB query + rate-limiter import:
  //   const org = await db.query.organizations.findFirst({ where: eq(org.id, orgId) });
  //   const plan = org?.plan ?? 'free';
  //   return planLimits[plan];
  return { maxPerTx: 100, maxPerDay: 500, maxTxPerHour: 10 };
```


- [ ] **Step 4: Create the `selectWalCoin` helper with proper splitting**

In `api/src/lib/sui-pool.ts`:

```typescript
export async function selectWalCoin(
  client: SuiClient,
  tx: Transaction,
  owner: string,
  requiredAmount: bigint,
  coinType: string,
): Promise<{ coinId: string; paymentCoin: TransactionArgument }> {
  const coins = await client.getCoins({ owner, coinType });
  // Find the first coin with >= requiredAmount
  const sufficient = coins.data.find(c => BigInt(c.balance) >= requiredAmount);
  if (sufficient) {
    // Split off just enough from the sufficient coin
    const [paymentCoin] = tx.splitCoins(tx.object(sufficient.coinObjectId), [tx.pure.u64(requiredAmount)]);
    return { coinId: sufficient.coinObjectId, paymentCoin };
  }

  // No single coin suffices — merge all coins into the first, then split.
  if (coins.data.length === 0) throw new Error(`No WAL coins at ${owner}`);
  const total = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
  if (total < requiredAmount) throw new Error(`Insufficient total WAL balance: ${total} < ${requiredAmount}`);

  // Build merge instructions into the transaction
  for (let i = 1; i < coins.data.length; i++) {
    tx.mergeCoins(tx.object(coins.data[0].coinObjectId), [tx.object(coins.data[i].coinObjectId)]);
  }
  // Split required amount from the merged coin
  const [paymentCoin] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [tx.pure.u64(requiredAmount)]);
  return { coinId: coins.data[0].coinObjectId, paymentCoin };
}
```

Update all call sites to pass the Transaction object and use the returned `paymentCoin` in `tx.moveCall({ arguments: [..., paymentCoin] })` instead of passing a plain string coin ID.

- [ ] **Step 5: Update POST /vaults in vaults.ts route**

```typescript
// api/src/routes/vaults.ts

import { createVault, withdrawFromVault, SpendCapExceededError, ReAuthRequiredError } from '../services/vaultService';
import { requireAuth, requireReAuth } from '../middleware/auth';

router.post('/vaults', requireAuth, async (req, res) => {
  const { blobId, amount, threshold, extension, maxEpochs } = req.body;
  const userId = req.userId;
  const orgId = req.orgId;

  try {
    const result = await createVault(userId, orgId, {
      blobId,
      amount,
      threshold,
      extension,
      maxEpochs,
      withdrawDelayEpochs: 1, // zkLogin path uses 1-epoch delay
    });
    res.json(result);
  } catch (err) {
    // Differentiate between validation errors, rate limits, and on-chain failures
    if (err instanceof SpendCapExceededError) {
      res.status(429).json({ error: err.message, retryAfter: 3600 });
    } else if (err instanceof ReAuthRequiredError) {
      res.status(401).json({ error: err.message, code: 'REAUTH_REQUIRED' });
    } else if (err instanceof SyntaxError || err instanceof TypeError) {
      // Client-side input errors (bad blobId, malformed amount)
      res.status(400).json({ error: `Invalid input: ${err.message}` });
    } else {
      // On-chain failure or unexpected server error
      res.status(500).json({
        error: 'Vault creation failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
});

router.post('/vaults/:id/withdraw', requireAuth, requireReAuth, async (req, res) => {
  const { amount } = req.body;
  const result = await withdrawFromVault(req.userId, req.orgId, req.params.id, amount, req.sessionAgeMs);
  res.json(result);
});
```

- [ ] **Step 6: Add `requireReAuth` middleware**

In `api/src/middleware/auth.ts`:

```typescript
export function requireReAuth(req: Request, res: Response, next: NextFunction) {
  // JWT has an `auth_time` claim — check if it's within 15 minutes
  const authTime = req.jwtPayload?.auth_time;
  if (!authTime || Date.now() / 1000 - authTime > 15 * 60) {
    return res.status(401).json({ error: 'Re-authentication required', code: 'REAUTH_REQUIRED' });
  }
  next();
}
```

- [ ] **Step 7: Build and fix type errors**

Run: `cd api && npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 8: Commit**

```bash
git add api/src/services/vaultService.ts api/src/lib/sui-pool.ts api/src/routes/vaults.ts api/src/middleware/auth.ts
git commit -m "feat: rewrite vaultService with sign+submit, spend caps, and re-auth"
```

---

### Task 5: Create gas wallet service

**Files:**
- Create: `api/src/services/gas-wallet-service.ts`

**Interfaces:**
- Consumes: Ed25519Keypair from env `GAS_WALLET_PRIVATE_KEY`
- Produces: `getGasWallet(): { keypair: Ed25519Keypair, signature: string }`
- Produces: `checkBalance(): Promise<{ primary: bigint, standby: bigint, status: string }>`
- Produces: `topUpFromStandby(amount: bigint): Promise<void>`

- [ ] **Step 1: Implement gas-wallet-service.ts**

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { env } from '../config';

const client = new SuiClient({ url: getFullnodeUrl('testnet') });

// Primary gas wallet — hot, used for all ops
const primaryKeypair = Ed25519Keypair.fromSecretKey(env.GAS_WALLET_PRIMARY_KEY);
const primaryAddress = primaryKeypair.toSuiAddress();

// Standby gas wallet — cold(ish), activated on primary failure
let standbyKeypair: Ed25519Keypair | null = null;
if (env.GAS_WALLET_STANDBY_KEY) {
  standbyKeypair = Ed25519Keypair.fromSecretKey(env.GAS_WALLET_STANDBY_KEY);
}

export function getGasWallet(): { keypair: Ed25519Keypair; address: string } {
  return { keypair: primaryKeypair, address: primaryAddress };
}

export async function checkBalance(): Promise<{ primary: bigint; standby: bigint; status: string }> {
  const primary = await client.getBalance({ owner: primaryAddress });
  const standbyBalance = standbyKeypair
    ? await client.getBalance({ owner: standbyKeypair.toSuiAddress() })
    : BigInt(0);
  const status = BigInt(primary.totalBalance) < BigInt(10_000_000_000) // 10 SUI
    ? 'LOW'
    : 'OK';
  return { primary: BigInt(primary.totalBalance), standby: BigInt(standbyBalance), status };
}

export async function topUpFromColdReserve(amount: bigint): Promise<string> {
  // Load the cold reserve keypair (requires multi-party approval in production)
  // For MVP: read from env var and transfer
  if (!env.GAS_WALLET_COLD_KEY) throw new Error('Cold reserve key not configured');

  const coldKeypair = Ed25519Keypair.fromSecretKey(env.GAS_WALLET_COLD_KEY);
  const tx = new Transaction();
  tx.transferObjects([tx.gas], primaryAddress);
  tx.setSender(coldKeypair.toSuiAddress());

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: coldKeypair,
    options: { showEffects: true },
  });

  return result.digest;
}
```

- [ ] **Step 2: Add gas wallet balance monitor**

Add a cron job (or setInterval in the server startup) that checks gas balance every 5 minutes and alerts if low.

```typescript
// At startup of api/src/index.ts
import { checkBalance } from './services/gas-wallet-service';

setInterval(async () => {
  const { primary, status } = await checkBalance();
  if (status === 'LOW') {
    console.error(`GAS WALLET LOW: ${primary} MIST remaining`);
    // Send alert to configured channel (email/pager/chat)
  }
}, 5 * 60 * 1000);
```

- [ ] **Step 3: Commit**

```bash
git add api/src/services/gas-wallet-service.ts
git commit -m "feat: add gas wallet service with primary/standby/cold tiers"
```

---

### Task 6: Add OAuth authentication flow

**Files:**
- Modify: `api/src/routes/auth.ts` — add `/auth/google`, `/auth/github`, `/auth/oauth/callback`
- Modify: `api/src/services/auth-service.ts` — add OAuth login/register/link
- Modify: `api/src/middleware/auth.ts` — support OAuth tokens
- Modify: `api/src/config.ts` — add OAuth config

- [ ] **Step 1: Add OAuth route handlers**

```typescript
// api/src/routes/auth.ts

import { OAuth2Client } from 'google-auth-library';
import { generateKeypair, computeSalt, deriveZkLoginAddress } from '../services/zklogin-service';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

// POST /auth/google — exchange Google token for app JWT
router.post('/auth/google', async (req, res) => {
  const { idToken } = req.body; // from Google's One Tap or sign-in button

  // 1. Verify the token
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  const subject = payload.sub;
  const email = payload.email;

  // 2. Check if user exists
  let user = await db.query.users.findFirst({
    where: and(eq(users.oauthProvider, 'google'), eq(users.oauthSubject, subject)),
  });

  if (!user) {
    // 3. Create user + generate zkLogin keypair
    const { address, encryptedKeypair, proof, jwtRandomness, maxEpoch } =
      await generateKeypair(crypto.randomUUID(), 'google', subject, idToken);

    user = await db.insert(users).values({
      oauthProvider: 'google',
      oauthSubject: subject,
      oauthEmail: email,
      zkloginAddress: address,
      ephemeralKeyEncrypted: encryptedKeypair,
      ephemeralKeyExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      zkloginProofEncrypted: proof,
      zkloginJwtRandomness: jwtRandomness,
      zkloginMaxEpoch: maxEpoch,
    }).returning().then(r => r[0]);
  }

  // 4. Issue JWT with auth_time claim
  const token = jwt.sign({
    sub: user.id,
    auth_time: Math.floor(Date.now() / 1000),
    provider: 'google',
  }, env.JWT_SECRET, { expiresIn: '7d' });

  res.json({ token, user: { id: user.id, email, zkloginAddress: user.zkloginAddress } });
});

// POST /auth/link — link OAuth to existing email/password account
router.post('/auth/link', requireAuth, async (req, res) => {
  const { idToken, provider } = req.body;
  // ... verify token, generate zkLogin keypair, update user record ...
  res.json({ message: 'OAuth linked', zkloginAddress: updatedUser.zkloginAddress });
});
```

- [ ] **Step 2: Add OAuth config**

```typescript
// api/src/config.ts — add:
export const env = {
  // ... existing config ...
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI!,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
  GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI!,
  APP_SALT_SECRET: process.env.APP_SALT_SECRET!,
  EPHEMERAL_KEY_ENCRYPTION_KEY: process.env.EPHEMERAL_KEY_ENCRYPTION_KEY!,
  GAS_WALLET_PRIMARY_KEY: process.env.GAS_WALLET_PRIMARY_KEY!,
  GAS_WALLET_STANDBY_KEY: process.env.GAS_WALLET_STANDBY_KEY,
  GAS_WALLET_COLD_KEY: process.env.GAS_WALLET_COLD_KEY,
};
```

- [ ] **Step 3: Build and verify**

Run: `cd api && npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/auth.ts api/src/services/auth-service.ts api/src/middleware/auth.ts api/src/config.ts
git commit -m "feat: add OAuth authentication with zkLogin key generation"
```

---

### Task 7: Add rate limiting middleware

**Files:**
- Create: `api/src/middleware/rate-limiter.ts`
- Modify: `api/src/routes/vaults.ts` — apply rate limiter

- [ ] **Step 1: Implement rate-limiter.ts**

```typescript
import { Request, Response, NextFunction } from 'express';

interface OrgLimit {
  maxPerHour: number;
  maxPerDay: number;
  maxWithdrawPerTx: number;
  maxWithdrawPerDay: number;
  maxConcurrentCreations: number;
  maxVaults: number;
}

// SINGLE SOURCE OF TRUTH for plan-tier limits.
// These numbers are replicated nowhere else — if they need changing, change them here.
const planLimits: Record<string, OrgLimit> = {
  free:    { maxPerHour: 10, maxPerDay: 50, maxWithdrawPerTx: 100, maxWithdrawPerDay: 500, maxConcurrentCreations: 1, maxVaults: 5 },
  pro:     { maxPerHour: 100, maxPerDay: 500, maxWithdrawPerTx: 1000, maxWithdrawPerDay: 5000, maxConcurrentCreations: 3, maxVaults: 50 },
  team:    { maxPerHour: 500, maxPerDay: 2500, maxWithdrawPerTx: 5000, maxWithdrawPerDay: 25000, maxConcurrentCreations: 10, maxVaults: 10000 },
  enterprise: { maxPerHour: 10000, maxPerDay: 100000, maxWithdrawPerTx: 100000, maxWithdrawPerDay: 1000000, maxConcurrentCreations: 100, maxVaults: 100000 },
};
// Note: These are PER-TX limits (maxWithdrawPerTx) and PER-DAY limits (maxWithdrawPerDay).
// The UI billing page must render the same numbers. The design doc §7.2 is the authoritative spec.

// Redis-backed rate limiter (required for horizontal scaling — in-memory Maps
// on separate instances would allow an org to multiply their effective limit
// by the number of instances and reset on every deploy).
// Falls back to in-memory if Redis is unavailable (dev mode).

import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch(() => {}); // Non-blocking — will fall through to local

/**
 * Check rate limit for an org. Uses a Redis sorted set (epoch ms as score)
 * per org per window type. Returns true if allowed, false if limited.
 */
async function checkRateLimit(orgId: string, windowMs: number, maxCount: number): Promise<boolean> {
  const now = Date.now();
  const windowKey = `ratelimit:${orgId}:${windowMs}`;
  const boundary = now - windowMs;

  try {
    // Remove entries outside the window, then count entries in the window
    await redis.zRemRangeByScore(windowKey, 0, boundary);
    const count = await redis.zCard(windowKey);
    if (count >= maxCount) return false;
    // Add current entry with score = now
    await redis.zAdd(windowKey, { score: now, value: `${now}-${Math.random()}` });
    // Set TTL on the key to auto-clean after one window
    await redis.expire(windowKey, Math.ceil(windowMs / 1000));
    return true;
  } catch {
    // Redis unavailable — fall back to in-memory (dev mode, single instance only)
    return fallbackLocalCounter(orgId, windowMs, maxCount, now);
  }
}

// In-memory fallback for dev mode (single instance, no Redis)
const localCounters = new Map<string, number[]>();

function fallbackLocalCounter(orgId: string, windowMs: number, maxCount: number, now: number): boolean {
  const key = `${orgId}:${windowMs}`;
  let timestamps = localCounters.get(key) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);
  if (timestamps.length >= maxCount) return false;
  timestamps.push(now);
  localCounters.set(key, timestamps);
  return true;
}

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const orgId = req.orgId;
  if (!orgId) return next();

  const plan = (req as any).plan ?? 'free';
  const limits = planLimits[plan] ?? planLimits.free;

  const hourAllowed = await checkRateLimit(orgId, 3600000, limits.maxPerHour);
  if (!hourAllowed) {
    return res.status(429).json({ error: 'Hourly rate limit exceeded', retryAfter: 3600 });
  }

  const dayAllowed = await checkRateLimit(orgId, 86400000, limits.maxPerDay);
  if (!dayAllowed) {
    return res.status(429).json({ error: 'Daily rate limit exceeded', retryAfter: 86400 });
  }

  // Also set limits for downstream use
  (req as any).txLimits = limits;

  next();
}
```

- [ ] **Step 2: Apply rate limiter to vault routes**

```typescript
// api/src/routes/vaults.ts
import { rateLimiter } from '../middleware/rate-limiter';

router.post('/vaults', requireAuth, rateLimiter, async (req, res) => {
  // ...
});
```

- [ ] **Step 3: Commit**

```bash
git add api/src/middleware/rate-limiter.ts api/src/routes/vaults.ts
git commit -m "feat: add per-org rate limiter middleware for sponsored txs"
```

---

### Task 8: Update keeper for dual-package tracking

**Files:**
- Modify: `keeper/src/index.ts` — read `PACKAGE_IDS` env var
- Modify: `keeper/src/scanner.ts` — scan both package IDs
- Modify: `keeper/src/executor.ts` — target correct package ID per vault
- Modify: `keeper/.env` — add PACKAGE_IDS

- [ ] **Step 1: Update env parsing**

```typescript
// keeper/src/index.ts
// BEFORE:
const PACKAGE_ID = env.PACKAGE_ID;
// AFTER:
const PACKAGE_IDS = env.PACKAGE_IDS.split(',').map(s => s.trim());
```

- [ ] **Step 2: Update scanner**

```typescript
// keeper/src/scanner.ts

export async function scanVaults(client: SuiClient, packageIds: string[], feeConfigId: string): Promise<DueVault[]> {
  const results: DueVault[] = [];
  for (const packageId of packageIds) {
    // RenewalVault is a shared object, so we cannot use owner-based queries.
    // The existing (pre-redesign) keeper scans vaults via one of these mechanisms
    // (identify which one the existing codebase uses and reuse it):
    //
    // Option A — Event-based index: Query SuiEvents for VaultCreated events
    //   (filter by package + event type), track vault IDs in a local DB table,
    //   then fetch each vault object by ID: client.multiGetObjects({ ids })
    //
    // Option B — Registry object: If the contract maintains a shared registry
    //   or VecSet of vault IDs, read it via client.getObject.
    //
    // Option C — GraphQL indexer (Sui's recommended path): Use the Sui GraphQL
    //   interface if available on the target network (testnet/mainnet).
    //
    // The existing keeper's pre-redesign scan mechanism should be identified
    // (check keeper/src/scanner.ts's current implementation) and extended to
    // iterate over both package IDs rather than being rewritten from scratch.
    //
    // PSEUDOCODE — replace with actual mechanism from existing codebase:
    const vaultIds = await getTrackedVaultIds(packageId); // read from local event index
    if (vaultIds.length === 0) continue;
    const objects = await client.multiGetObjects({
      ids: vaultIds,
      options: { showContent: true },
    });
    for (const obj of objects) {
      if (!obj.data?.content) continue;
      const fields = (obj.data.content as any).fields;
      results.push({
        objectId: obj.data.objectId!,
        packageId,
        beneficiary: fields.beneficiary,
        pendingWithdrawAmount: fields.pending_withdraw_amount ?? 0,
        pendingWithdrawInitEpoch: fields.pending_withdraw_init_epoch ?? 0,
        withdrawDelayEpochs: fields.withdraw_delay_epochs ?? 0,
      });
    }
  }
  return results;
}
```

- [ ] **Step 3: Update executor to use per-vault package ID**

```typescript
// keeper/src/executor.ts

export async function executeRenewal(
  client: SuiClient,
  vault: DueVault,
  feeConfigId: string,
  systemObjectId: string,
): Promise<string> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${vault.packageId}::vault::execute_renewal`, // ← use vault's own package
    arguments: [
      tx.object(vault.objectId),
      tx.object(feeConfigId),
      tx.object(systemObjectId),
    ],
  });

  tx.setGasBudget(10_000_000); // 0.01 SUI
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keeperKeypair,
    options: { showEffects: true },
  });

  return result.digest;
}
```

- [ ] **Step 4: Build**

Run: `cd keeper && npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 5: Commit**

```bash
git add keeper/src/ keeper/.env
git commit -m "feat(keeper): dual-package tracking — scan and execute across multiple PACKAGE_IDs"
```

---

### Task 9: Add keeper finalize-withdraw job

**Files:**
- Modify: `keeper/src/index.ts` — add `finalizePendingWithdrawals` to the scan cycle
- Modify: `keeper/src/executor.ts` — add `finalizeWithdraw(vaultId)` export

**Critical:** The contract's `initiate_withdraw` puts vaults into a "pending" state with `pending_withdraw_amount > 0`. Nothing ever calls `finalize_withdraw` — so every zkLogin withdrawal (which defaults to `withdraw_delay_epochs = 1`) gets stuck permanently unless someone manually calls the contract. The keeper already polls on a schedule for `execute_renewal`; it should poll for `finalize_withdraw` the same way, since both are permissionless.

**Interfaces:**
- Consumes: `DueVault` with `pendingWithdrawAmount`, `pendingWithdrawInitEpoch`, `withdrawDelayEpochs`
- Produces: `finalizeWithdraw(client, vault, feeConfigId): Promise<string>` in executor

- [ ] **Step 1: Write the failing test**

```typescript
// tests/finalize-withdraw.test.ts
import { describe, it, expect } from 'vitest';

describe('finalizeWithdraw', () => {
  it('finalizes a vault whose delay has elapsed', async () => {
    // Mock a vault with pendingWithdrawAmount > 0 and
    // current epoch >= pendingWithdrawInitEpoch + withdrawDelayEpochs
    // Expect: tx is built and submitted, returns digest
  });

  it('skips vaults where delay has not elapsed', async () => {
    // Mock a vault where current epoch < available_epoch
    // Expect: no tx is built, returns null
  });

  it('skips vaults with no pending withdrawal', async () => {
    // Mock a vault where pendingWithdrawAmount === 0
    // Expect: no tx is built, returns null
  });
});
```

- [ ] **Step 2: Add `finalizeWithdraw` to executor**

```typescript
// keeper/src/executor.ts

// keeper/src/executor.ts — add import (if not already present):
// import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
//
// keeper/src/index.ts (existing) already defines:
//   const keeperKeypair = Ed25519Keypair.fromSecretKey(...);
//   const FEE_CONFIG_ID = env.FEE_CONFIG_ID;
// These are reused here.

export async function finalizeWithdraw(
  client: SuiClient,
  vault: { objectId: string; packageId: string; pendingWithdrawInitEpoch: number; withdrawDelayEpochs: number },
  feeConfigId: string,
  keypair: Ed25519Keypair,
): Promise<string | null> {
  const currentEpoch = await client.getEpoch().then(r => r.epoch);
  const availableEpoch = vault.pendingWithdrawInitEpoch + vault.withdrawDelayEpochs;

  if (BigInt(currentEpoch) < BigInt(availableEpoch)) return null; // delay not elapsed

  const tx = new Transaction();
  tx.setSender(keypair.toSuiAddress());
  tx.moveCall({
    target: `${vault.packageId}::vault::finalize_withdraw`,
    arguments: [tx.object(vault.objectId)],
  });
  tx.setGasBudget(5_000_000);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  return result.digest;
}
```

- [ ] **Step 3: Add pending-withdraw scan to keeper cycle**

```typescript
// keeper/src/index.ts — in the main scan cycle, after due-vault scan:

async function finalizePendingWithdrawals() {
  for (const packageId of PACKAGE_IDS) {
    const pendingVaults = await scanner.findPendingWithdrawals(client, packageId);
    for (const vault of pendingVaults) {
      try {
        const digest = await executor.finalizeWithdraw(client, vault, FEE_CONFIG_ID, keeperKeypair);
        if (digest) {
          logger.info(`Finalized withdrawal for vault ${vault.objectId}: ${digest}`);
        }
      } catch (err) {
        logger.error(`Failed to finalize withdrawal for vault ${vault.objectId}:`, err);
      }
    }
  }
}

// Run in the same loop as executeRenewal, but less frequently (every ~60 min)
setInterval(finalizePendingWithdrawals, 60 * 60 * 1000);
```

- [ ] **Step 4: Add `findPendingWithdrawals` to scanner**

```typescript
// keeper/src/scanner.ts

export async function findPendingWithdrawals(
  client: SuiClient,
  packageId: string,
): Promise<Array<{ objectId: string; packageId: string; pendingWithdrawAmount: number; pendingWithdrawInitEpoch: number; withdrawDelayEpochs: number }>> {
  // Same event-index or registry approach as scanVaults (Task 8),
  // but filtered to vaults where pending_withdraw_amount > 0.
  // PSEUDOCODE — adapt to actual scanning mechanism:
  const vaultIds = await getTrackedVaultIds(packageId);
  if (vaultIds.length === 0) return [];
  const objects = await client.multiGetObjects({
    ids: vaultIds,
    options: { showContent: true },
  });
  return objects
    .filter(obj => {
      const fields = (obj.data?.content as any)?.fields;
      return fields && BigInt(fields.pending_withdraw_amount ?? 0) > 0;
    })
    .map(obj => {
      const fields = (obj.data!.content as any).fields;
      return {
        objectId: obj.data!.objectId!,
        packageId,
        pendingWithdrawAmount: Number(fields.pending_withdraw_amount),
        pendingWithdrawInitEpoch: Number(fields.pending_withdraw_init_epoch),
        withdrawDelayEpochs: Number(fields.withdraw_delay_epochs),
      };
    });
}
```

- [ ] **Step 5: Commit**

```bash
git add keeper/src/index.ts keeper/src/executor.ts keeper/src/scanner.ts
git commit -m "feat(keeper): add finalizeWithdraw job for completing pending withdrawals"
```

---

### Task 10: Add self-serve key export endpoint

**Files:**
- Create: `api/src/routes/keys.ts`

- [ ] **Step 1: Implement keys.ts**

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '../services/zklogin-service';
import { env } from '../config';

const router = Router();

// GET /keys/export — self-serve ephemeral key export
// Rate-limited: max 1 export per 7 days per user
// WARNING: Exported key grants full signing authority for up to 30 days
// (or 7 days from export, whichever comes first). Requires fresh re-auth
// because it is MORE powerful than a single capped withdrawal.
router.get('/keys/export', requireAuth, requireReAuth, async (req, res) => {
  const userId = req.userId;

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Check rate limit: last export must be > 7 days ago
  if (user.lastKeyExportAt) {
    const daysSinceLastExport = (Date.now() - new Date(user.lastKeyExportAt).getTime()) / 86400000;
    if (daysSinceLastExport < 7) {
      const daysRemaining = Math.ceil(7 - daysSinceLastExport);
      return res.status(429).json({ error: `Key export rate-limited. Try again in ${daysRemaining} days.` });
    }
  }

  // Decrypt and return the ephemeral key
  const ephemeralKey = decrypt(user.ephemeralKeyEncrypted, env.EPHEMERAL_KEY_ENCRYPTION_KEY);

  // Update last export time
  await db.update(users).set({ lastKeyExportAt: new Date() }).where(eq(users.id, userId));

  res.json({
    ephemeralKey,                // PEM or JSON format
    zkloginProof: decrypt(user.zkloginProofEncrypted, env.EPHEMERAL_KEY_ENCRYPTION_KEY),
    jwtRandomness: user.zkloginJwtRandomness,
    maxEpoch: user.zkloginMaxEpoch,
    zkloginAddress: user.zkloginAddress,
    expiresAt: clampExportExpiry(user.ephemeralKeyExpiry),
    warning: 'This key can sign transactions as you. Keep it secure and delete after use.',
  });
});

function clampExportExpiry(naturalExpiry: Date): Date {
  // Enforce the "7 days from export or natural 30-day expiry, whichever sooner" rule
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return naturalExpiry < sevenDaysFromNow ? naturalExpiry : sevenDaysFromNow;
}

export default router;
```

- [ ] **Step 2: Add route to Express app**

```typescript
// In api/src/index.ts
import keysRouter from './routes/keys';
app.use('/api', keysRouter);
```

- [ ] **Step 3: Commit**

```bash
git add api/src/routes/keys.ts
git commit -m "feat: add self-serve key export endpoint with 7-day rate limit"
```
