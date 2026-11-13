import { isIP } from "node:net";

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
  "message",
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
const SAFE_LOG_KEYS = new Set([
  "actualCostCny",
  "actualTokens",
  "action",
  "actorId",
  "attempt",
  "batchId",
  "bindingScope",
  "branchId",
  "budgetAfter",
  "budgetBefore",
  "candidateCount",
  "candidateIds",
  "chapterId",
  "chapterStatus",
  "chapterNumbers",
  "checkpoint",
  "checkpointStep",
  "code",
  "completed",
  "contentHash",
  "contextManifestHash",
  "contextPackId",
  "contextWindowTokens",
  "cost",
  "costCny",
  "currentStep",
  "delayMs",
  "endpointConfigured",
  "error",
  "errorCode",
  "errorType",
  "estimatedCostCny",
  "estimatedTokens",
  "event",
  "failedDimensions",
  "failureClass",
  "gate",
  "id",
  "inputHash",
  "inputTokens",
  "jobId",
  "jobType",
  "jobTypes",
  "latencyMs",
  "maxCostCny",
  "maxRevisionRounds",
  "maxTokens",
  "mode",
  "modelConfigId",
  "model",
  "modelCallId",
  "operation",
  "outputHash",
  "outputRefs",
  "outputTokens",
  "kind",
  "planId",
  "port",
  "promptKey",
  "promptVersion",
  "progress",
  "provider",
  "queue",
  "ready",
  "requestId",
  "reservationId",
  "reportState",
  "requiredTokens",
  "reservedCostCny",
  "reservedOutputTokens",
  "reservedTokens",
  "resumeStep",
  "recoveryId",
  "retentionDays",
  "retryable",
  "retryAfterSeconds",
  "revision",
  "route",
  "runId",
  "schemaVersion",
  "service",
  "status",
  "stage",
  "staleRecovery",
  "step",
  "stepKey",
  "targetId",
  "terminal",
  "tokenBudget",
  "totalTokens",
  "total",
  "type",
  "userId",
  "versionNodeId",
  "workId",
]);
const SAFE_STRUCTURED_RESPONSE_KEYS = new Set([
  ...SAFE_LOG_KEYS,
  "blockers",
  "chapterVersionId",
  "commitId",
  "dependencies",
  "dependencyFingerprint",
  "fieldKey",
  "findings",
  "findingId",
  "entityId",
  "issues",
  "items",
  "key",
  "missingCards",
  "missingChapterNumbers",
  "p0Keys",
  "path",
  "pendingRequiredFactIds",
  "proposalCount",
  "reportId",
  "resource",
  "resumedChapters",
  "ruleVersion",
  "sourceVersionId",
  "severity",
  "state",
  "uncommittedChapterNumbers",
  "unresolvedHighRiskFactIds",
  "version",
  "warnings",
]);
const OBJECT_ONLY_KEYS = new Set(["checkpoint", "cost", "error", "remediation", "resource"]);
const ARRAY_ONLY_KEYS = new Set([
  "blockers",
  "candidateIds",
  "chapterNumbers",
  "dependencies",
  "failedDimensions",
  "findings",
  "issues",
  "items",
  "missingCards",
  "outputRefs",
  "p0Keys",
  "path",
  "pendingRequiredFactIds",
  "uncommittedChapterNumbers",
  "unresolvedHighRiskFactIds",
]);
const SAFE_LOG_MACHINE_TEXT = /^[A-Za-z0-9_./:#@?=&%+,-]{1,256}$/u;
const SAFE_TELEMETRY_LABEL_KEYS = new Set([
  "errorcode",
  "jobtype",
  "method",
  "operation",
  "outcome",
  "provider",
  "queue",
  "route",
  "service",
  "status",
]);
const SAFE_TELEMETRY_LABEL_VALUE = /^[A-Za-z0-9_./:-]{1,128}$/u;
const UUID_VALUE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const SAFE_TELEMETRY_ROUTES = new Set(["/api/v1/health", "/api/v1/health/ready", "/api/v1/works"]);

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

export interface TraceEnvelope {
  name: string;
  occurredAt: string;
  attributes?: Record<string, unknown>;
}

export type TraceFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    redirect: "error";
  },
) => Promise<{ ok: boolean; status: number }>;

export function sanitizeLogPayload(value: unknown): unknown {
  return sanitizeValue(value, 0, SAFE_LOG_KEYS, "log");
}

export function sanitizeStructuredPayload(
  value: unknown,
  options: { canaryValues?: readonly string[] } = {},
): unknown {
  return sanitizeChecked(value, SAFE_STRUCTURED_RESPONSE_KEYS, "structured", options);
}

export function sanitizeDiagnosticText(
  value: unknown,
  options: { canaryValues?: readonly string[] } = {},
): unknown {
  return sanitizeChecked(value, SAFE_STRUCTURED_RESPONSE_KEYS, "text", options);
}

function sanitizeChecked(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  mode: SanitizationMode,
  options: { canaryValues?: readonly string[] },
): unknown {
  const sanitized = sanitizeValue(value, 0, allowedKeys, mode);
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

export function sanitizeLogPayloadStrict(
  value: unknown,
  options: { canaryValues?: readonly string[] } = {},
): unknown {
  return sanitizeChecked(value, SAFE_LOG_KEYS, "log", options);
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
  if (!isSelfHostedTraceHost(parsed.hostname)) {
    throw new Error("TRACE_ENDPOINT must target a self-hosted host");
  }
  return { mode: "self_hosted", retentionDays, endpoint };
}

export async function emitTraceEnvelope(
  policy: TracePolicy,
  envelope: TraceEnvelope,
  fetcher: TraceFetch = defaultTraceFetch,
): Promise<boolean> {
  if (policy.mode === "off") {
    return false;
  }
  if (!policy.endpoint || !policy.retentionDays) {
    throw new Error("Self-hosted trace policy is incomplete");
  }
  const canaryValues = parseLogCanaryValues(process.env.LOG_CANARY_VALUES);
  const name = safeTraceName(envelope.name, canaryValues);
  const occurredAt = safeTraceTimestamp(envelope.occurredAt, canaryValues);
  const attributes = sanitizeLogPayloadStrict(envelope.attributes ?? {}, { canaryValues });
  const response = await fetcher(policy.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "error",
    body: JSON.stringify({
      name,
      occurredAt,
      retentionDays: policy.retentionDays,
      attributes,
    }),
  });
  if (!response.ok) {
    throw new Error(`Trace export failed with HTTP ${response.status}`);
  }
  return true;
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
    if (
      UUID_VALUE.test(value) ||
      (normalizedKey === "route" && !SAFE_TELEMETRY_ROUTES.has(value)) ||
      (normalizedKey === "status" && !/^[1-5]\d{2}$/u.test(value))
    ) {
      continue;
    }
    if (containsCredential(value) || isSensitiveKey(key)) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function isSafeTelemetryMetricName(name: string): boolean {
  return /^[a-z][a-z0-9_.-]{0,99}$/u.test(name) && !containsCredential(name);
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

type SanitizationMode = "log" | "structured" | "text";

function sanitizeValue(
  value: unknown,
  depth: number,
  allowedKeys: ReadonlySet<string>,
  mode: SanitizationMode,
): unknown {
  if (depth > 12) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    if (mode !== "text" && !SAFE_LOG_MACHINE_TEXT.test(value)) {
      return REDACTED;
    }
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1, allowedKeys, mode));
  }
  if (value && typeof value === "object") {
    const safeEntries: Array<[string, unknown]> = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        safeEntries.push([key, REDACTED]);
      } else if (allowedKeys.has(key) && isCompatibleEntry(key, entry)) {
        safeEntries.push([key, sanitizeValue(entry, depth + 1, allowedKeys, mode)]);
      }
    }
    return Object.fromEntries(safeEntries);
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
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function isCompatibleEntry(key: string, value: unknown): boolean {
  if (OBJECT_ONLY_KEYS.has(key)) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (ARRAY_ONLY_KEYS.has(key)) {
    return Array.isArray(value);
  }
  return true;
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
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (key.includes(expected)) {
        return true;
      }
    }
    return Object.values(value as Record<string, unknown>).some((entry) =>
      containsString(entry, expected, depth + 1),
    );
  }
  return false;
}

function safeTraceName(name: string, canaryValues: readonly string[]): string {
  if (
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(name) ||
    containsCredential(name) ||
    canaryValues.some((canary) => canary && name.includes(canary))
  ) {
    throw new Error("Trace envelope name is invalid");
  }
  return name;
}

function safeTraceTimestamp(value: string, canaryValues: readonly string[]): string {
  if (
    canaryValues.some((canary) => canary && value.includes(canary)) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("Trace envelope timestamp is invalid");
  }
  return value;
}

function isSelfHostedTraceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return isPrivateIpv4(host);
  }
  if (ipVersion === 6) {
    return isPrivateOrLoopbackIpv6(host);
  }
  return !host.includes(".");
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 127 ||
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31)
  );
}

function isPrivateOrLoopbackIpv6(host: string): boolean {
  if (host === "::1") {
    return true;
  }
  const firstHextet = Number.parseInt(host.split(":", 1)[0] ?? "0", 16);
  if ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80) {
    return true;
  }
  return false;
}

const defaultTraceFetch: TraceFetch = async (url, init) => {
  const fetchImpl = (
    globalThis as {
      fetch?: (
        input: string,
        options: {
          method: string;
          headers: Record<string, string>;
          body: string;
          redirect: "error";
        },
      ) => Promise<{ ok: boolean; status: number }>;
    }
  ).fetch;
  if (!fetchImpl) {
    throw new Error("Trace export requires fetch support");
  }
  return fetchImpl(url, init);
};
