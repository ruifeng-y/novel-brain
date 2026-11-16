export const RUNTIME_METRICS_WINDOW_HOURS = 24;
export const RUNTIME_METRICS_TTL_SECONDS = 25 * 60 * 60;
export const JOB_METRICS_KEY = "novelbrain:metrics:jobs";
export const MODEL_METRICS_KEY = "novelbrain:metrics:models";

const SAFE_JOB_TYPES = new Set([
  "agent_workflow",
  "batch_plan",
  "batch_tick",
  "generate_chapter",
  "generate_golden_three",
  "rebuild_summaries",
  "write_action",
]);
export type RuntimeJobType =
  | "agent_workflow"
  | "batch_plan"
  | "batch_tick"
  | "generate_chapter"
  | "generate_golden_three"
  | "rebuild_summaries"
  | "write_action"
  | "unknown";
export type RuntimeJobStatus = "cancelled" | "completed" | "failed" | "succeeded" | "unknown";
export type RuntimeModelStatus = "cancelled" | "failed" | "succeeded" | "unknown";
export type RuntimeJobOutcome = "succeeded" | "failed" | "cancelled";
const SAFE_JOB_STATUSES = new Set<string>([
  "cancelled",
  "completed",
  "failed",
  "succeeded",
  "unknown",
]);
const SAFE_MODEL_STATUSES = new Set<string>(["cancelled", "failed", "succeeded", "unknown"]);
const SAFE_ROUTE_TEMPLATE = /^\/api\/v1(?:\/[a-z][a-z0-9_-]*|\/:[A-Za-z][A-Za-z0-9]*){1,20}$/u;
const SAFE_STATIC_ROUTE_TEMPLATES = new Set([
  "/api/v1/auth/csrf",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/logout-all",
  "/api/v1/auth/me",
  "/api/v1/auth/password/forgot",
  "/api/v1/auth/password/reset",
  "/api/v1/auth/register",
  "/api/v1/auth/register/send-code",
  "/api/v1/auth/sessions",
  "/api/v1/genre-packs",
  "/api/v1/health",
  "/api/v1/health/ready",
  "/api/v1/imports",
  "/api/v1/imports/manuscripts",
  "/api/v1/imports/manuscripts/chunked",
  "/api/v1/imports/manuscripts/chunked/start",
  "/api/v1/model-configs",
  "/api/v1/model-configs/providers",
  "/api/v1/notifications",
  "/api/v1/notifications/read-all",
  "/api/v1/search",
  "/api/v1/users/me",
  "/api/v1/users/me/pen-names",
  "/api/v1/works",
]);

export function runtimeMetricsBucketKey(base: string, date: Date): string {
  const bucket = date.toISOString().slice(0, 13).replaceAll("-", "").replace("T", "");
  return `${base}:${bucket}`;
}

export function runtimeMetricsBucketDates(
  now: number,
  hours = RUNTIME_METRICS_WINDOW_HOURS,
): Date[] {
  const current = new Date(now);
  current.setUTCMinutes(0, 0, 0);
  return Array.from(
    { length: hours },
    (_, offset) => new Date(current.getTime() - offset * 60 * 60 * 1_000),
  );
}

export function safeRuntimeMetricJobType(value: string): RuntimeJobType {
  return SAFE_JOB_TYPES.has(value) ? (value as RuntimeJobType) : "unknown";
}

export function safeRuntimeMetricJobStatus(value: string): RuntimeJobStatus {
  return SAFE_JOB_STATUSES.has(value) ? (value as RuntimeJobStatus) : "unknown";
}

export function safeRuntimeMetricModelStatus(value: string): RuntimeModelStatus {
  return SAFE_MODEL_STATUSES.has(value) ? (value as RuntimeModelStatus) : "unknown";
}

export function encodeRuntimeJobMetricField(jobType: string, status: string): string {
  return `${safeRuntimeMetricJobType(jobType)}:${safeRuntimeMetricJobStatus(status)}`;
}

export function decodeRuntimeJobMetricField(
  field: string,
): { jobType: RuntimeJobType; status: RuntimeJobStatus } | undefined {
  const separator = field.lastIndexOf(":");
  if (separator <= 0 || separator === field.length - 1) {
    return undefined;
  }
  const jobType = field.slice(0, separator);
  const status = field.slice(separator + 1);
  if (!SAFE_JOB_TYPES.has(jobType) || !SAFE_JOB_STATUSES.has(status)) {
    return undefined;
  }
  return {
    jobType: jobType as RuntimeJobType,
    status: status as RuntimeJobStatus,
  };
}

export function safeApiRouteTemplate(value: string): string {
  if (!SAFE_ROUTE_TEMPLATE.test(value)) {
    return "/unmatched";
  }
  const hasParameter = value.split("/").some((segment) => segment.startsWith(":"));
  return hasParameter || SAFE_STATIC_ROUTE_TEMPLATES.has(value) ? value : "/unmatched";
}
