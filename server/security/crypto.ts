import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let cachedKey: Buffer | null | undefined;

export function getEncryptionKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const fromEnv = process.env.APP_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY precisa ser uma chave de 32 bytes em base64.');
    cachedKey = key;
    return key;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    cachedKey = null;
    return null;
  }
  const path = '.data/dev-encryption-key';
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(32).toString('base64'));
  }
  cachedKey = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  return cachedKey;
}

export function encryptionAvailable(): boolean {
  return getEncryptionKey() != null;
}

export function encryptBytes(bytes: Uint8Array): string {
  const key = getEncryptionKey();
  if (!key) throw new Error('encryption_not_configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptBytes(payload: string): Buffer {
  const key = getEncryptionKey();
  if (!key) throw new Error('encryption_not_configured');
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
