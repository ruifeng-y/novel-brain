import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptModelKey,
  encryptModelKey,
  parseModelKeyEncryptionKey,
} from '@novel/ai';

@Injectable()
export class ModelKeyCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = parseModelKeyEncryptionKey(
      config.getOrThrow<string>('MODEL_KEY_ENCRYPTION_KEY'),
    );
  }

  encrypt(plaintext: string): string {
    return encryptModelKey(plaintext, this.key);
  }

  decrypt(payload: string): string {
    return decryptModelKey(payload, this.key);
  }
}
