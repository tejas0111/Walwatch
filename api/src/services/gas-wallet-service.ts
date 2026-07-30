import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ name: 'gas-wallet-service' });

const client = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: 'testnet' });

export interface GasObjectRef {
  objectId: string;
  version: string;
  digest: string;
}

let primaryKeypair: Ed25519Keypair | null = null;
let standbyKeypair: Ed25519Keypair | null = null;

// Read private keys and create keypairs immediately, then scrub env and raw strings.
// This prevents exposure via /proc/self/environ or other process.env readers.
(function init(): void {
  const rawPrimary = process.env.GAS_WALLET_PRIMARY_KEY;
  const rawStandby = process.env.GAS_WALLET_STANDBY_KEY;
  delete process.env.GAS_WALLET_PRIMARY_KEY;
  delete process.env.GAS_WALLET_STANDBY_KEY;

  if (rawPrimary) {
    primaryKeypair = Ed25519Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(rawPrimary, 'hex')),
    );
  }
  if (rawStandby) {
    standbyKeypair = Ed25519Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(rawStandby, 'hex')),
    );
  }
  // rawPrimary and rawStandby go out of scope here — eligible for GC.
  // The keypairs still hold private keys in memory (unavoidable in JS),
  // but the hex-encoded source strings are released from the IIFE scope.
})();

// Cold reserve top-up is a manual/offline step — the cold key MUST NOT
// reside in the hot API process. Use a separate script or hardware wallet
// to periodically refill the primary gas wallet.

/**
 * Get the primary gas wallet keypair (already initialized at module load).
 * Prefer this over getGasWalletPrimaryKeyBytes() to avoid exposing raw key bytes.
 */
export function getPrimaryGasWalletKeypair(): Ed25519Keypair {
  if (!primaryKeypair) {
    throw new Error('GAS_WALLET_PRIMARY_KEY not set — gas wallet unavailable');
  }
  return primaryKeypair;
}

/**
 * Export gas wallet primary key bytes for use by other services.
 * @deprecated Use getPrimaryGasWalletKeypair() instead to avoid raw byte exposure.
 */
export function getGasWalletPrimaryKeyBytes(): string {
  return getPrimaryGasWalletKeypair().getSecretKey();
}

export function getGasWallet(): { keypair: Ed25519Keypair; address: string } {
  const kp = getPrimaryGasWalletKeypair();
  return { keypair: kp, address: kp.toSuiAddress() };
}

export async function checkBalance(): Promise<{ primary: bigint; standby: bigint; status: string }> {
  const kp = getPrimaryGasWalletKeypair();
  const primary = await client.getBalance({ owner: kp.toSuiAddress() });
  const standbyBalance = (() => {
    if (!standbyKeypair) return BigInt(0);
    return client.getBalance({ owner: standbyKeypair.toSuiAddress() }).then(r => BigInt(r.totalBalance));
  })();
  const status = BigInt(primary.totalBalance) < config.gasWalletMinBalanceMist ? 'LOW' : 'OK';
  return { primary: BigInt(primary.totalBalance), standby: BigInt(await standbyBalance), status };
}

export async function selectGasCoin(ownerAddress: string, minBalance?: bigint): Promise<GasObjectRef> {
  const coins = await client.getCoins({ owner: ownerAddress, coinType: '0x2::sui::SUI' });
  if (!coins.data || coins.data.length === 0) {
    throw new Error(`No SUI gas coins found for gas wallet ${ownerAddress}`);
  }
  // Prefer a coin that individually covers the minimum balance.
  // If none qualifies, fall back to the largest coin (merge coins offline instead).
  const threshold = minBalance ?? BigInt(10_000_000);
  const sorted = [...coins.data].sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));
  const best = sorted.find((c) => BigInt(c.balance) >= threshold) ?? sorted[0];
  return { objectId: best.coinObjectId, version: best.version, digest: best.digest };
}

/** Cold-reserve top-up is a manual/offline step. The gas wallet must be
 *  refilled externally (e.g., via a separate offline signing process or
 *  hardware wallet). This function is intentionally not implemented in
 *  the hot API process — remove GAS_WALLET_COLD_KEY from the environment. */

let balanceMonitorInterval: ReturnType<typeof setInterval> | null = null;

export function startBalanceMonitor(intervalMs = 5 * 60 * 1000): void {
  if (balanceMonitorInterval) return;
  balanceMonitorInterval = setInterval(async () => {
    try {
      const { primary, status } = await checkBalance();
      if (status === 'LOW') {
        logger.error({ primaryMist: primary.toString() }, 'GAS WALLET LOW');
      }
    } catch (err) {
      logger.error({ err }, 'Gas balance check failed');
    }
  }, intervalMs);
}

export function stopBalanceMonitor(): void {
  if (balanceMonitorInterval) {
    clearInterval(balanceMonitorInterval);
    balanceMonitorInterval = null;
  }
}
