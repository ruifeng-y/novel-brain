import { createHash } from 'node:crypto';
import { access, cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TRANSFER_MANIFEST = 'offsite-manifest.json';

export async function copyBackupOffsite({ backupDir, targetRoot, now = new Date() }) {
  const source = path.resolve(backupDir);
  const target = path.resolve(targetRoot);
  if (source === target || isInside(target, source)) {
    throw new Error('Offsite target cannot be inside the backup');
  }

  const sourceInfo = await lstat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) {
    throw new Error('Backup snapshot directory was not found');
  }
  const sourceManifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
  const destination = path.join(target, path.basename(source));
  if (await pathExists(destination)) {
    throw new Error('Offsite backup destination already exists');
  }

  await mkdir(target, { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  const files = await hashTree(destination, TRANSFER_MANIFEST);
  const manifest = {
    sourceSnapshot: path.basename(source),
    sourceBackupCreatedAt: sourceManifest.createdAt ?? null,
    copiedAt: now.toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    treeSha256: treeChecksum(files),
    files,
  };
  await writeFile(
    path.join(destination, TRANSFER_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { destination, manifest };
}

export async function verifyOffsiteCopy(destinationInput) {
  const destination = path.resolve(destinationInput);
  const manifest = JSON.parse(await readFile(path.join(destination, TRANSFER_MANIFEST), 'utf8'));
  const files = await hashTree(destination, TRANSFER_MANIFEST);
  if (files.length !== manifest.fileCount || treeChecksum(files) !== manifest.treeSha256) {
    throw new Error('Offsite backup checksum mismatch');
  }
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of files) {
    const recorded = expected.get(file.path);
    if (!recorded || recorded.sha256 !== file.sha256 || recorded.sizeBytes !== file.sizeBytes) {
      throw new Error('Offsite backup checksum mismatch');
    }
  }
  return {
    destination,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    treeSha256: manifest.treeSha256,
  };
}

async function hashTree(directory, excludedRelativePath = null, relativeRoot = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relativeRoot), {
    withFileTypes: true,
  })) {
    const relativePath = path.join(relativeRoot, entry.name).split(path.sep).join('/');
    if (relativePath === excludedRelativePath) {
      continue;
    }
    const absolutePath = path.join(directory, relativePath);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      throw new Error('Offsite backups cannot contain symbolic links');
    }
    if (info.isDirectory()) {
      files.push(...(await hashTree(directory, excludedRelativePath, relativePath)));
      continue;
    }
    if (!info.isFile()) {
      throw new Error('Offsite backups can contain only regular files and directories');
    }
    const data = await readFile(absolutePath);
    files.push({
      path: relativePath,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function treeChecksum(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file.path}\0${file.sizeBytes}\0${file.sha256}\n`);
  }
  return hash.digest('hex');
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
