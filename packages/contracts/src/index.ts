import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_INVALID",
  "AUTH_CODE_INVALID",
  "AUTH_RATE_LIMITED",
  "AUTH_EMAIL_TAKEN",
  "AUTH_PASSWORD_WEAK",
  "AUTH_LOGIN_FAILED",
  "AUTH_SESSION_INVALID",
  "AUTH_CSRF_INVALID",
  "AUTH_ORIGIN_INVALID",
  "MODEL_KEY_INVALID",
  "MODEL_CONNECTION_FAILED",
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_PROVIDER_ERROR",
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

export const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Expected a UUID v7",
  );

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

export const authEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const authPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");
export const authDisplayNameSchema = z.string().trim().min(1).max(50);

export const sendRegistrationCodeRequestSchema = z.object({
  email: authEmailSchema,
});
export type SendRegistrationCodeRequest = z.infer<typeof sendRegistrationCodeRequestSchema>;

export const registerRequestSchema = z.object({
  email: authEmailSchema,
  code: z.string().regex(/^\d{6}$/),
  password: authPasswordSchema,
  displayName: authDisplayNameSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: uuidV7Schema,
  emailMasked: z.string().min(3),
  displayName: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionSchema = z.object({
  id: uuidV7Schema,
  expiresAt: z.string().datetime(),
  current: z.literal(true),
  userAgent: z.string(),
  createdAt: z.string().datetime(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const authSessionDataSchema = z.object({
  user: authUserSchema,
  session: authSessionSchema,
});
export type AuthSessionData = z.infer<typeof authSessionDataSchema>;

export const csrfDataSchema = z.object({
  token: z.string().min(20),
});
export const sendRegistrationCodeDataSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.string().datetime(),
});
export const logoutDataSchema = z.object({
  loggedOut: z.literal(true),
});

export const csrfResponseSchema = apiEnvelopeSchema(csrfDataSchema);
export const sendRegistrationCodeResponseSchema = apiEnvelopeSchema(sendRegistrationCodeDataSchema);
export const authSessionResponseSchema = apiEnvelopeSchema(authSessionDataSchema);
export const logoutResponseSchema = apiEnvelopeSchema(logoutDataSchema);

export const modelProviderSchema = z.enum(["deepseek", "openai-compatible"]);
export const modelPurposeSchema = z.enum(["planning", "writing", "review"]);
export type ModelPurpose = z.infer<typeof modelPurposeSchema>;

export const modelConfigInputSchema = z.object({
  provider: modelProviderSchema,
  label: z.string().trim().min(1).max(80),
  baseUrl: z.url().max(500),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().min(1).max(500),
  purposes: z.array(modelPurposeSchema).min(1).max(3).default(["writing"]),
  isDefault: z.boolean().default(false),
});
export type ModelConfigInput = z.infer<typeof modelConfigInputSchema>;

export const modelConfigUpdateSchema = z.object({
  version: z.number().int().positive(),
  label: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.url().max(500).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  purposes: z.array(modelPurposeSchema).min(1).max(3).optional(),
  isDefault: z.boolean().optional(),
});
export type ModelConfigUpdate = z.infer<typeof modelConfigUpdateSchema>;

export const modelConnectionTestStatusSchema = z.enum([
  "success",
  "key_invalid",
  "rate_limited",
  "timeout",
  "provider_error",
  "error",
]);
export type ModelConnectionTestStatus = z.infer<typeof modelConnectionTestStatusSchema>;

export const modelConfigSchema = z.object({
  id: uuidV7Schema,
  provider: modelProviderSchema,
  label: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  purposes: z.array(modelPurposeSchema).min(1),
  keyMasked: z.string(),
  isDefault: z.boolean(),
  version: z.number().int().positive(),
  lastTestStatus: modelConnectionTestStatusSchema.nullable(),
  lastTestedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const modelProviderInfoSchema = z.object({
  key: modelProviderSchema,
  label: z.string(),
  defaultBaseUrl: z.string(),
  baseUrls: z.array(z.string()),
  models: z.array(z.string()),
});
export type ModelProviderInfo = z.infer<typeof modelProviderInfoSchema>;

export const modelConfigsResponseSchema = apiEnvelopeSchema(z.array(modelConfigSchema));
export const modelProvidersResponseSchema = apiEnvelopeSchema(z.array(modelProviderInfoSchema));
export const modelConfigResponseSchema = apiEnvelopeSchema(modelConfigSchema);
export const modelConnectionTestResponseSchema = apiEnvelopeSchema(
  z.object({
    status: z.literal("success"),
    latencyMs: z.number().nonnegative(),
    message: z.string(),
  }),
);
export const modelConfigDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

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
