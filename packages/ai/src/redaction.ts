const MAX_MESSAGE_LENGTH = 4_000;

export function redactModelSecrets(input: string): string {
  return input
    .replace(
      /("(?:api[_-]?key|authorization)"\s*:\s*")[^"]*(")/gi,
      '$1[REDACTED]$2',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key)\s*=\s*[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, MAX_MESSAGE_LENGTH);
}
