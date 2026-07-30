import { computeZkLoginAddress, jwtToAddress, getZkLoginSignature } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const APP_SALT_SECRET = (() => {
  const s = config.secretsEncryptionKey;
  if (!s && config.nodeEnv === 'production') {
    throw new Error('APP_SALT_SECRET / SECRETS_ENCRYPTION_KEY must be set in production');
  }
  return s || 'dev-salt-do-not-use-in-production';
})();

export function computeSalt(oauthSubject: string): string {
  const hmac = createHash('sha256')
    .update(`${oauthSubject}:${APP_SALT_SECRET}`)
    .digest('hex');
  return BigInt('0x' + hmac).toString();
}

export function deriveZkLoginAddress(
  iss: string,
  sub: string,
  aud: string,
  salt: string,
): string {
  return computeZkLoginAddress({
    claimName: 'sub',
    claimValue: sub,
    iss,
    aud,
    userSalt: salt,
    legacyAddress: false,
  });
}

export function deriveZkLoginAddressFromJwt(
  jwt: string,
  userSalt: string | bigint,
): string {
  return jwtToAddress(jwt, userSalt, false);
}

export function getIssuer(provider: string): string {
  switch (provider) {
    case 'google': return 'https://accounts.google.com';
    case 'github': return 'https://github.com/login/oauth';
    default: throw new Error(`Unknown OAuth provider: ${provider}`);
  }
}

export function generateEphemeralKeypair(): { keypair: Ed25519Keypair; secretKey: string } {
  const keypair = new Ed25519Keypair();
  const secretKey = Buffer.from(keypair.getSecretKey()).toString('hex');
  return { keypair, secretKey };
}

export function generateJwtRandomness(): string {
  return Buffer.from(randomBytes(32)).toString('hex');
}

export async function generateZkProof(
  jwt: string,
  ephemeralPublicKey: Uint8Array,
  jwtRandomness: string,
  salt: string,
): Promise<{ proof: any; maxEpoch: number }> {
  const proverUrl = config.zkProverUrl || 'https://prover.mystenlabs.com/v1';

  const response = await fetch(proverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jwt,
      extendedEphemeralPublicKey: Buffer.from(ephemeralPublicKey).toString('hex'),
      jwtRandomness,
      salt,
      keyClaimName: 'sub',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ZK proof generation failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  const currentEpoch = result.maxEpoch || 0;
  const maxEpoch = currentEpoch + 30;

  return {
    proof: result.proof as any,
    maxEpoch,
  };
}

export function getEphemeralPublicKey(keypair: Ed25519Keypair): Uint8Array {
  return keypair.getPublicKey().toRawBytes();
}
