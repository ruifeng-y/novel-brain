const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "bearer",
  "body",
  "chapterbody",
  "chaptercontent",
  "content",
  "context",
  "contextpack",
  "contextsnapshot",
  "drafttext",
  "importedsource",
  "importsource",
  "manuscript",
  "manuscripttext",
  "messages",
  "password",
  "prompt",
  "prompttext",
  "rawcontent",
  "secret",
  "sourcecontent",
  "sourceexcerpt",
  "system",
  "usercontent",
  "token",
]);

const TOKEN_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/gu;
const SAFE_TELEMETRY_LABEL_KEYS = new Set([
  "errorcode",
  "jobtype",
  "method",
  "model",
  "operation",
  "outcome",
  "provider",
  "queue",
  "route",
  "service",
  "status",
]);
const SAFE_TELEMETRY_LABEL_VALUE = /^[A-Za-z0-9_./:-]{1,128}$/u;

export class LogRedactionError extends Error {
  constructor(readonly findings: string[]) {
    super("Log payload redaction failed");
    this.name = "LogRedactionError";
  }
}

export interface TracePolicy {
  mode: "off" | "self_hosted";
  retentionDays: number | null;
  endpoint: string | null;
}

export function sanitizeLogPayload(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

export function sanitizeLogPayloadStrict(
  value: unknown,
  options: { canaryValues?: readonly string[] } = {},
): unknown {
  const sanitized = sanitizeLogPayload(value);
  const findings = findSensitiveLogValues(sanitized);
  for (const canary of options.canaryValues ?? []) {
    if (canary && containsString(sanitized, canary)) {
      findings.push("$canary");
    }
  }
  if (findings.length > 0) {
    throw new LogRedactionError([...new Set(findings)]);
  }
  return sanitized;
}

export function findSensitiveLogValues(value: unknown): string[] {
  const findings: string[] = [];
  inspectValue(value, "$", findings, 0);
  return findings;
}

export function resolveTracePolicy(env: Record<string, string | undefined>): TracePolicy {
  const mode = env.TRACE_MODE?.trim().toLowerCase() || "off";
  const retention = env.TRACE_RETENTION_DAYS?.trim();
  const endpoint = env.TRACE_ENDPOINT?.trim();
  if (mode === "off") {
    if (retention || endpoint) {
      throw new Error("TRACE_MODE must be self_hosted when tracing configuration is present");
    }
    return { mode: "off", retentionDays: null, endpoint: null };
  }
  if (mode !== "self_hosted") {
    throw new Error("TRACE_MODE must be off or self_hosted");
  }
  const retentionDays = Number(retention);
  if (!retention || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new Error("TRACE_RETENTION_DAYS must be an integer between 1 and 365");
  }
  if (!endpoint) {
    throw new Error("TRACE_ENDPOINT is required when TRACE_MODE is self_hosted");
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("TRACE_ENDPOINT must be an HTTP(S) URL");
  }
  return { mode: "self_hosted", retentionDays, endpoint };
}

export function sanitizeTelemetryLabels(labels: Record<string, unknown>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const normalizedKey = normalizeKey(key);
    if (!SAFE_TELEMETRY_LABEL_KEYS.has(normalizedKey)) {
      continue;
    }
    if (typeof value !== "string" || !SAFE_TELEMETRY_LABEL_VALUE.test(value)) {
      continue;
    }
    if (containsCredential(value) || isSensitiveKey(key)) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function parseLogCanaryValues(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("LOG_CANARY_VALUES must be a JSON string array or comma-separated text");
    }
    return parsed.filter((entry) => entry.length > 0);
  }
  return trimmed
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/gu, "");
}

function containsString(value: unknown, expected: string, depth = 0): boolean {
  if (depth > 12) {
    return false;
  }
  if (typeof value === "string") {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsString(entry, expected, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      containsString(entry, expected, depth + 1),
    );
  }
  return false;
}
