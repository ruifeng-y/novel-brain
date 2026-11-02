import path from 'node:path';

export function isBackupExpired(createdAt, now, retentionDays) {
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}

export function resolveInside(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, target);
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Backup path is outside the backup root');
  }
  return targetPath;
}

export function safeDatabaseName(name) {
  if (name === 'novel') {
    throw new Error('Restore drill requires a scratch database');
  }
  if (!/^novel_restore_drill_[a-z0-9_]{1,40}$/.test(name) || name.length > 63) {
    throw new Error('Invalid database name');
  }
  return name;
}

export function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function backupDirectory(root, createdAt = new Date()) {
  return resolveInside(root, path.join('postgres', backupTimestamp(createdAt)));
}
