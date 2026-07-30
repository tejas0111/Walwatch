/**
 * Encryption utility for secrets at rest.
 *
 * Uses AES-256-GCM to encrypt sensitive data before storing it in the database.
 * Supports key versioning for rotation: each version derives a unique key from
 * the same SECRETS_ENCRYPTION_KEY using version-specific HKDF salts.
 *
 * The key version is embedded in the output format: `version:iv:authTag:ciphertext`.
 * Old format `iv:authTag:ciphertext` (no version) is treated as version 1 for
 * backward compatibility.
 *
 * Usage:
 *   const encrypted = encrypt(webhookSecret);
 *   const decrypted = decrypt(encrypted);
 *   const rotated = reEncrypt(encrypted);  // re-encrypt with current key version
 *
 * If SECRETS_ENCRYPTION_KEY is not set, encryption falls back to a development-only
 * warning mode. Production deployments MUST set this variable.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export const CURRENT_KEY_VERSION = Number(config.secretsEncryptionKeyVersion) || 1;

const keyCache = new Map<number, Buffer>();

function deriveKey(version: number): Buffer {
  const rawKey = config.secretsEncryptionKey;
  if (!rawKey) {
    if (config.nodeEnv !== 'production') {
      console.warn(
        '[encryption] SECRETS_ENCRYPTION_KEY not set — using derived dev-only key. ' +
          'Set SECRETS_ENCRYPTION_KEY in production.',
      );
      return Buffer.from(crypto.hkdfSync('sha256', Buffer.from('dev-only-key-do-not-use-in-production'), `v${version}`, '', 32));
    }
    throw new Error(
      'SECRETS_ENCRYPTION_KEY environment variable is required in production. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(rawKey), `v${version}`, '', 32));
}

function getKey(version: number = CURRENT_KEY_VERSION): Buffer {
  if (!keyCache.has(version)) {
    keyCache.set(version, deriveKey(version));
  }
  return keyCache.get(version)!;
}

/**
 * Encrypt a plaintext string.
 * Returns a colon-delimited string: `version:iv:authTag:ciphertext` (all hex-encoded).
 * Each encryption uses a fresh random IV for semantic security.
 * If keyVersion is omitted, the current key version is used.
 */
export function encrypt(plaintext: string, keyVersion?: number): string {
  const version = keyVersion ?? CURRENT_KEY_VERSION;
  const key = getKey(version);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${version}:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string that was encrypted with encrypt().
 * Supports both the current format (version:iv:authTag:ciphertext) and the
 * legacy format (iv:authTag:ciphertext, assumed version 1).
 * Validates the authentication tag to detect tampering.
 * Returns the original plaintext, or throws if the data is corrupt or tampered with.
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');

  let version: number;
  let ivHex: string;
  let authTagHex: string;
  let ciphertext: string;

  if (parts.length === 4) {
    version = parseInt(parts[0]!, 10);
    ivHex = parts[1]!;
    authTagHex = parts[2]!;
    ciphertext = parts[3]!;
  } else if (parts.length === 3) {
    version = 1;
    ivHex = parts[0]!;
    authTagHex = parts[1]!;
    ciphertext = parts[2]!;
  } else {
    throw new Error('Invalid encrypted data format — expected version:iv:authTag:ciphertext or legacy iv:authTag:ciphertext');
  }

  const key = getKey(version);
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext!, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Re-encrypt a value with a new key version (for key rotation).
 * Decrypts using the version embedded in the data, then encrypts with the current
 * (or specified) key version.
 */
export function reEncrypt(encryptedData: string, newVersion?: number): string {
  const plaintext = decrypt(encryptedData);
  return encrypt(plaintext, newVersion);
}
