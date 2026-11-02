import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'minio';
import { resolveInside } from './ops-lib.mjs';

const OBJECTS_DIRECTORY = 'objects';
const OBJECTS_MANIFEST = 'objects-manifest.json';

export function objectFileName(key) {
  return `${createHash('sha256').update(key).digest('hex')}.blob`;
}

export function objectSetChecksum(objects) {
  const canonical = [...objects]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((object) => `${object.key}\0${object.sha256}\0${object.sizeBytes}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export function createObjectClient(settings) {
  const endpoint = new URL(settings.objectEndpoint);
  const useSsl = endpoint.protocol === 'https:';
  return new Client({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (useSsl ? 443 : 80)),
    useSSL: useSsl,
    accessKey: settings.objectAccessKey,
    secretKey: settings.objectSecretKey,
  });
}

export async function createObjectBackup(settings, directory) {
  const client = createObjectClient(settings);
  const prefix = normalizePrefix(settings.objectPrefix);
  if (!(await client.bucketExists(settings.objectBucket))) {
    throw new Error(`Object storage bucket "${settings.objectBucket}" was not found`);
  }

  const objectsDirectory = resolveInside(directory, OBJECTS_DIRECTORY);
  await mkdir(objectsDirectory, { recursive: true });
  const objects = [];
  for await (const item of client.listObjectsV2(settings.objectBucket, prefix, true)) {
    if (!item.name || item.name.endsWith('/')) {
      continue;
    }
    const data = await readObject(client, settings.objectBucket, item.name);
    const stat = await client.statObject(settings.objectBucket, item.name);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const file = objectFileName(item.name);
    await writeFile(resolveInside(objectsDirectory, file), data);
    objects.push({
      key: item.name,
      file,
      sizeBytes: data.length,
      sha256,
      etag: String(item.etag ?? ''),
      contentType:
        stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? 'application/octet-stream',
      lastModified: item.lastModified?.toISOString?.() ?? null,
    });
  }

  objects.sort((left, right) => left.key.localeCompare(right.key));
  const manifest = {
    bucket: settings.objectBucket,
    prefix,
    endpoint: settings.objectEndpoint,
    objectCount: objects.length,
    totalBytes: objects.reduce((total, object) => total + object.sizeBytes, 0),
    checksum: objectSetChecksum(objects),
    objects,
  };
  await writeFile(
    path.join(directory, OBJECTS_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return {
    directory: OBJECTS_DIRECTORY,
    manifestFile: OBJECTS_MANIFEST,
    bucket: manifest.bucket,
    prefix: manifest.prefix,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
    checksum: manifest.checksum,
    objects,
  };
}

export async function restoreObjectBackup(settings, backupDirectory, targetBucket, verifyKey) {
  const objectsDirectory = resolveInside(backupDirectory, OBJECTS_DIRECTORY);
  const manifestPath = path.join(backupDirectory, OBJECTS_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error('Object storage manifest was not found in the backup');
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.checksum !== objectSetChecksum(manifest.objects)) {
    throw new Error('Object storage manifest checksum does not match');
  }

  const client = createObjectClient(settings);
  if (!(await client.bucketExists(targetBucket))) {
    await client.makeBucket(targetBucket);
  }
  for (const object of manifest.objects) {
    const filePath = resolveInside(objectsDirectory, object.file);
    if (!existsSync(filePath)) {
      throw new Error(`Object backup file is missing for key ${hashKey(object.key)}`);
    }
    const data = await readFile(filePath);
    if (data.length !== object.sizeBytes) {
      throw new Error(`Object backup size does not match for key ${hashKey(object.key)}`);
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (sha256 !== object.sha256) {
      throw new Error(`Object backup checksum does not match for key ${hashKey(object.key)}`);
    }
    await client.putObject(targetBucket, object.key, data, data.length, {
      'Content-Type': object.contentType || 'application/octet-stream',
    });
  }

  let verifiedObjects = 0;
  let sample = null;
  let verifiedKey = null;
  for (const object of manifest.objects) {
    const restored = await readObject(client, targetBucket, object.key);
    const sha256 = createHash('sha256').update(restored).digest('hex');
    if (sha256 !== object.sha256) {
      throw new Error(`Restored object checksum does not match for key ${hashKey(object.key)}`);
    }
    verifiedObjects += 1;
    sample ??= {
      keyHash: hashKey(object.key),
      sha256,
      sizeBytes: restored.length,
    };
    if (verifyKey && object.key === verifyKey) {
      verifiedKey = {
        keyHash: hashKey(object.key),
        sha256,
        sizeBytes: restored.length,
      };
    }
  }
  if (verifyKey && !verifiedKey) {
    throw new Error(`Required verification object ${hashKey(verifyKey)} was not restored`);
  }

  return {
    bucket: targetBucket,
    objectCount: manifest.objects.length,
    totalBytes: manifest.totalBytes,
    checksum: manifest.checksum,
    verifiedObjects,
    sample,
    verifiedKey,
  };
}

export async function removeBucket(client, bucket) {
  if (!(await client.bucketExists(bucket))) {
    return;
  }
  const names = [];
  for await (const item of client.listObjectsV2(bucket, '', true)) {
    if (item.name) {
      names.push(item.name);
    }
  }
  for (const name of names) {
    await client.removeObject(bucket, name);
  }
  await client.removeBucket(bucket);
}

export async function putObject(settings, key, data, contentType = 'application/octet-stream') {
  const client = createObjectClient(settings);
  if (!(await client.bucketExists(settings.objectBucket))) {
    await client.makeBucket(settings.objectBucket);
  }
  await client.putObject(settings.objectBucket, key, data, data.length, {
    'Content-Type': contentType,
  });
}

function normalizePrefix(prefix) {
  const normalized = String(prefix ?? '').replace(/^\/+/, '');
  if (normalized.split('/').includes('..')) {
    throw new Error('Object storage prefix cannot contain path traversal');
  }
  return normalized;
}

async function readObject(client, bucket, key) {
  const stream = await client.getObject(bucket, key);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}
