import { describe, expect, it } from 'vitest';
import {
  decryptModelKey,
  encryptModelKey,
  parseModelKeyEncryptionKey,
} from './model-key-cipher';

const MASTER_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const API_KEY = 'sk-envelope-secret-that-must-not-appear';

describe('model key envelope encryption', () => {
  it('wraps a fresh data key for every record and never stores plaintext', () => {
    const first = encryptModelKey(API_KEY, MASTER_KEY);
    const second = encryptModelKey(API_KEY, MASTER_KEY);

    expect(first).toMatch(/^v2\./);
    expect(second).toMatch(/^v2\./);
    expect(first).not.toBe(second);
    expect(first).not.toContain(API_KEY);
    expect(second).not.toContain(API_KEY);
    expect(decryptModelKey(first, MASTER_KEY)).toBe(API_KEY);
    expect(decryptModelKey(second, MASTER_KEY)).toBe(API_KEY);
  });

  it('rejects a wrapped data key that was tampered with', () => {
    const payload = encryptModelKey(API_KEY, MASTER_KEY);
    const parts = payload.split('.');
    const wrappedKey = Buffer.from(parts[3], 'base64url');
    wrappedKey[0] ^= 1;
    parts[3] = wrappedKey.toString('base64url');

    expect(() => decryptModelKey(parts.join('.'), MASTER_KEY)).toThrow();
  });

  it('still decrypts keys written with the legacy format', () => {
    const legacyPayload = 'v1.BwcHBwcHBwcHBwcH.j35eg4vyPWer2I3LqC1jIw.R7-dOT-j2Ah0zA';

    expect(decryptModelKey(legacyPayload, MASTER_KEY)).toBe('legacy-key');
  });

  it('keeps a 32-byte master key requirement', () => {
    expect(() => parseModelKeyEncryptionKey('too-short')).toThrow(
      'MODEL_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes',
    );
  });
});
