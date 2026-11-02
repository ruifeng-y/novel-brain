import { describe, expect, it } from 'vitest';
import { signDownloadToken, verifyDownloadToken } from './download-token';

const SECRET = 'download-signing-secret-at-least-32-characters';
const CLAIMS = {
  exportId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  workId: '33333333-3333-4333-8333-333333333333',
  branchId: '44444444-4444-4444-8444-444444444444',
};
const NOW = new Date('2026-11-03T00:00:00.000Z');

describe('export download tokens', () => {
  it('signs and verifies an export download until its short expiry', () => {
    const token = signDownloadToken(CLAIMS, SECRET, {
      now: NOW,
      ttlSeconds: 300,
    });

    expect(verifyDownloadToken(token, SECRET, { now: NOW })).toMatchObject({
      ...CLAIMS,
      exp: Math.floor(NOW.getTime() / 1000) + 300,
    });
    expect(
      verifyDownloadToken(token, SECRET, {
        now: new Date(NOW.getTime() + 301_000),
      }),
    ).toBeNull();
  });

  it('rejects tampered, malformed, and differently-signed tokens', () => {
    const token = signDownloadToken(CLAIMS, SECRET, { now: NOW, ttlSeconds: 300 });
    const [payload, signature] = token.split('.');
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}`;

    expect(verifyDownloadToken(`${tamperedPayload}.${signature}`, SECRET, { now: NOW })).toBeNull();
    expect(
      verifyDownloadToken(token, 'different-signing-secret-at-least-32-characters', { now: NOW }),
    ).toBeNull();
    expect(verifyDownloadToken('not-a-token', SECRET, { now: NOW })).toBeNull();
    expect(verifyDownloadToken(`${token}.extra`, SECRET, { now: NOW })).toBeNull();
  });
});
