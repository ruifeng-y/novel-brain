import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AccountExportDownloadSigner } from '../src/users/account-export-download.signer';

describe('account export download signer', () => {
  const signer = new AccountExportDownloadSigner(
    new ConfigService({
      SESSION_SECRET: 'test-session-secret-at-least-16-characters',
    }),
  );
  const userId = '11111111-1111-4111-8111-111111111111';
  const exportId = '22222222-2222-4222-8222-222222222222';

  it('accepts a fresh owner signature and rejects expired or altered links', () => {
    const now = Date.UTC(2026, 10, 3, 0, 0, 0);
    const token = signer.create(userId, exportId, now);

    expect(signer.verify(userId, exportId, token.expiresAt, token.signature, now)).toBe(true);
    expect(
      signer.verify(userId, exportId, token.expiresAt, token.signature, token.expiresAt),
    ).toBe(false);
    expect(
      signer.verify(userId, exportId, token.expiresAt, `${token.signature.slice(0, -1)}A`, now),
    ).toBe(false);
    expect(
      signer.verify(
        '33333333-3333-4333-8333-333333333333',
        exportId,
        token.expiresAt,
        token.signature,
        now,
      ),
    ).toBe(false);
  });
});
