import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export interface PutObjectInput {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(input: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.bucket = input.bucket;
    this.client = new S3Client({
      endpoint: input.endpoint,
      region: input.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeObjectKey(input.key),
        Body: input.bytes,
        ContentType: input.contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safeObjectKey(key),
      }),
    );
    if (!result.Body) {
      throw new Error("Object storage returned an empty body");
    }
    return result.Body.transformToByteArray();
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: safeObjectKey(key),
      }),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.deleteObject(key);
    }
  }
}

export class FileObjectStorage implements ObjectStorage {
  constructor(private readonly rootDirectory: string) {}

  async putObject(input: PutObjectInput): Promise<void> {
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytes);
  }

  async getObject(key: string): Promise<Uint8Array> {
    return readFile(this.resolve(key));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.deleteObject(key)));
  }

  private resolve(key: string): string {
    const safeKey = safeObjectKey(key);
    const root = path.resolve(this.rootDirectory);
    const target = path.resolve(root, safeKey);
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Object key escapes the configured storage directory");
    }
    return target;
  }
}

export function createObjectStorageFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ObjectStorage {
  if (environment.STORAGE_LOCAL_DIRECTORY) {
    return new FileObjectStorage(environment.STORAGE_LOCAL_DIRECTORY);
  }
  const endpoint = required(environment, "STORAGE_ENDPOINT");
  const accessKeyId = required(environment, "STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = required(environment, "STORAGE_SECRET_ACCESS_KEY");
  const bucket = required(environment, "STORAGE_BUCKET");
  return new S3ObjectStorage({
    endpoint,
    region: environment.STORAGE_REGION ?? "us-east-1",
    accessKeyId,
    secretAccessKey,
    bucket,
  });
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for object storage`);
  }
  return value;
}

function safeObjectKey(key: string): string {
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/u, "");
  if (
    !normalized ||
    normalized.split("/").some((part) => part === "." || part === ".." || part.length === 0)
  ) {
    throw new Error("Object key must be a normalized relative path");
  }
  return normalized;
}
