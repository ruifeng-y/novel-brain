import { z } from "zod";

export const ERROR_CODES = [
  "AUTH_CODE_INVALID",
  "AUTH_RATE_LIMITED",
  "MODEL_KEY_INVALID",
  "MODEL_CONNECTION_FAILED",
  "BIBLE_NOT_READY",
  "BIBLE_LOCKED",
  "JOB_BUDGET_EXCEEDED",
  "JOB_CANCELLED",
  "FACT_DECISION_REQUIRED",
  "FACT_SUBMISSION_BLOCKED",
  "CANON_CHAPTER_NOT_APPROVED",
  "IMPORT_CONFLICT_UNRESOLVED",
  "VERSION_CONFLICT",
  "FORBIDDEN_TENANT_ACCESS",
  "INTERNAL_ERROR",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).default({}),
    requestId: z.string().startsWith("req_"),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiEnvelopeSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    requestId: z.string().startsWith("req_"),
    meta: z.record(z.string(), z.unknown()).default({}),
  });

export type ApiEnvelope<T> = {
  data: T;
  requestId: string;
  meta: Record<string, unknown>;
};

export const serviceNameSchema = z.enum(["api", "worker"]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

export const dependencyCheckSchema = z.object({
  name: z.enum(["database", "queue"]),
  status: z.enum(["up", "down"]),
  latencyMs: z.number().nonnegative(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

export const livenessDataSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  timestamp: z.string().datetime(),
});
export type LivenessData = z.infer<typeof livenessDataSchema>;

export const readinessDataSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("api"),
  timestamp: z.string().datetime(),
  checks: z.array(dependencyCheckSchema),
});
export type ReadinessData = z.infer<typeof readinessDataSchema>;

export const livenessResponseSchema = apiEnvelopeSchema(livenessDataSchema);
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const readinessResponseSchema = apiEnvelopeSchema(readinessDataSchema);
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const workerReadinessDataSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("worker"),
  workerCount: z.number().int().nonnegative(),
  checks: z.array(dependencyCheckSchema),
});
export type WorkerReadinessData = z.infer<typeof workerReadinessDataSchema>;

export const WORKER_QUEUE_NAME = "novel-brain-jobs";
export const GENERATE_CHAPTER_JOB = "generate_chapter";
export const WORKER_JOB_STEPS = [
  "prepare",
  "compile_context",
  "draft",
  "verify",
  "revise",
  "extract_facts",
  "await_review",
] as const;

export const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Expected a UUID v7",
  );
export const workerJobStepSchema = z.enum(WORKER_JOB_STEPS);

export const generateChapterJobSchema = z.object({
  jobId: uuidV7Schema,
  jobType: z.literal(GENERATE_CHAPTER_JOB),
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  actorId: uuidV7Schema,
  modelConfigId: uuidV7Schema,
  idempotencyKey: z.string().min(1),
  budget: z.object({
    maxCostCny: z.number().nonnegative(),
    maxTokens: z.number().int().positive(),
    maxRevisionRounds: z.number().int().nonnegative(),
  }),
  checkpoint: z.object({
    step: workerJobStepSchema,
    payload: z.record(z.string(), z.unknown()),
  }),
});
export type GenerateChapterJob = z.infer<typeof generateChapterJobSchema>;

export const workerJobSchema = z.discriminatedUnion("jobType", [generateChapterJobSchema]);
export type WorkerJob = z.infer<typeof workerJobSchema>;
