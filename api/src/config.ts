import 'dotenv/config';

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    // Dev defaults
    if (process.env.NODE_ENV !== 'production') {
      return ['http://localhost:3000', 'http://localhost:5173'];
    }
    return [];
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: (() => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('DATABASE_URL must be set in production');
      }
      return 'postgres://postgres:postgres@localhost:5432/walwatch';
    }
    return url;
  })(),
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret && ((process.env.NODE_ENV || 'development') === 'production' || (process.env.NODE_ENV || '').startsWith('prod') || process.env.NODE_ENV === 'staging')) {
      throw new Error('JWT_SECRET environment variable is required in production/staging');
    }
    if (!secret && process.env.NODE_ENV !== 'production') {
      console.warn('[config] ⚠️  WARNING: Using DEV JWT secret. Set JWT_SECRET in production.');
    }
    return secret || 'dev-secret-change-in-production';
  })(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  suiRpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443',
  packageId: process.env.PACKAGE_ID || '',
  systemObjectId: process.env.SYSTEM_OBJECT_ID || '',
  walCoinType: process.env.WAL_COIN_TYPE || '',
  allowedOrigins: parseAllowedOrigins(),
  requestSizeLimit: process.env.REQUEST_SIZE_LIMIT || '1mb',
  keeperHealthUrl: process.env.KEEPER_HEALTH_URL || '',
  /** Encryption key for secrets at rest (AES-256-GCM). Required in production. */
  secretsEncryptionKey: process.env.SECRETS_ENCRYPTION_KEY || '',
  /** Key version for secret rotation. Increment to trigger rotation. */
  secretsEncryptionKeyVersion: process.env.SECRETS_ENCRYPTION_KEY_VERSION || '1',
  /** zkLogin prover URL (Mysten hosted or self-hosted) */
  zkProverUrl: process.env.ZK_PROVER_URL || 'https://prover.mystenlabs.com/v1',
  /**
   * Separate secret for zkLogin salt derivation.
   * Must NOT be the same as secretsEncryptionKey.
   */
  appSaltSecret: process.env.APP_SALT_SECRET || '',
  /** Fee config cache TTL in milliseconds (default 5 min). */
  feeConfigCacheTtlMs: parseInt(process.env.FEE_CONFIG_CACHE_TTL_MS || '300000', 10),
  /**
   * Gas wallet minimum balance threshold in MIST.
   * When primary balance drops below this, status changes to 'LOW'.
   * Default: 10 SUI (10_000_000_000 MIST).
   */
  gasWalletMinBalanceMist: (() => {
    const raw = process.env.GAS_WALLET_MIN_BALANCE_MIST || '10000000000';
    try { return BigInt(raw); } catch { return BigInt('10000000000'); }
  })(),
  /**
   * JWT key ID for key rotation support.
   * Increment to rotate signing keys. Old tokens with different kid
   * will still validate if kid is in the known rotation history.
   * Set to empty string (default) to omit kid from header.
   */
  jwtKeyId: process.env.JWT_KEY_ID || '',
  /**
   * Previous JWT secrets for key rotation (comma-separated).
   * When rotating JWT_SECRET, add the old value(s) here so existing
   * tokens remain valid until they expire naturally.
   * Format: "old-secret-1,old-secret-2"
   */
  jwtOldSecrets: (() => {
    const raw = process.env.JWT_OLD_SECRETS;
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  })(),

  /**
   * Gas budget for create_vault transactions in MIST.
   */
  gasBudgetCreateVault: parseInt(process.env.GAS_BUDGET_CREATE_VAULT || '10000000', 10),
  /**
   * Default gas budget for other vault transactions (deposit, withdraw, etc.) in MIST.
   */
  gasBudgetDefault: parseInt(process.env.GAS_BUDGET_DEFAULT || '5000000', 10),
};
