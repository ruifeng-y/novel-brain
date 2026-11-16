import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";

export const BACKUP_ENCRYPTION_MAGIC = "NBACKUP1";
export const BACKUP_IV_BYTES = 12;
export const BACKUP_TAG_BYTES = 16;

const encryptionMagic = Buffer.from(BACKUP_ENCRYPTION_MAGIC, "ascii");

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function encryptionAad(backupId, relativePath) {
  return Buffer.from(`${BACKUP_ENCRYPTION_MAGIC}\0${backupId}\0${relativePath}`, "utf8");
}

export function parseBackupKey(raw) {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(raw)
  ) {
    throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 must be a canonical base64 value.");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes.");
  }
  return key;
}

export function encryptionMetadata(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Backup encryption key must be exactly 32 bytes.");
  }
  return {
    algorithm: "aes-256-gcm",
    keyFingerprint: sha256(key),
    aadTemplate: `${BACKUP_ENCRYPTION_MAGIC}:<backupId>:<relativePath>`,
  };
}

export function encryptBackupBuffer(plaintext, { key, backupId, relativePath }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Backup encryption key must be exactly 32 bytes.");
  }
  const iv = randomBytes(BACKUP_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(encryptionAad(backupId, relativePath));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([encryptionMagic, iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptBackupBuffer(encrypted, { key, backupId, relativePath }) {
  if (
    !Buffer.isBuffer(encrypted) ||
    encrypted.length < encryptionMagic.length + BACKUP_IV_BYTES + BACKUP_TAG_BYTES
  ) {
    throw new Error("Backup artefact is truncated.");
  }
  if (!encrypted.subarray(0, encryptionMagic.length).equals(encryptionMagic)) {
    throw new Error("Backup artefact has an unsupported state.");
  }

  const ivStart = encryptionMagic.length;
  const ciphertextStart = ivStart + BACKUP_IV_BYTES;
  const tagStart = encrypted.length - BACKUP_TAG_BYTES;
  const iv = encrypted.subarray(ivStart, ciphertextStart);
  const ciphertext = encrypted.subarray(ciphertextStart, tagStart);
  const tag = encrypted.subarray(tagStart);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(encryptionAad(backupId, relativePath));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Backup artefact failed to authenticate.");
  }
}

export async function hashFile(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export async function encryptFile({ sourcePath, destinationPath, key, backupId, relativePath }) {
  const iv = randomBytes(BACKUP_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(encryptionAad(backupId, relativePath));
  await fs.writeFile(destinationPath, Buffer.concat([encryptionMagic, iv]));
  await pipeline(
    createReadStream(sourcePath),
    cipher,
    createWriteStream(destinationPath, { flags: "a" }),
  );
  await fs.appendFile(destinationPath, cipher.getAuthTag());
}

export async function decryptFile({ sourcePath, destinationPath, key, backupId, relativePath }) {
  const stat = await fs.stat(sourcePath);
  const headerBytes = encryptionMagic.length + BACKUP_IV_BYTES;
  if (stat.size < headerBytes + BACKUP_TAG_BYTES) {
    throw new Error(`Backup artefact is truncated: ${relativePath}.`);
  }
  const file = await fs.open(sourcePath, "r");
  try {
    const header = Buffer.alloc(headerBytes);
    await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, encryptionMagic.length).equals(encryptionMagic)) {
      throw new Error(`Backup artefact has an unsupported state: ${relativePath}.`);
    }
    const tag = Buffer.alloc(BACKUP_TAG_BYTES);
    await file.read(tag, 0, BACKUP_TAG_BYTES, stat.size - BACKUP_TAG_BYTES);
    const iv = header.subarray(encryptionMagic.length);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(encryptionAad(backupId, relativePath));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, {
        start: headerBytes,
        end: stat.size - BACKUP_TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(destinationPath),
    );
  } finally {
    await file.close();
  }
}
