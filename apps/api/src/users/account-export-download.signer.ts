import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_DOWNLOAD_TTL_SECONDS = 10 * 60;

@Injectable()
export class AccountExportDownloadSigner {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('DOWNLOAD_SIGNING_SECRET')?.trim() ||
      config.getOrThrow<string>('SESSION_SECRET');
    this.ttlSeconds =
      config.get<number>('DOWNLOAD_URL_TTL_SECONDS') ?? DEFAULT_DOWNLOAD_TTL_SECONDS;
  }

  create(
    userId: string,
    exportId: string,
    now = Date.now(),
  ): { expiresAt: number; signature: string } {
    const expiresAt = now + this.ttlSeconds * 1_000;
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
    return createHmac('sha256', this.secret)
      .update(`account-export:${userId}:${exportId}:${expiresAt}`)
      .digest('base64url');
  }
}
