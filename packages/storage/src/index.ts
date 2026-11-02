import { assertUserStorageKey, userStoragePrefix } from '@novel/core';
import { Client } from 'minio';

export type ObjectStorageConfig = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
};

export class ObjectStorageClient {
  private readonly client: Client;
  private bucketReady?: Promise<void>;

  constructor(private readonly config: ObjectStorageConfig) {
    const endpoint = new URL(config.endpoint);
    const useSsl = endpoint.protocol === 'https:';
    this.client = new Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port || (useSsl ? 443 : 80)),
      useSSL: useSsl,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  async putObject(userId: string, key: string, data: Buffer, contentType: string): Promise<void> {
    assertUserStorageKey(userId, key);
    await this.ensureBucket();
    await this.client.putObject(this.config.bucket, key, data, data.length, {
      'Content-Type': contentType,
    });
  }

  async getObject(userId: string, key: string): Promise<Buffer> {
    assertUserStorageKey(userId, key);
    await this.ensureBucket();
    const stream = await this.client.getObject(this.config.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async removeObject(userId: string, key: string): Promise<void> {
    assertUserStorageKey(userId, key);
    await this.ensureBucket();
    await this.client.removeObject(this.config.bucket, key);
  }

  async removeUserObjects(userId: string): Promise<void> {
    const prefix = `${userStoragePrefix(userId)}/`;
    await this.ensureBucket();
    const objects = this.client.listObjectsV2(this.config.bucket, prefix, true);
    for await (const item of objects) {
      if (item.name) {
        await this.client.removeObject(this.config.bucket, item.name);
      }
    }
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = this.prepareBucket();
    }
    await this.bucketReady;
  }

  private async prepareBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.config.bucket);
    if (!exists) {
      await this.client.makeBucket(this.config.bucket);
    }
  }
}
