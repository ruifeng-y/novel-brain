import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DOWNLOAD_TTL_MS = 10 * 60 * 1_000;

@Injectable()
export class AccountExportDownloadSigner {
  constructor(private readonly config: ConfigService) {}

  create(
    userId: string,
    exportId: string,
    now = Date.now(),
  ): { expiresAt: number; signature: string } {
    const expiresAt = now + DOWNLOAD_TTL_MS;
    return {
      expiresAt,
      signature: this.sign(userId, exportId, expiresAt),
    };
  }

  verify(
    userId: string,
    exportId: string,
    expiresAt: number,
    signature: string,
    now = Date.now(),
  ): boolean {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      return false;
    }
    const expected = Buffer.from(this.sign(userId, exportId, expiresAt));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign(userId: string, exportId: string, expiresAt: number): string {
    return createHmac('sha256', this.config.getOrThrow<string>('SESSION_SECRET'))
      .update(`account-export:${userId}:${exportId}:${expiresAt}`)
      .digest('base64url');
  }
}
