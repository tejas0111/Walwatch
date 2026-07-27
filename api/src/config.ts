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
};
