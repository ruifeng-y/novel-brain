import { describe, expect, it } from 'vitest';
import path from 'node:path';
// @ts-expect-error Ops helpers are plain ESM so they can run without a build step.
import {
  isBackupExpired,
  resolveInside,
  safeBucketName,
  safeDatabaseName,
} from '../../../scripts/ops-lib.mjs';
// @ts-expect-error Ops helpers are plain ESM so they can run without a build step.
import { objectFileName, objectSetChecksum } from '../../../scripts/object-backup.mjs';

describe('backup operations guards', () => {
  it('retains backups for 30 days and prunes only older snapshots', () => {
    const now = new Date('2026-11-02T00:00:00.000Z');

    expect(isBackupExpired(new Date('2026-10-03T00:00:01.000Z'), now, 30)).toBe(false);
    expect(isBackupExpired(new Date('2026-10-02T23:59:59.000Z'), now, 30)).toBe(true);
  });

  it('keeps backup paths inside the configured backup root', () => {
    const root = path.resolve('/srv/novel-brain/backups');

    expect(resolveInside(root, 'postgres/2026-11-02')).toBe(
      path.join(root, 'postgres', '2026-11-02'),
    );
    expect(() => resolveInside(root, '../etc')).toThrow('outside the backup root');
  });

  it('accepts only non-production database identifiers for drills', () => {
    expect(safeDatabaseName('novel_restore_drill_20261102')).toBe(
      'novel_restore_drill_20261102',
    );
    expect(() => safeDatabaseName('novel; drop database novel')).toThrow(
      'Invalid database name',
    );
    expect(() => safeDatabaseName('novel')).toThrow('Restore drill requires a scratch database');
  });

  it('validates object storage bucket names and content-addressed files', () => {
    expect(safeBucketName('novel-brain-restore-drill-20261102')).toBe(
      'novel-brain-restore-drill-20261102',
    );
    expect(() => safeBucketName('Novel Brain')).toThrow('Invalid object storage bucket name');
    expect(objectFileName('author/work/map.webp')).toMatch(/^[a-f0-9]{64}\.blob$/);
    expect(objectFileName('author/work/map.webp')).not.toBe(
      objectFileName('author/work/other.webp'),
    );
  });

  it('changes the object set checksum when any object changes', () => {
    const objects = [
      { key: 'author/a.webp', sha256: 'a'.repeat(64), sizeBytes: 10 },
      { key: 'author/b.webp', sha256: 'b'.repeat(64), sizeBytes: 20 },
    ];
    const changed = [
      objects[0],
      { ...objects[1], sha256: 'c'.repeat(64) },
    ];

    expect(objectSetChecksum(objects)).toMatch(/^[a-f0-9]{64}$/);
    expect(objectSetChecksum(changed)).not.toBe(objectSetChecksum(objects));
  });
});
