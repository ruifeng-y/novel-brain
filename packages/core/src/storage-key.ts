const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function userStorageKey(userId: string, ...segments: string[]): string {
  const prefix = userStoragePrefix(userId);
  const normalized = segments.map((segment) => {
    if (!SEGMENT_PATTERN.test(segment) || segment === '.' || segment === '..') {
      throw new Error('Invalid object key segment');
    }
    return segment;
  });
  return [prefix, ...normalized].join('/');
}

export function assertUserStorageKey(userId: string, key: string): void {
  const prefix = `${userStoragePrefix(userId)}/`;
  if (!key.startsWith(prefix) || key.split('/').some((segment) => segment === '..')) {
    throw new Error('Object key is outside the author prefix');
  }
}

export function userStoragePrefix(userId: string): string {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('Invalid author id for object storage');
  }
  return userId.toLowerCase();
}
