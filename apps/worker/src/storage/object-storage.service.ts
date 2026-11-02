import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageClient } from '@novel/storage';

@Injectable()
export class ObjectStorageService {
  private readonly client: ObjectStorageClient;

  constructor(config: ConfigService) {
    this.client = new ObjectStorageClient({
      endpoint: config.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000',
      accessKey: config.get<string>('MINIO_ACCESS_KEY') ?? 'minio',
      secretKey: config.get<string>('MINIO_SECRET_KEY') ?? 'minio123',
      bucket: config.get<string>('MINIO_BUCKET') ?? 'novel-brain',
    });
  }

  putObject(userId: string, key: string, data: Buffer, contentType: string): Promise<void> {
    return this.client.putObject(userId, key, data, contentType);
  }

  getObject(userId: string, key: string): Promise<Buffer> {
    return this.client.getObject(userId, key);
  }

  removeUserObjects(userId: string): Promise<void> {
    return this.client.removeUserObjects(userId);
  }
}
