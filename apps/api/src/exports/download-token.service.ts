import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  signDownloadToken,
  verifyDownloadToken,
  type ExportDownloadClaims,
  type ExportDownloadInput,
} from '@novel/core';

@Injectable()
export class DownloadTokenService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('DOWNLOAD_SIGNING_SECRET')?.trim() ||
      config.getOrThrow<string>('SESSION_SECRET');
    this.ttlSeconds = config.get<number>('DOWNLOAD_URL_TTL_SECONDS') ?? 300;
  }

  sign(input: ExportDownloadInput, now = new Date()): string {
    return signDownloadToken(input, this.secret, {
      now,
      ttlSeconds: this.ttlSeconds,
    });
  }

  verify(token: string, now = new Date()): ExportDownloadClaims | null {
    return verifyDownloadToken(token, this.secret, { now });
  }
}
