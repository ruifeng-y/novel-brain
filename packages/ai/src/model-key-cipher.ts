import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = 'v2';
const LEGACY_VERSION = 'v1';
const LEGACY_AAD = Buffer.from('novel-brain:model-config:v1');
const DATA_AAD = Buffer.from('novel-brain:model-config:data:v2');
const WRAPPED_KEY_AAD = Buffer.from('novel-brain:model-config:wrapped-key:v2');

export function parseModelKeyEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error('MODEL_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  return key;
}

export function encryptModelKey(plaintext: string, encryptionKey: string | Buffer): string {
  const masterKey =
    typeof encryptionKey === 'string'
      ? parseModelKeyEncryptionKey(encryptionKey)
      : encryptionKey;
  const dataKey = randomBytes(KEY_BYTES);

  try {
    const data = seal(Buffer.from(plaintext, 'utf8'), dataKey, DATA_AAD);
    const wrappedKey = seal(dataKey, masterKey, WRAPPED_KEY_AAD);

    return [
      FORMAT_VERSION,
      wrappedKey.iv.toString('base64url'),
      wrappedKey.authTag.toString('base64url'),
      wrappedKey.encrypted.toString('base64url'),
      data.iv.toString('base64url'),
      data.authTag.toString('base64url'),
      data.encrypted.toString('base64url'),
    ].join('.');
  } finally {
    dataKey.fill(0);
  }
}

export function decryptModelKey(payload: string, encryptionKey: string | Buffer): string {
  const masterKey =
    typeof encryptionKey === 'string'
      ? parseModelKeyEncryptionKey(encryptionKey)
      : encryptionKey;
  const parts = payload.split('.');
  const [version] = parts;

  if (version === FORMAT_VERSION) {
    const [
      ,
      wrappedIvValue,
      wrappedTagValue,
      wrappedKeyValue,
      dataIvValue,
      dataTagValue,
      encryptedValue,
    ] = parts;
    if (
      !wrappedIvValue ||
      !wrappedTagValue ||
      !wrappedKeyValue ||
      !dataIvValue ||
      !dataTagValue ||
      !encryptedValue
    ) {
      throw new Error('Stored model key has an unsupported format');
    }

    const dataKey = open(
      {
        iv: decodePart(wrappedIvValue),
        authTag: decodePart(wrappedTagValue),
        encrypted: decodePart(wrappedKeyValue),
      },
      masterKey,
      WRAPPED_KEY_AAD,
    );
    if (dataKey.length !== KEY_BYTES) {
      throw new Error('Stored model key has invalid encryption metadata');
    }

    try {
      return open(
        {
          iv: decodePart(dataIvValue),
          authTag: decodePart(dataTagValue),
          encrypted: decodePart(encryptedValue),
        },
        dataKey,
        DATA_AAD,
      ).toString('utf8');
    } finally {
      dataKey.fill(0);
    }
  }

  const [, ivValue, authTagValue, encryptedValue] = parts;
  if (version !== LEGACY_VERSION || !ivValue || !authTagValue || !encryptedValue) {
    throw new Error('Stored model key has an unsupported format');
  }

  return open(
    {
      iv: decodePart(ivValue),
      authTag: decodePart(authTagValue),
      encrypted: decodePart(encryptedValue),
    },
    masterKey,
    LEGACY_AAD,
  ).toString('utf8');
}

type Sealed = {
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
};

function seal(plaintext: Buffer, key: Buffer, aad: Buffer): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv,
    authTag: cipher.getAuthTag(),
    encrypted,
  };
}

function open(payload: Sealed, key: Buffer, aad: Buffer): Buffer {
  const { iv, authTag, encrypted } = payload;
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Stored model key has invalid encryption metadata');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function decodePart(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
