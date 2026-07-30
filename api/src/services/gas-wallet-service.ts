import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ name: 'gas-wallet-service' });

const client = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: 'testnet' });

let primaryKeypair: Ed25519Keypair | null = null;
let standbyKeypair: Ed25519Keypair | null = null;

const GAS_WALLET_PRIMARY_KEY = process.env.GAS_WALLET_PRIMARY_KEY;
const GAS_WALLET_STANDBY_KEY = process.env.GAS_WALLET_STANDBY_KEY;
const GAS_WALLET_COLD_KEY = process.env.GAS_WALLET_COLD_KEY;

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

export async function selectGasCoin(ownerAddress: string): Promise<string> {
  const coins = await client.getCoins({ owner: ownerAddress, coinType: '0x2::sui::SUI' });
  if (!coins.data || coins.data.length === 0) {
    throw new Error(`No SUI gas coins found for ${ownerAddress}`);
  }
  return coins.data[0].coinObjectId;
}

export async function topUpFromColdReserve(amount: bigint): Promise<string> {
  if (!GAS_WALLET_COLD_KEY) throw new Error('Cold reserve key not configured');
  const coldKeyBytes = Uint8Array.from(Buffer.from(GAS_WALLET_COLD_KEY, 'hex'));
  const coldKeypair = Ed25519Keypair.fromSecretKey(coldKeyBytes);
  const kp = ensurePrimary();
  const tx = new Transaction();
  tx.transferObjects([tx.gas], kp.toSuiAddress());
  tx.setSender(coldKeypair.toSuiAddress());

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: coldKeypair,
    options: { showEffects: true },
  });

  return result.digest;
}

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
