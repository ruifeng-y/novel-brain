import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertUserStorageKey } from '@novel/core';
import { Client } from 'minio';

@Injectable()
export class ObjectStorageService {
  private readonly client: Client;
  private readonly bucket: string;
  private bucketReady?: Promise<void>;

  constructor(config: ConfigService) {
    const endpoint = new URL(config.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000');
    const useSsl = endpoint.protocol === 'https:';
    this.client = new Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port || (useSsl ? 443 : 80)),
      useSSL: useSsl,
      accessKey: config.get<string>('MINIO_ACCESS_KEY') ?? 'minio',
      secretKey: config.get<string>('MINIO_SECRET_KEY') ?? 'minio123',
    });
    this.bucket = config.get<string>('MINIO_BUCKET') ?? 'novel-brain';
  }

  async putObject(
    userId: string,
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<void> {
    assertUserStorageKey(userId, key);
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, data, data.length, {
      'Content-Type': contentType,
    });
  }

  async getObject(userId: string, key: string): Promise<Buffer> {
    assertUserStorageKey(userId, key);
    await this.ensureBucket();
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async removeObject(userId: string, key: string): Promise<void> {
    assertUserStorageKey(userId, key);
    await this.ensureBucket();
    await this.client.removeObject(this.bucket, key);
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = this.prepareBucket();
    }
    await this.bucketReady;
  }

  private async prepareBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }
}
