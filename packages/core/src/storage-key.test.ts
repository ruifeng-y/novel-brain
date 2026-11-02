import { describe, expect, it } from 'vitest';
import { assertUserStorageKey, userStorageKey } from './storage-key';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe('user storage keys', () => {
  it('builds every object key under the author prefix', () => {
    const key = userStorageKey(ALICE, 'work-1', 'branch-1', 'maps', 'map.webp');

    expect(key).toBe(`${ALICE}/work-1/branch-1/maps/map.webp`);
    expect(() => assertUserStorageKey(ALICE, key)).not.toThrow();
    expect(() => assertUserStorageKey(BOB, key)).toThrow('Object key is outside the author prefix');
  });

  it('rejects path traversal and malformed prefixes', () => {
    expect(() => userStorageKey(ALICE, '..', 'secret.txt')).toThrow('Invalid object key segment');
    expect(() => userStorageKey(ALICE, 'work/other', 'file.txt')).toThrow(
      'Invalid object key segment',
    );
    expect(() => assertUserStorageKey(ALICE, `${BOB}/work/file.txt`)).toThrow(
      'Object key is outside the author prefix',
    );
  });
});
