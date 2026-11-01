import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = 'v1';
const AAD = Buffer.from('novel-brain:model-config:v1');

function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error('MODEL_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  return key;
}

@Injectable()
export class ModelKeyCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = parseEncryptionKey(config.getOrThrow<string>('MODEL_KEY_ENCRYPTION_KEY'));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      FORMAT_VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const [version, ivValue, authTagValue, encryptedValue] = payload.split('.');
    if (version !== FORMAT_VERSION || !ivValue || !authTagValue || !encryptedValue) {
      throw new Error('Stored model key has an unsupported format');
    }

    const iv = Buffer.from(ivValue, 'base64url');
    const authTag = Buffer.from(authTagValue, 'base64url');
    const encrypted = Buffer.from(encryptedValue, 'base64url');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error('Stored model key has invalid encryption metadata');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
