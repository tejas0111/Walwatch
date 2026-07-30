import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import pino from 'pino';

import { requireAuth, requireReAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { VaultService, SpendCapExceededError } from '../services/vaultService.js';
import { ErrorCodes } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { getDb } from '../db/index.js';
import { wallets, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

type Variables = {
  userId: string;
  orgId: string;
};

const router = new Hono<{ Variables: Variables }>();
const log = pino({ name: 'vault-routes' });
const vaultService = new VaultService();

router.use('*', requireAuth);
router.use('*', requireOrg);
router.post('*', rateLimit({ windowMs: 60 * 1000, max: 30 }));

async function verifyAddressInOrg(c: Context, address: string): Promise<boolean> {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const db = getDb();

  const [wallet] = await db.select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.orgId, orgId), eq(wallets.address, address)))
    .limit(1);
  if (wallet) return true;

  const [user] = await db.select({ zkloginAddress: users.zkloginAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user?.zkloginAddress === address) return true;

  return false;
}

const suiAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'Invalid Sui address format');

const createVaultSchema = z.object({
  wallet_address: suiAddressSchema,
  blob_id: z.string().min(1),
  initial_wal_amount: z.string().min(1),
  renew_threshold_epochs: z.number().int().positive(),
  renew_by_epochs: z.number().int().positive(),
  max_total_epochs: z.number().int().positive(),
});

const depositSchema = z.object({
  wallet_address: suiAddressSchema,
  amount: z.string().min(1),
});

const updatePolicySchema = z.object({
  wallet_address: suiAddressSchema,
  renew_threshold_epochs: z.number().int().positive(),
  renew_by_epochs: z.number().int().positive(),
  max_total_epochs: z.number().int().positive(),
  active: z.boolean(),
});

const withdrawSchema = z.object({
  wallet_address: suiAddressSchema,
  amount: z.string().min(1),
});

const reclaimSchema = z.object({
  wallet_address: suiAddressSchema,
});

// POST /api/vaults — Build unsigned create-vault tx
router.post('/', zValidator('json', createVaultSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    if (!await verifyAddressInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const result = await vaultService.buildCreateVaultTx(userId, orgId, {
      blobId: body.blob_id,
      amount: Number(body.initial_wal_amount),
      threshold: body.renew_threshold_epochs,
      extension: body.renew_by_epochs,
      maxEpochs: body.max_total_epochs,
    });
    await logAudit(c, 'vault.created', 'vault', '', { blobId: body.blob_id, txBytes: result.txBytes.substring(0, 16) + '…' });
    return c.json(result);
  } catch (error) {
    log.error({ error }, 'Failed to build create-vault tx');
    return c.json({ error: { message: 'Vault creation failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// GET /api/vaults — List all vaults
router.get('/', async (c) => {
  try {
    const orgId = c.get('orgId');
    const db = getDb();

    const orgWallets = await db.select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.orgId, orgId), eq(wallets.status, 'active')));

    const results = await Promise.all(
      orgWallets.map(async (wallet) => {
        const vaults = await vaultService.getVaults(wallet.address);
        return vaults.map((v) => ({ ...v, walletAddress: wallet.address }));
      }),
    );

    return c.json({ vaults: results.flat() });
  } catch (error) {
    log.error({ error }, 'Failed to list vaults');
    return c.json({ error: { message: 'Failed to list vaults', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/deposit — Build unsigned deposit tx
router.post('/:vaultId/deposit', zValidator('json', depositSchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyAddressInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const userId = c.get('userId');
    const result = await vaultService.buildDepositTx(userId, vaultId, Number(body.amount));
    await logAudit(c, 'vault.deposited', 'vault', vaultId, { amount: body.amount, txBytes: result.txBytes.substring(0, 16) + '…' });
    return c.json(result);
  } catch (error) {
    log.error({ error }, 'Failed to build deposit tx');
    return c.json({ error: { message: 'Deposit failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/policy — Build unsigned policy-update tx
router.post('/:vaultId/policy', zValidator('json', updatePolicySchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyAddressInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const userId = c.get('userId');
    const result = await vaultService.buildUpdatePolicyTx(userId, vaultId, body);
    await logAudit(c, 'vault.policy_updated', 'vault', vaultId, { txBytes: result.txBytes.substring(0, 16) + '…' });
    return c.json(result);
  } catch (error) {
    log.error({ error }, 'Failed to build policy-update tx');
    return c.json({ error: { message: 'Policy update failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/withdraw — Build unsigned withdraw tx (re-auth gated)
router.post('/:vaultId/withdraw', requireReAuth, zValidator('json', withdrawSchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyAddressInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const result = await vaultService.buildWithdrawTx(userId, orgId, vaultId, Number(body.amount));
    await logAudit(c, 'vault.withdrawn', 'vault', vaultId, { amount: body.amount, txBytes: result.txBytes.substring(0, 16) + '…' });
    return c.json(result);
  } catch (error) {
    if (error instanceof SpendCapExceededError) {
      return c.json({ error: { message: error.message, code: ErrorCodes.RATE_LIMITED } }, 429);
    }
    log.error({ error }, 'Failed to build withdraw tx');
    return c.json({ error: { message: 'Withdrawal failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/reclaim — Build unsigned reclaim tx
router.post('/:vaultId/reclaim', zValidator('json', reclaimSchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyAddressInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const userId = c.get('userId');
    const result = await vaultService.buildReclaimTx(userId, vaultId);
    await logAudit(c, 'vault.reclaimed', 'vault', vaultId, { txBytes: result.txBytes.substring(0, 16) + '…' });
    return c.json(result);
  } catch (error) {
    log.error({ error }, 'Failed to build reclaim tx');
    return c.json({ error: { message: 'Reclaim failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

const submitSchema = z.object({
  txBytes: z.string().min(1),
  userSignature: z.string().min(1),
  zkloginProof: z.any(),
  maxEpoch: z.number().int().positive(),
});

// POST /api/vaults/submit — Submit a user-signed transaction
router.post('/submit', zValidator('json', submitSchema), async (c) => {
  try {
    const body = c.req.valid('json') as { txBytes: string; userSignature: string; zkloginProof: any; maxEpoch: number };
    const result = await vaultService.submitTx(body);
    return c.json(result);
  } catch (error) {
    log.error({ error }, 'Failed to submit tx');
    return c.json({ error: { message: 'Transaction submission failed', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// GET /api/vaults/:vaultId/history
router.get('/:vaultId/history', async (c) => {
  try {
    const { vaultId } = c.req.param();
    const vault = await vaultService.getVaultById(vaultId);
    if (!vault) {
      return c.json({ error: { message: 'Vault not found', code: ErrorCodes.NOT_FOUND } }, 404);
    }
    if (!await verifyAddressInOrg(c, vault.beneficiary)) {
      return c.json({ error: { message: 'Vault does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const history = await vaultService.getVaultHistory(vaultId, page, limit);
    return c.json({ history, page, limit });
  } catch (error) {
    log.error({ error }, 'Failed to get vault history');
    return c.json({ error: { message: 'Failed to get vault history', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// GET /api/vaults/:param
router.get('/:param', async (c) => {
  try {
    const { param } = c.req.param();

    const vault = await vaultService.getVaultById(param);
    if (vault) {
      if (!await verifyAddressInOrg(c, vault.beneficiary)) {
        return c.json({ error: { message: 'Vault does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
      }
      return c.json({ vault });
    }

    if (await verifyAddressInOrg(c, param)) {
      const vaults = await vaultService.getVaults(param);
      return c.json({ vaults });
    }

    return c.json({ error: { message: 'Not found', code: ErrorCodes.NOT_FOUND } }, 404);
  } catch (error) {
    log.error({ error }, 'Failed to get vault(s)');
    return c.json({ error: { message: 'Failed to get vault(s)', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

export { router as vaultRoutes };
