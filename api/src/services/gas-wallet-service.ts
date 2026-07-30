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

const GAS_WALLET_PRIMARY_KEY = process.env.GAS_WALLET_PRIMARY_KEY;
const GAS_WALLET_STANDBY_KEY = process.env.GAS_WALLET_STANDBY_KEY;
// Cold reserve top-up is a manual/offline step — the cold key MUST NOT
// reside in the hot API process. Use a separate script or hardware wallet
// to periodically refill the primary gas wallet.

function ensurePrimary(): Ed25519Keypair {
  if (!primaryKeypair) {
    if (!GAS_WALLET_PRIMARY_KEY) {
      throw new Error('GAS_WALLET_PRIMARY_KEY not set');
    }
    const bytes = Uint8Array.from(Buffer.from(GAS_WALLET_PRIMARY_KEY, 'hex'));
    primaryKeypair = Ed25519Keypair.fromSecretKey(bytes);
  }
  return primaryKeypair;
}

function ensureStandby(): Ed25519Keypair | null {
  if (!standbyKeypair && GAS_WALLET_STANDBY_KEY) {
    const bytes = Uint8Array.from(Buffer.from(GAS_WALLET_STANDBY_KEY, 'hex'));
    standbyKeypair = Ed25519Keypair.fromSecretKey(bytes);
  }
  return standbyKeypair;
}

export function getGasWallet(): { keypair: Ed25519Keypair; address: string } {
  const kp = ensurePrimary();
  return { keypair: kp, address: kp.toSuiAddress() };
}

export async function checkBalance(): Promise<{ primary: bigint; standby: bigint; status: string }> {
  const kp = ensurePrimary();
  const primary = await client.getBalance({ owner: kp.toSuiAddress() });
  const standbyBalance = (() => {
    const sk = ensureStandby();
    if (!sk) return BigInt(0);
    return client.getBalance({ owner: sk.toSuiAddress() }).then(r => BigInt(r.totalBalance));
  })();
  const status = BigInt(primary.totalBalance) < BigInt(10_000_000_000) ? 'LOW' : 'OK';
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
