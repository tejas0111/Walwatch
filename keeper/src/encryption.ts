/**
 * Encryption utility for secrets at rest (keeper side).
 *
 * Matches the implementation in api/src/lib/encryption.ts.
 * Uses AES-256-GCM with key derived from SECRETS_ENCRYPTION_KEY env var.
 *
 * The keeper uses this to decrypt notification channel credentials
 * (webhook URLs, tokens) before sending notifications.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const rawKey = process.env.SECRETS_ENCRYPTION_KEY;
  if (!rawKey) {
    if (process.env.NODE_ENV !== 'production') {
      return Buffer.from(crypto.hkdfSync('sha256', Buffer.from('dev-only-key-do-not-use-in-production'), '', '', 32));
    }
    throw new Error(
      'SECRETS_ENCRYPTION_KEY environment variable is required in production. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(rawKey), '', '', 32));
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = deriveKey();
  }
  return cachedKey;
}

/**
 * Decrypt a string that was encrypted with encrypt().
 * Expected format: `iv:authTag:ciphertext` (hex-encoded).
 */
export function decrypt(encryptedData: string): string {
  const key = getKey();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format — expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext!, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a string appears to be encrypted (matches the iv:authTag:ciphertext format).
 */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value);
}
