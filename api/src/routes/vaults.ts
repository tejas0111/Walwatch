/**
 * Vault Routes
 *
 * Implements the vault CRUD endpoints from spec.md §6.
 * All mutation endpoints return unsigned Transaction blocks
 * that the user signs client-side with their own wallet.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import pino from 'pino';

import { requireAuth } from '../middleware/auth.js';
import { requireOrg } from '../middleware/org-scope.js';
import { logAudit } from '../middleware/audit.js';
import { VaultService } from '../services/vaultService.js';
import { ErrorCodes } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { getDb } from '../db/index.js';
import { wallets } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const router = new Hono();
const log = pino({ name: 'vault-routes' });
const vaultService = new VaultService();

// All vault routes require authentication and org context
router.use('*', requireAuth);
router.use('*', requireOrg);
router.post('*', rateLimit({ windowMs: 60 * 1000, max: 30 }));

async function verifyWalletInOrg(c: Context, walletAddress: string): Promise<boolean> {
  const orgId = c.get('orgId');
  const db = getDb();
  const [wallet] = await db.select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.orgId, orgId), eq(wallets.address, walletAddress)))
    .limit(1);
  return !!wallet;
}

// Validation schemas
const suiAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'Invalid Sui address format');

const createVaultSchema = z.object({
  wallet_address: suiAddressSchema,
  blob_id: z.string().min(1),
  initial_wal_amount: z.string().min(1),
  renew_threshold_epochs: z.number().int().positive(),
  renew_by_epochs: z.number().int().positive(),
  max_total_epochs: z.number().int().positive().optional(),
});

const depositSchema = z.object({
  wallet_address: suiAddressSchema,
  amount: z.string().min(1),
});

const updatePolicySchema = z.object({
  wallet_address: suiAddressSchema,
  renew_threshold_epochs: z.number().int().positive(),
  renew_by_epochs: z.number().int().positive(),
  max_total_epochs: z.number().int().positive().optional(),
  active: z.boolean(),
});

const withdrawSchema = z.object({
  wallet_address: suiAddressSchema,
  amount: z.string().min(1),
});

const reclaimSchema = z.object({
  wallet_address: suiAddressSchema,
});

// POST /api/vaults — Build create_vault transaction
router.post('/', zValidator('json', createVaultSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    if (!await verifyWalletInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const tx = await vaultService.buildCreateVaultTx(body);
    await logAudit(c, 'vault.created', 'vault', body.blob_id, { blobId: body.blob_id, initialWalAmount: body.initial_wal_amount });
    return c.json({ transaction: tx });
  } catch (error) {
    log.error({ error }, 'Failed to build create vault tx');
    return c.json({ error: { message: 'Failed to build transaction', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// GET /api/vaults/:walletAddress — Get all vaults for a wallet
router.get('/:walletAddress', async (c) => {
  try {
    const { walletAddress } = c.req.param();
    if (!await verifyWalletInOrg(c, walletAddress)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const vaults = await vaultService.getVaults(walletAddress);
    return c.json({ vaults });
  } catch (error) {
    log.error({ error }, 'Failed to get vaults');
    return c.json({ error: { message: 'Failed to get vaults', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/deposit — Build deposit transaction
router.post('/:vaultId/deposit', zValidator('json', depositSchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyWalletInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const tx = await vaultService.buildDepositTx(vaultId, body);
    await logAudit(c, 'vault.deposited', 'vault', vaultId, { amount: body.amount });
    return c.json({ transaction: tx });
  } catch (error) {
    log.error({ error }, 'Failed to build deposit tx');
    return c.json({ error: { message: 'Failed to build transaction', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/policy — Build update_policy transaction
router.post('/:vaultId/policy', zValidator('json', updatePolicySchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyWalletInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const tx = await vaultService.buildUpdatePolicyTx(vaultId, body);
    await logAudit(c, 'vault.policy_updated', 'vault', vaultId, { renewThresholdEpochs: body.renew_threshold_epochs, renewByEpochs: body.renew_by_epochs });
    return c.json({ transaction: tx });
  } catch (error) {
    log.error({ error }, 'Failed to build update policy tx');
    return c.json({ error: { message: 'Failed to build transaction', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/withdraw — Build withdraw transaction
router.post('/:vaultId/withdraw', zValidator('json', withdrawSchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyWalletInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const tx = await vaultService.buildWithdrawTx(vaultId, body);
    await logAudit(c, 'vault.withdrawn', 'vault', vaultId, { amount: body.amount });
    return c.json({ transaction: tx });
  } catch (error) {
    log.error({ error }, 'Failed to build withdraw tx');
    return c.json({ error: { message: 'Failed to build transaction', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// POST /api/vaults/:vaultId/reclaim — Build reclaim_blob transaction
router.post('/:vaultId/reclaim', zValidator('json', reclaimSchema), async (c) => {
  try {
    const { vaultId } = c.req.param();
    const body = c.req.valid('json');
    if (!await verifyWalletInOrg(c, body.wallet_address)) {
      return c.json({ error: { message: 'Wallet address does not belong to this organization', code: ErrorCodes.FORBIDDEN } }, 403);
    }
    const tx = await vaultService.buildReclaimTx(vaultId, body);
    await logAudit(c, 'vault.reclaimed', 'vault', vaultId, {});
    return c.json({ transaction: tx });
  } catch (error) {
    log.error({ error }, 'Failed to build reclaim tx');
    return c.json({ error: { message: 'Failed to build transaction', code: ErrorCodes.INTERNAL_ERROR } }, 500);
  }
});

// GET /api/vaults/:vaultId/history — Get renewal history
router.get('/:vaultId/history', async (c) => {
  try {
    const { vaultId } = c.req.param();
    // Look up the vault's wallet address to verify org ownership
    const vault = await vaultService.getVaultById(vaultId);
    if (!vault) {
      return c.json({ error: { message: 'Vault not found', code: ErrorCodes.NOT_FOUND } }, 404);
    }
    if (!await verifyWalletInOrg(c, vault.walletAddress)) {
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

export { router as vaultRoutes };
