const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "bearer",
  "body",
  "content",
  "context",
  "contextpack",
  "drafttext",
  "manuscript",
  "messages",
  "password",
  "prompt",
  "rawcontent",
  "secret",
  "system",
  "token",
]);

const TOKEN_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/gu;

export function sanitizeLogPayload(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

export function findSensitiveLogValues(value: unknown): string[] {
  const findings: string[] = [];
  inspectValue(value, "$", findings, 0);
  return findings;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 12) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isSensitiveKey(key) ? REDACTED : sanitizeValue(entry, depth + 1),
      ]),
    );
  }
  return value;
}

function sanitizeText(value: string): string {
  return value.replace(TOKEN_PATTERN, REDACTED);
}

function inspectValue(value: unknown, path: string, findings: string[], depth: number): void {
  if (depth > 12) {
    return;
  }
  if (typeof value === "string") {
    if (value !== REDACTED && containsCredential(value)) {
      findings.push(path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValue(entry, `${path}[${index}]`, findings, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const entryPath = `${path}.${key}`;
      if (isSensitiveKey(key) && entry !== REDACTED) {
        findings.push(entryPath);
      }
      inspectValue(entry, entryPath, findings, depth + 1);
    }
  }
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/gu, ""));
}

function containsCredential(value: string): boolean {
  TOKEN_PATTERN.lastIndex = 0;
  return TOKEN_PATTERN.test(value);
}
