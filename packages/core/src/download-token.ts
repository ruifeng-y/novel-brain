import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 1;
const TOKEN_CONTEXT = 'novel-brain:export-download:v1:';
const MAX_TOKEN_LENGTH = 2_048;

export type ExportDownloadClaims = {
  v: typeof TOKEN_VERSION;
  exportId: string;
  userId: string;
  workId: string;
  branchId: string;
  exp: number;
};

export type ExportDownloadInput = Omit<ExportDownloadClaims, 'v' | 'exp'>;

export function signDownloadToken(
  input: ExportDownloadInput,
  secret: string,
  options: { now?: Date; ttlSeconds?: number } = {},
): string {
  const now = options.now ?? new Date();
  const ttlSeconds = options.ttlSeconds ?? 300;
  if (secret.length < 16) {
    throw new Error('Download signing secret must be at least 16 characters');
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) {
    throw new Error('Download token TTL must be between 60 and 900 seconds');
  }

  const claims: ExportDownloadClaims = {
    v: TOKEN_VERSION,
    ...input,
    exp: Math.floor(now.getTime() / 1_000) + ttlSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyDownloadToken(
  token: string,
  secret: string,
  options: { now?: Date } = {},
): ExportDownloadClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const [payload, signature] = parts;
  const expected = signPayload(payload, secret);
  const actualBytes = Buffer.from(signature, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<ExportDownloadClaims>;
    if (
      parsed.v !== TOKEN_VERSION ||
      typeof parsed.exportId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.workId !== 'string' ||
      typeof parsed.branchId !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
    if (parsed.exp <= nowSeconds) {
      return null;
    }
    return parsed as ExportDownloadClaims;
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${TOKEN_CONTEXT}${payload}`).digest('base64url');
}
