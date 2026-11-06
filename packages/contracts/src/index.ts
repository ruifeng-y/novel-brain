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
  "BIBLE_NOT_LOCKED",
  "SETTING_LOCKED",
  "SETTING_NAME_CONFLICT",
  "SETTING_ALIAS_CONFLICT",
  "SETTING_CONFLICT_UNRESOLVED",
  "SETTING_PROPOSAL_STATE",
  "SETTING_NOT_LOCKED",
  "CUSTOM_FIELD_REQUIRED",
  "CUSTOM_FIELD_INVALID",
  "CUSTOM_FIELD_IMMUTABLE",
  "CUSTOM_FIELD_DUPLICATE",
  "JOB_BUDGET_EXCEEDED",
  "JOB_CANCELLED",
  "FACT_DECISION_REQUIRED",
  "FACT_SUBMISSION_BLOCKED",
  "CANON_CHAPTER_NOT_APPROVED",
  "IMPORT_CONFLICT_UNRESOLVED",
  "VERSION_CONFLICT",
  "AGENT_CONTRACT_INVALID",
  "AGENT_GRANT_INVALID",
  "AGENT_GRANT_EXPIRED",
  "AGENT_GRANT_REVOKED",
  "AGENT_TOOL_NOT_REGISTERED",
  "AGENT_TOOL_DENIED",
  "AGENT_BUDGET_EXCEEDED",
  "AGENT_APPROVAL_REQUIRED",
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

export const workStatusSchema = z.enum([
  "draft",
  "preparing",
  "serializing",
  "paused",
  "completed",
  "archived",
]);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const workGenreSchema = z.enum(["xianxia", "history", "urban"]);
export type WorkGenre = z.infer<typeof workGenreSchema>;

export const workScaleTargetSchema = z.enum(["short", "medium", "long", "epic"]);
export type WorkScaleTarget = z.infer<typeof workScaleTargetSchema>;

export const workSourceModeSchema = z.enum([
  "idea",
  "blank",
  "template",
  "settings_import",
  "manuscript_import",
]);
export type WorkSourceMode = z.infer<typeof workSourceModeSchema>;

const workBaseInputShape = {
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(50).optional(),
  genre: workGenreSchema.default("xianxia"),
  scaleTarget: workScaleTargetSchema.default("long"),
  chapterLengthTarget: z.number().int().min(1000).max(10000).default(3000),
};

export const workCreateRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("idea"),
    idea: z.string().trim().min(10).max(5000),
    ...workBaseInputShape,
  }),
  z.object({
    mode: z.literal("blank"),
    ...workBaseInputShape,
  }),
  z.object({
    mode: z.literal("template"),
    templateKey: z.literal("xianxia"),
    ...workBaseInputShape,
  }),
]);
export type WorkCreateRequest = z.infer<typeof workCreateRequestSchema>;

export const workTemplatePackSchema = z.object({
  id: uuidV7Schema,
  key: workGenreSchema,
  version: z.number().int().positive(),
  label: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
export type WorkTemplatePack = z.infer<typeof workTemplatePackSchema>;

export const workSchema = z.object({
  id: uuidV7Schema,
  title: z.string(),
  penName: z.string(),
  genre: workGenreSchema,
  status: workStatusSchema,
  scaleTarget: workScaleTargetSchema,
  chapterLengthTarget: z.number().int().positive(),
  sourceMode: workSourceModeSchema,
  idea: z.string().nullable(),
  templatePack: workTemplatePackSchema.nullable(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Work = z.infer<typeof workSchema>;

export const workBranchSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  name: z.string(),
  headNodeId: uuidV7Schema,
  status: z.enum(["active", "archived"]),
});
export type WorkBranch = z.infer<typeof workBranchSchema>;

export const workReadinessItemSchema = z.object({
  key: z.enum(["main_branch", "model_config", "story_bible", "outline"]),
  label: z.string(),
  ready: z.boolean(),
});

export const workReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  items: z.array(workReadinessItemSchema),
});
export type WorkReadiness = z.infer<typeof workReadinessSchema>;

export const workOverviewSchema = workSchema.extend({
  mainBranch: workBranchSchema,
  branches: z.array(workBranchSchema),
  readiness: workReadinessSchema,
});
export type WorkOverview = z.infer<typeof workOverviewSchema>;

export const workListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: workStatusSchema.optional(),
  genre: workGenreSchema.optional(),
  cursor: uuidV7Schema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type WorkListQuery = z.infer<typeof workListQuerySchema>;

export const workResponseSchema = apiEnvelopeSchema(workOverviewSchema);
export const workListResponseSchema = z.object({
  data: z.array(workSchema),
  requestId: z.string().startsWith("req_"),
  meta: z.object({ nextCursor: uuidV7Schema.nullable() }),
});
export const workBranchesResponseSchema = apiEnvelopeSchema(z.array(workBranchSchema));

export const importCandidateTypeSchema = z.enum([
  "character",
  "faction",
  "map",
  "power_system",
  "golden_finger",
]);
export type ImportCandidateType = z.infer<typeof importCandidateTypeSchema>;

export const importCandidateStatusSchema = z.enum(["accepted", "pending", "conflict"]);
export type ImportCandidateStatus = z.infer<typeof importCandidateStatusSchema>;

export const importCandidateSchema = z.object({
  id: uuidV7Schema,
  type: importCandidateTypeSchema,
  name: z.string().min(1),
  summary: z.string(),
  sourceExcerpt: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: importCandidateStatusSchema,
});
export type ImportCandidate = z.infer<typeof importCandidateSchema>;

export const importUnparsedSchema = z.object({
  sourceExcerpt: z.string().min(1),
  reason: z.string().min(1),
});
export type ImportUnparsed = z.infer<typeof importUnparsedSchema>;

export const importConflictSchema = z.object({
  id: uuidV7Schema,
  type: z.literal("contradictory_setting"),
  summary: z.string().min(1),
  candidates: z.array(importCandidateSchema).length(2),
  decision: z.enum(["pending", "use_primary", "use_secondary"]),
  decidedAt: z.string().datetime().nullable(),
});
export type ImportConflict = z.infer<typeof importConflictSchema>;

export const importReportSchema = z.object({
  accepted: z.array(importCandidateSchema),
  pending: z.array(importCandidateSchema),
  conflicts: z.array(importConflictSchema),
  unparsed: z.array(importUnparsedSchema),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const settingsImportStatusSchema = z.enum(["awaiting_confirmation", "completed"]);
export type SettingsImportStatus = z.infer<typeof settingsImportStatusSchema>;

export const settingsImportSourceKindSchema = z.enum(["paste", "file"]);
export type SettingsImportSourceKind = z.infer<typeof settingsImportSourceKindSchema>;

export const settingsImportSchema = z.object({
  id: uuidV7Schema,
  status: settingsImportStatusSchema,
  sourceKind: settingsImportSourceKindSchema,
  sourceName: z.string().nullable(),
  report: importReportSchema,
  canConfirm: z.boolean(),
  confirmedWorkId: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
});
export type SettingsImport = z.infer<typeof settingsImportSchema>;

export const settingsImportCreateRequestSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  sourceName: z.string().trim().min(1).max(200).optional(),
});
export type SettingsImportCreateRequest = z.infer<typeof settingsImportCreateRequestSchema>;

export const settingsImportConfirmRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(50).optional(),
  genre: workGenreSchema.default("xianxia"),
  scaleTarget: workScaleTargetSchema.default("long"),
  chapterLengthTarget: z.number().int().min(1000).max(10000).default(3000),
});
export type SettingsImportConfirmRequest = z.infer<typeof settingsImportConfirmRequestSchema>;

export const settingsImportConflictDecisionRequestSchema = z.object({
  decision: z.enum(["use_primary", "use_secondary"]),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type SettingsImportConflictDecisionRequest = z.infer<
  typeof settingsImportConflictDecisionRequestSchema
>;

export const settingsImportResponseSchema = apiEnvelopeSchema(settingsImportSchema);
export const importReportResponseSchema = apiEnvelopeSchema(importReportSchema);

export const manuscriptImportFormatSchema = z.enum(["txt", "markdown"]);
export type ManuscriptImportFormat = z.infer<typeof manuscriptImportFormatSchema>;

export const manuscriptImportStatusSchema = z.enum(["ready", "partial", "empty"]);
export type ManuscriptImportStatus = z.infer<typeof manuscriptImportStatusSchema>;

export const manuscriptImportWarningSchema = z.object({
  sourceExcerpt: z.string().min(1),
  reason: z.string().min(1),
});
export type ManuscriptImportWarning = z.infer<typeof manuscriptImportWarningSchema>;

export const manuscriptImportChapterSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  content: z.string(),
  wordCount: z.number().int().nonnegative(),
});
export type ManuscriptImportChapter = z.infer<typeof manuscriptImportChapterSchema>;

export const manuscriptImportSchema = z.object({
  id: uuidV7Schema,
  status: manuscriptImportStatusSchema,
  sourceName: z.string().min(1),
  format: manuscriptImportFormatSchema,
  chapters: z.array(manuscriptImportChapterSchema),
  warnings: z.array(manuscriptImportWarningSchema),
  canConfirm: z.boolean(),
  confirmedWorkId: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
});
export type ManuscriptImport = z.infer<typeof manuscriptImportSchema>;

export const manuscriptImportResponseSchema = apiEnvelopeSchema(manuscriptImportSchema);

export const STORY_BIBLE_CARD_KEYS = [
  "oneSentence",
  "sellingPoints",
  "protagonist",
  "goldenFinger",
  "worldLaws",
  "mainPlot",
  "subplots",
  "ending",
  "readerPromise",
] as const;

export const storyBibleCardKeySchema = z.enum(STORY_BIBLE_CARD_KEYS);
export type StoryBibleCardKey = z.infer<typeof storyBibleCardKeySchema>;

export const STORY_BIBLE_CARD_TITLES: Record<StoryBibleCardKey, string> = {
  oneSentence: "一句话故事",
  sellingPoints: "核心卖点",
  protagonist: "主角",
  goldenFinger: "金手指",
  worldLaws: "世界铁律",
  mainPlot: "主线",
  subplots: "支线",
  ending: "结局方向",
  readerPromise: "读者承诺",
};

export const storyBibleStatusSchema = z.enum(["draft", "proposed", "locked"]);
export type StoryBibleStatus = z.infer<typeof storyBibleStatusSchema>;

export const storyBibleWorldRuleSchema = z
  .object({
    id: uuidV7Schema,
    name: z.string().trim().min(1).max(120),
    constraint: z.string().trim().min(1).max(2_000),
    scope: z.string().trim().min(1).max(500),
    exceptions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  })
  .strict();
export type StoryBibleWorldRule = z.infer<typeof storyBibleWorldRuleSchema>;

export const storyBibleWorldRuleInputSchema = storyBibleWorldRuleSchema.extend({
  id: uuidV7Schema.optional(),
});
export type StoryBibleWorldRuleInput = z.infer<typeof storyBibleWorldRuleInputSchema>;

export const storyBibleCardSchema = z
  .object({
    key: storyBibleCardKeySchema,
    title: z.string().min(1),
    content: z.string().max(20_000),
    complete: z.boolean(),
    worldRules: z.array(storyBibleWorldRuleSchema).max(20).default([]),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.key !== "worldLaws" && card.worldRules.length > 0) {
      context.addIssue({
        code: "custom",
        message: "worldRules are only allowed on worldLaws",
        path: ["worldRules"],
      });
    }
  });
export type StoryBibleCard = z.infer<typeof storyBibleCardSchema>;

export const storyBibleMissingCardSchema = z.object({
  key: storyBibleCardKeySchema,
  title: z.string().min(1),
});
export type StoryBibleMissingCard = z.infer<typeof storyBibleMissingCardSchema>;

export const storyBibleIssueSchema = z.object({
  code: z.enum(["missing_card", "missing_world_rule", "contradictory_world_rule"]),
  key: storyBibleCardKeySchema,
  title: z.string().min(1),
  message: z.string().min(1),
});
export type StoryBibleIssue = z.infer<typeof storyBibleIssueSchema>;

export const storyBibleReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().min(0).max(9),
  total: z.literal(9),
  canLock: z.boolean(),
  missingCards: z.array(storyBibleMissingCardSchema).max(9),
  issues: z.array(storyBibleIssueSchema).max(20),
});
export type StoryBibleReadiness = z.infer<typeof storyBibleReadinessSchema>;

export const storyBibleProposalSchema = z.object({
  generatedAt: z.string().datetime(),
  source: z.literal("work_premise"),
});
export type StoryBibleProposal = z.infer<typeof storyBibleProposalSchema>;

const storyBibleCardsSchema = z
  .array(storyBibleCardSchema)
  .length(9)
  .superRefine((cards, context) => {
    const keys = cards.map((card) => card.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Story bible card keys must be unique" });
    }
    for (const key of STORY_BIBLE_CARD_KEYS) {
      if (!keys.includes(key)) {
        context.addIssue({ code: "custom", message: `Story bible card ${key} is required` });
      }
    }
  });

export const storyBibleSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  version: z.number().int().positive(),
  status: storyBibleStatusSchema,
  cards: storyBibleCardsSchema,
  readiness: storyBibleReadinessSchema,
  proposal: storyBibleProposalSchema.nullable(),
  lockedAt: z.string().datetime().nullable(),
  lockedBy: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoryBible = z.infer<typeof storyBibleSchema>;

export const storyBiblePatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    cards: z
      .array(
        z.object({
          key: storyBibleCardKeySchema,
          content: z.string().max(20_000),
          worldRules: z.array(storyBibleWorldRuleInputSchema).max(20).optional(),
        }),
      )
      .min(1)
      .max(9),
  })
  .superRefine((input, context) => {
    const keys = input.cards.map((card) => card.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Story bible card updates must have unique keys",
        path: ["cards"],
      });
    }
    for (const card of input.cards) {
      if (card.key === "worldLaws" && card.worldRules === undefined) {
        context.addIssue({
          code: "custom",
          message: "worldLaws card requires structured world rules",
          path: ["cards"],
        });
      }
      if (card.key !== "worldLaws" && card.worldRules !== undefined) {
        context.addIssue({
          code: "custom",
          message: "worldRules are only allowed on worldLaws",
          path: ["cards"],
        });
      }
    }
  });
export type StoryBiblePatchRequest = z.infer<typeof storyBiblePatchRequestSchema>;

export const storyBibleGenerateRequestSchema = z.object({}).strict();
export type StoryBibleGenerateRequest = z.infer<typeof storyBibleGenerateRequestSchema>;

export const storyBibleLockRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type StoryBibleLockRequest = z.infer<typeof storyBibleLockRequestSchema>;

export const storyBibleUnlockRequestSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});
export type StoryBibleUnlockRequest = z.infer<typeof storyBibleUnlockRequestSchema>;

export const storyBibleVersionActionSchema = z.enum(["proposed", "edited", "locked", "unlocked"]);
export type StoryBibleVersionAction = z.infer<typeof storyBibleVersionActionSchema>;

export const storyBibleVersionSchema = z.object({
  id: uuidV7Schema,
  storyBibleId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  version: z.number().int().positive(),
  action: storyBibleVersionActionSchema,
  actorId: uuidV7Schema,
  reason: z.string().min(1),
  cards: storyBibleCardsSchema,
  createdAt: z.string().datetime(),
});
export type StoryBibleVersion = z.infer<typeof storyBibleVersionSchema>;

export const storyBibleChangeRequestCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    cardKey: storyBibleCardKeySchema,
    title: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    after: storyBibleCardSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.cardKey !== input.after.key) {
      context.addIssue({
        code: "custom",
        message: "Change request card key must match the after card",
        path: ["cardKey"],
      });
    }
    if (input.cardKey === "worldLaws" && input.after.worldRules.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Locked worldLaws change requests require structured world rules",
        path: ["after", "worldRules"],
      });
    }
  });
export type StoryBibleChangeRequestCreateRequest = z.infer<
  typeof storyBibleChangeRequestCreateRequestSchema
>;

export const storyBibleChangeRequestSchema = z.object({
  id: uuidV7Schema,
  storyBibleId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  cardKey: storyBibleCardKeySchema,
  title: z.string().min(1),
  reason: z.string().min(1),
  before: storyBibleCardSchema,
  after: storyBibleCardSchema,
  status: z.enum(["pending", "analyzing", "approved", "rejected", "applied"]),
  risk: z.enum(["low", "medium", "high"]),
  source: z.enum(["author", "ai", "import", "batch"]),
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type StoryBibleChangeRequest = z.infer<typeof storyBibleChangeRequestSchema>;

export const storyBibleResponseSchema = apiEnvelopeSchema(storyBibleSchema);
export const storyBibleReadinessResponseSchema = apiEnvelopeSchema(storyBibleReadinessSchema);
export const storyBibleVersionListQuerySchema = z.object({
  cursor: uuidV7Schema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type StoryBibleVersionListQuery = z.infer<typeof storyBibleVersionListQuerySchema>;

export const storyBibleWorldRuleListQuerySchema = z.object({
  cursor: uuidV7Schema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export type StoryBibleWorldRuleListQuery = z.infer<typeof storyBibleWorldRuleListQuerySchema>;

export const storyBibleVersionListResponseSchema = z.object({
  data: z.array(storyBibleVersionSchema),
  requestId: z.string().startsWith("req_"),
  meta: z.object({ nextCursor: uuidV7Schema.nullable() }),
});
export const storyBibleWorldRuleListResponseSchema = z.object({
  data: z.array(storyBibleWorldRuleSchema),
  requestId: z.string().startsWith("req_"),
  meta: z.object({ nextCursor: uuidV7Schema.nullable() }),
});
export const storyBibleChangeRequestResponseSchema = apiEnvelopeSchema(
  storyBibleChangeRequestSchema,
);
export const storyBibleDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

export const settingEntityTypeSchema = z.enum([
  "world_rule",
  "character",
  "faction",
  "map",
  "power_system",
  "golden_finger",
  "item",
  "timeline_event",
]);
export type SettingEntityType = z.infer<typeof settingEntityTypeSchema>;

export const settingStatusSchema = z.enum(["draft", "proposed", "locked", "discarded"]);
export type SettingStatus = z.infer<typeof settingStatusSchema>;

export const settingSourceSchema = z.enum(["author", "import", "ai", "canon"]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

export const customFieldTypeSchema = z.enum([
  "text",
  "long_text",
  "number",
  "date",
  "single_select",
  "multi_select",
  "boolean",
  "relation_ref",
]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const customFieldAppliesToSchema = z.enum([
  "all",
  "world_rule",
  "character",
  "faction",
  "map",
  "power_system",
  "golden_finger",
  "item",
  "timeline_event",
]);
export type CustomFieldAppliesTo = z.infer<typeof customFieldAppliesToSchema>;

const customFieldOptionsSchema = z.array(z.string().trim().min(1).max(80)).max(100).default([]);

const customFieldDefinitionBaseShape = {
  label: z.string().trim().min(1).max(80),
  fieldType: customFieldTypeSchema,
  appliesTo: customFieldAppliesToSchema,
  required: z.boolean().default(false),
  options: customFieldOptionsSchema,
  relationTarget: settingEntityTypeSchema.nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
};

export const customFieldDefinitionCreateRequestSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, "Expected a lowercase field key"),
    ...customFieldDefinitionBaseShape,
  })
  .strict()
  .superRefine(validateCustomFieldDefinitionShape);
export type CustomFieldDefinitionCreateRequest = z.infer<
  typeof customFieldDefinitionCreateRequestSchema
>;

export const customFieldDefinitionPatchRequestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    key: z.string().trim().optional(),
    label: z.string().trim().min(1).max(80).optional(),
    fieldType: customFieldTypeSchema.optional(),
    appliesTo: customFieldAppliesToSchema.optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    relationTarget: settingEntityTypeSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "schemaVersion"), {
    message: "At least one custom field change is required",
  });
export type CustomFieldDefinitionPatchRequest = z.infer<
  typeof customFieldDefinitionPatchRequestSchema
>;

export const customFieldDefinitionSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  key: z.string(),
  label: z.string(),
  fieldType: customFieldTypeSchema,
  appliesTo: customFieldAppliesToSchema,
  required: z.boolean(),
  options: z.array(z.string()),
  relationTarget: settingEntityTypeSchema.nullable(),
  enabled: z.boolean(),
  schemaVersion: z.number().int().positive(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const customFieldValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const customFieldValuesSchema = z.record(z.string().trim().min(1).max(80), z.unknown());
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

export const customFieldDefinitionResponseSchema = apiEnvelopeSchema(customFieldDefinitionSchema);
export const customFieldDefinitionListResponseSchema = apiEnvelopeSchema(
  z.array(customFieldDefinitionSchema),
);

export const settingConflictTypeSchema = z.enum([
  "none",
  "duplicate_name",
  "alias_collision",
  "contradictory_fact",
  "import_candidate",
  "ai_disagreement",
]);
export type SettingConflictType = z.infer<typeof settingConflictTypeSchema>;

export const settingEvidenceKindSchema = z.enum([
  "chapter",
  "entity",
  "import",
  "author_note",
  "ai_suggestion",
]);
export type SettingEvidenceKind = z.infer<typeof settingEvidenceKindSchema>;

export const settingEvidenceSchema = z
  .object({
    kind: settingEvidenceKindSchema,
    sourceId: uuidV7Schema.nullable().default(null),
    label: z.string().trim().min(1).max(200),
    quote: z.string().max(5_000).default(""),
    locator: z.string().max(500).default(""),
    confidence: z.number().min(0).max(1).nullable().default(null),
  })
  .strict();
export type SettingEvidence = z.infer<typeof settingEvidenceSchema>;

export const settingProposalCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
    conflictType: settingConflictTypeSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SettingProposalCreateRequest = z.infer<typeof settingProposalCreateRequestSchema>;

export const settingProposalDecisionRequestSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    reason: z.string().trim().min(1).max(1_000),
    conflictType: settingConflictTypeSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SettingProposalDecisionRequest = z.infer<typeof settingProposalDecisionRequestSchema>;

export const settingProposalStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type SettingProposalStatus = z.infer<typeof settingProposalStatusSchema>;

export const settingProposalSchema = z.object({
  id: uuidV7Schema,
  entityId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  entityVersion: z.number().int().positive(),
  status: settingProposalStatusSchema,
  conflictType: settingConflictTypeSchema,
  evidence: z.array(settingEvidenceSchema),
  reason: z.string(),
  proposedBy: uuidV7Schema,
  createdAt: z.string().datetime(),
  decidedBy: uuidV7Schema.nullable(),
  decidedAt: z.string().datetime().nullable(),
  decisionReason: z.string().nullable(),
  decisionEvidence: z.array(settingEvidenceSchema),
  decisionConflictType: settingConflictTypeSchema.nullable(),
});
export type SettingProposal = z.infer<typeof settingProposalSchema>;

export const settingProposalResponseSchema = apiEnvelopeSchema(settingProposalSchema);
export const settingProposalListResponseSchema = apiEnvelopeSchema(z.array(settingProposalSchema));

export const worldRuleDataSchema = z
  .object({
    rule: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type WorldRuleData = z.infer<typeof worldRuleDataSchema>;

export const characterDataSchema = z
  .object({
    bodyState: z.string().trim().min(1).max(20_000),
    knowledgeBoundary: z.string().trim().min(1).max(20_000),
    relationshipSummary: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type CharacterData = z.infer<typeof characterDataSchema>;

export const goldenFingerDataSchema = z
  .object({
    rules: z.string().trim().min(1).max(20_000),
    cost: z.string().trim().min(1).max(20_000),
    limits: z.string().trim().min(1).max(20_000),
    growth: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type GoldenFingerData = z.infer<typeof goldenFingerDataSchema>;

export const factionDataSchema = z
  .object({
    details: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type FactionData = z.infer<typeof factionDataSchema>;

export const mapDataSchema = z
  .object({
    details: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type MapData = z.infer<typeof mapDataSchema>;

export const powerSystemDataSchema = z
  .object({
    details: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type PowerSystemData = z.infer<typeof powerSystemDataSchema>;

export const itemDataSchema = z
  .object({
    category: z.string().trim().min(1).max(200),
    grade: z.string().trim().max(200).default(""),
    effect: z.string().trim().min(1).max(20_000),
    cost: z.string().trim().max(20_000).default(""),
    ownership: z.string().trim().max(500).default(""),
    limits: z.string().trim().max(20_000).default(""),
  })
  .strict();
export type ItemData = z.infer<typeof itemDataSchema>;

export const timelineEventDataSchema = z
  .object({
    era: z.string().trim().max(200).default(""),
    storyTime: z.string().trim().min(1).max(500),
    duration: z.string().trim().max(500).default(""),
    event: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type TimelineEventData = z.infer<typeof timelineEventDataSchema>;

const settingEntityBaseShape = {
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  summary: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
};

const settingEntityPatchShape = {
  name: z.string().trim().min(1).max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
};

export const settingEntityCreateRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("world_rule"),
    ...settingEntityBaseShape,
    data: worldRuleDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("character"),
    ...settingEntityBaseShape,
    data: characterDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("faction"),
    ...settingEntityBaseShape,
    data: factionDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("map"),
    ...settingEntityBaseShape,
    data: mapDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("power_system"),
    ...settingEntityBaseShape,
    data: powerSystemDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("golden_finger"),
    ...settingEntityBaseShape,
    data: goldenFingerDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("item"),
    ...settingEntityBaseShape,
    data: itemDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("timeline_event"),
    ...settingEntityBaseShape,
    data: timelineEventDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
]);
export type SettingEntityCreateRequest = z.infer<typeof settingEntityCreateRequestSchema>;

export const settingEntityPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    ...settingEntityPatchShape,
    customFields: customFieldValuesSchema.optional(),
    data: z
      .union([
        worldRuleDataSchema.partial(),
        characterDataSchema.partial(),
        factionDataSchema.partial(),
        mapDataSchema.partial(),
        powerSystemDataSchema.partial(),
        goldenFingerDataSchema.partial(),
        itemDataSchema.partial(),
        timelineEventDataSchema.partial(),
      ])
      .optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.aliases !== undefined ||
      input.summary !== undefined ||
      input.description !== undefined ||
      input.tags !== undefined ||
      input.customFields !== undefined ||
      input.data !== undefined,
    { message: "At least one setting field is required" },
  );
export type SettingEntityPatchRequest = z.infer<typeof settingEntityPatchRequestSchema>;

export const settingChangeRequestCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(1_000),
    after: z
      .object({
        ...settingEntityPatchShape,
        customFields: customFieldValuesSchema.optional(),
        data: z
          .union([
            worldRuleDataSchema.partial(),
            characterDataSchema.partial(),
            factionDataSchema.partial(),
            mapDataSchema.partial(),
            powerSystemDataSchema.partial(),
            goldenFingerDataSchema.partial(),
            itemDataSchema.partial(),
            timelineEventDataSchema.partial(),
          ])
          .optional(),
      })
      .refine(
        (input) =>
          input.name !== undefined ||
          input.aliases !== undefined ||
          input.summary !== undefined ||
          input.description !== undefined ||
          input.tags !== undefined ||
          input.customFields !== undefined ||
          input.data !== undefined,
        { message: "At least one setting field is required" },
      ),
    conflictType: settingConflictTypeSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SettingChangeRequestCreateRequest = z.infer<
  typeof settingChangeRequestCreateRequestSchema
>;

export const settingChangeRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "applied",
]);
export type SettingChangeRequestStatus = z.infer<typeof settingChangeRequestStatusSchema>;

export const settingChangeRequestSchema = z.object({
  id: uuidV7Schema,
  entityId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  entityVersion: z.number().int().positive(),
  title: z.string(),
  reason: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  status: settingChangeRequestStatusSchema,
  conflictType: settingConflictTypeSchema,
  evidence: z.array(settingEvidenceSchema),
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type SettingChangeRequest = z.infer<typeof settingChangeRequestSchema>;

export const settingChangeRequestResponseSchema = apiEnvelopeSchema(settingChangeRequestSchema);
export const settingChangeRequestListResponseSchema = apiEnvelopeSchema(
  z.array(settingChangeRequestSchema),
);

export const settingEntityLockRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type SettingEntityLockRequest = z.infer<typeof settingEntityLockRequestSchema>;

const settingEntityCommonShape = {
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  name: z.string(),
  aliases: z.array(z.string()),
  summary: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  customFields: z.record(z.string(), customFieldValueSchema),
  status: settingStatusSchema,
  source: settingSourceSchema,
  version: z.number().int().positive(),
  lockedAt: z.string().datetime().nullable(),
  lockedBy: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const settingEntitySchema = z.discriminatedUnion("type", [
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("world_rule"),
    data: worldRuleDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("character"),
    data: characterDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("faction"),
    data: factionDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("map"),
    data: mapDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("power_system"),
    data: powerSystemDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("golden_finger"),
    data: goldenFingerDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("item"),
    data: itemDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("timeline_event"),
    data: timelineEventDataSchema,
  }),
]);
export type SettingEntity = z.infer<typeof settingEntitySchema>;

export const settingEntityListQuerySchema = z.object({
  type: settingEntityTypeSchema.optional(),
  status: settingStatusSchema.optional(),
});
export type SettingEntityListQuery = z.infer<typeof settingEntityListQuerySchema>;

export const settingEntityResponseSchema = apiEnvelopeSchema(settingEntitySchema);
export const settingEntityListResponseSchema = apiEnvelopeSchema(z.array(settingEntitySchema));
export const settingEntityDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

function validateCustomFieldDefinitionShape(
  input: Pick<CustomFieldDefinitionCreateRequest, "fieldType" | "options" | "relationTarget">,
  context: z.RefinementCtx,
): void {
  const selectField = input.fieldType === "single_select" || input.fieldType === "multi_select";
  if (selectField && input.options.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Select fields require at least one option",
    });
  }
  if (!selectField && input.options.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Only select fields can define options",
    });
  }
  if (new Set(input.options).size !== input.options.length) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Select field options must be unique",
    });
  }
  if (input.fieldType === "relation_ref" && input.relationTarget === null) {
    context.addIssue({
      code: "custom",
      path: ["relationTarget"],
      message: "Relation fields require a target type",
    });
  }
  if (input.fieldType !== "relation_ref" && input.relationTarget !== null) {
    context.addIssue({
      code: "custom",
      path: ["relationTarget"],
      message: "Only relation fields can define a target type",
    });
  }
}

export const confirmedSettingSchema = z
  .object({
    kind: z.enum(["setting", "fact"]).optional(),
    id: uuidV7Schema,
    type: settingEntityTypeSchema,
    name: z.string(),
    summary: z.string(),
    source: settingSourceSchema,
    status: z.literal("locked"),
    version: z.number().int().positive(),
    lockedAt: z.string().datetime(),
    sourceChapterId: uuidV7Schema.optional(),
    sourceFactId: uuidV7Schema.optional(),
    validFromChapter: z.number().int().positive().optional(),
    validToChapter: z.number().int().positive().nullable().optional(),
    predicate: z.string().optional(),
    object: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.kind !== "fact") {
      return;
    }
    const requiredFactFields = [
      ["sourceChapterId", value.sourceChapterId],
      ["validFromChapter", value.validFromChapter],
      ["validToChapter", value.validToChapter],
      ["predicate", value.predicate],
      ["object", value.object],
    ] as const;
    for (const [field, fieldValue] of requiredFactFields) {
      if (fieldValue === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for confirmed facts`,
        });
      }
    }
  });
export type ConfirmedSetting = z.infer<typeof confirmedSettingSchema>;

export const confirmedSettingListResponseSchema = apiEnvelopeSchema(
  z.array(confirmedSettingSchema),
);

export const chapterStatusSchema = z.enum([
  "planned",
  "writing",
  "waiting_review",
  "changes_requested",
  "approved",
  "locked",
  "published",
  "rejected",
]);
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;

export const chapterSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  number: z.number().int().positive(),
  title: z.string(),
  status: chapterStatusSchema,
  version: z.number().int().positive(),
  wordCount: z.number().int().nonnegative(),
  currentVersionId: uuidV7Schema,
});
export type Chapter = z.infer<typeof chapterSchema>;

export const chapterBriefSchema = z
  .object({
    goal: z.string().trim().min(1).max(5_000),
    pov: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200),
    sceneBeats: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
    requiredFacts: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
  })
  .strict();
export type ChapterBrief = z.infer<typeof chapterBriefSchema>;

export const chapterReadinessItemSchema = z.object({
  key: z.enum(["story_bible", "settings", "brief"]),
  label: z.string().min(1),
  ready: z.boolean(),
  missing: z.array(z.string().min(1)),
});
export type ChapterReadinessItem = z.infer<typeof chapterReadinessItemSchema>;

export const chapterReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().min(0).max(3),
  total: z.literal(3),
  canStartWriting: z.boolean(),
  items: z.array(chapterReadinessItemSchema).length(3),
});
export type ChapterReadiness = z.infer<typeof chapterReadinessSchema>;

export const chapterVersionSchema = z.object({
  id: uuidV7Schema,
  chapterId: uuidV7Schema,
  version: z.number().int().positive(),
  content: z.string(),
  contentHash: z.string().min(1),
  versionNodeId: uuidV7Schema,
  parentNodeId: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
});
export type ChapterVersion = z.infer<typeof chapterVersionSchema>;

export const chapterWorkspaceSchema = chapterSchema.omit({ currentVersionId: true }).extend({
  currentVersionId: uuidV7Schema.nullable(),
  currentVersion: chapterVersionSchema.nullable(),
  brief: chapterBriefSchema.nullable(),
  readiness: chapterReadinessSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChapterWorkspace = z.infer<typeof chapterWorkspaceSchema>;

export const chapterCreateRequestSchema = z
  .object({
    number: z.number().int().positive().max(10_000),
    title: z.string().trim().min(1).max(200),
    brief: chapterBriefSchema,
  })
  .strict();
export type ChapterCreateRequest = z.infer<typeof chapterCreateRequestSchema>;

export const chapterPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    brief: chapterBriefSchema.optional(),
  })
  .strict()
  .refine((input) => input.title !== undefined || input.brief !== undefined, {
    message: "At least one chapter field is required",
  });
export type ChapterPatchRequest = z.infer<typeof chapterPatchRequestSchema>;

export const chapterVersionCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    content: z
      .string()
      .min(1)
      .max(200_000)
      .refine((content) => content.trim().length > 0, "Chapter content cannot be blank"),
  })
  .strict();
export type ChapterVersionCreateRequest = z.infer<typeof chapterVersionCreateRequestSchema>;

export const chapterWorkspaceListResponseSchema = apiEnvelopeSchema(
  z.array(chapterWorkspaceSchema),
);
export const chapterWorkspaceResponseSchema = apiEnvelopeSchema(chapterWorkspaceSchema);
export const chapterReadinessResponseSchema = apiEnvelopeSchema(chapterReadinessSchema);
export const chapterVersionListResponseSchema = apiEnvelopeSchema(z.array(chapterVersionSchema));
export const chapterVersionSaveDataSchema = z.object({
  chapter: chapterWorkspaceSchema,
  version: chapterVersionSchema,
});
export type ChapterVersionSaveData = z.infer<typeof chapterVersionSaveDataSchema>;
export const chapterVersionSaveResponseSchema = apiEnvelopeSchema(chapterVersionSaveDataSchema);

export const chapterReviewActionSchema = z.enum(["approve", "reject"]);
export type ChapterReviewAction = z.infer<typeof chapterReviewActionSchema>;

export const chapterReviewRequestSchema = z.object({
  action: chapterReviewActionSchema,
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1_000).optional(),
});
export type ChapterReviewRequest = z.infer<typeof chapterReviewRequestSchema>;

export const chapterReviewDecisionSchema = z.object({
  id: uuidV7Schema,
  chapterId: uuidV7Schema,
  action: chapterReviewActionSchema,
  actorId: uuidV7Schema,
  actorName: z.string().min(1),
  reason: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type ChapterReviewDecision = z.infer<typeof chapterReviewDecisionSchema>;

export const chapterReviewDataSchema = z.object({
  chapter: chapterWorkspaceSchema,
  decision: chapterReviewDecisionSchema,
});
export type ChapterReviewData = z.infer<typeof chapterReviewDataSchema>;
export const chapterReviewResponseSchema = apiEnvelopeSchema(chapterReviewDataSchema);

export const canonCommitRequestSchema = z.object({
  chapterVersionId: uuidV7Schema,
});
export type CanonCommitRequest = z.infer<typeof canonCommitRequestSchema>;

export const factProposalStatusSchema = z.enum([
  "proposed",
  "confirmed",
  "modified_confirmed",
  "rejected",
  "superseded",
]);
export type FactProposalStatus = z.infer<typeof factProposalStatusSchema>;

export const factRiskSchema = z.enum(["low", "medium", "high"]);
export type FactRisk = z.infer<typeof factRiskSchema>;

export const factDecisionActionSchema = z.enum([
  "confirm",
  "modify_confirm",
  "reject",
  "supersede",
]);
export type FactDecisionAction = z.infer<typeof factDecisionActionSchema>;

export const factDecisionSchema = z.object({
  id: uuidV7Schema,
  action: factDecisionActionSchema,
  actorId: uuidV7Schema,
  actorName: z.string().min(1),
  reason: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type FactDecision = z.infer<typeof factDecisionSchema>;

export const factProposalSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  sourceVersionId: uuidV7Schema,
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  sourceSentence: z.string().min(1),
  status: factProposalStatusSchema,
  confidence: z.number().min(0).max(1),
  risk: factRiskSchema,
  required: z.boolean(),
  decision: factDecisionSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FactProposal = z.infer<typeof factProposalSchema>;

export const factProposalModificationSchema = z
  .object({
    subject: z.string().trim().min(1).max(500).optional(),
    predicate: z.string().trim().min(1).max(500).optional(),
    object: z.string().trim().min(1).max(5_000).optional(),
    risk: factRiskSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one edited field is required",
  });
export type FactProposalModification = z.infer<typeof factProposalModificationSchema>;

export const factProposalDecisionRequestSchema = z
  .object({
    action: factDecisionActionSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    modified: factProposalModificationSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.action === "modify_confirm" && !input.modified) {
      context.addIssue({
        code: "custom",
        path: ["modified"],
        message: "Modified confirmation requires at least one edited field",
      });
    }
    if (input.action !== "modify_confirm" && input.modified) {
      context.addIssue({
        code: "custom",
        path: ["modified"],
        message: "Edited fields are only allowed for modified confirmation",
      });
    }
  });
export type FactProposalDecisionRequest = z.infer<typeof factProposalDecisionRequestSchema>;

export const factProposalListResponseSchema = apiEnvelopeSchema(z.array(factProposalSchema));
export const factProposalResponseSchema = apiEnvelopeSchema(factProposalSchema);

export const canonCommitFactSchema = z.object({
  id: uuidV7Schema,
  proposalId: uuidV7Schema,
  decisionId: uuidV7Schema,
  sourceChapterId: uuidV7Schema,
  validFromChapter: z.number().int().positive(),
  validToChapter: z.number().int().positive().nullable(),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  risk: factRiskSchema,
  required: z.boolean(),
  status: z.enum(["confirmed", "modified_confirmed"]),
});
export type CanonCommitFact = z.infer<typeof canonCommitFactSchema>;

export const canonCommitDecisionSchema = z.object({
  proposalId: uuidV7Schema,
  decisionId: uuidV7Schema,
  action: factDecisionActionSchema,
  resultingStatus: factProposalStatusSchema,
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  risk: factRiskSchema,
  required: z.boolean(),
  sourceSentence: z.string().min(1),
  actorName: z.string().min(1),
  reason: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type CanonCommitDecision = z.infer<typeof canonCommitDecisionSchema>;

export const canonCommitSummarySchema = z.object({
  factCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  text: z.string().min(1),
});
export type CanonCommitSummary = z.infer<typeof canonCommitSummarySchema>;

export const canonCommitSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  chapterVersionId: uuidV7Schema,
  versionNodeId: uuidV7Schema,
  sourceChapter: z.object({
    id: uuidV7Schema,
    number: z.number().int().positive(),
    title: z.string().min(1),
  }),
  decisions: z.array(canonCommitDecisionSchema),
  facts: z.array(canonCommitFactSchema),
  summary: canonCommitSummarySchema,
  createdAt: z.string().datetime(),
});
export type CanonCommit = z.infer<typeof canonCommitSchema>;

export const canonCommitResponseSchema = apiEnvelopeSchema(canonCommitSchema);
export const canonCommitListResponseSchema = apiEnvelopeSchema(z.array(canonCommitSchema));

export const manuscriptImportConfirmRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(50).optional(),
  genre: workGenreSchema.default("xianxia"),
  scaleTarget: workScaleTargetSchema.default("long"),
  chapterLengthTarget: z.number().int().min(1000).max(10000).default(3000),
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(1_000),
});
export type ManuscriptImportConfirmRequest = z.infer<typeof manuscriptImportConfirmRequestSchema>;

export const manuscriptImportConfirmDataSchema = z.object({
  work: workOverviewSchema,
  chapters: z.array(chapterSchema),
  chapterVersions: z.array(chapterVersionSchema),
});
export type ManuscriptImportConfirmData = z.infer<typeof manuscriptImportConfirmDataSchema>;

export const manuscriptImportConfirmResponseSchema = apiEnvelopeSchema(
  manuscriptImportConfirmDataSchema,
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
export type WorkerJobStep = z.infer<typeof workerJobStepSchema>;

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

export const generationBudgetSchema = generateChapterJobSchema.shape.budget;
export type GenerationBudget = z.infer<typeof generationBudgetSchema>;

export const generationJobStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "paused",
  "waiting_review",
  "completed",
  "failed",
  "cancelled",
]);
export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>;

export const generationCostSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costCny: z.number().nonnegative(),
});
export type GenerationCost = z.infer<typeof generationCostSchema>;

export const generationCheckpointSchema = z.object({
  step: workerJobStepSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type GenerationCheckpoint = z.infer<typeof generationCheckpointSchema>;

export const generationJobErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
});
export type GenerationJobError = z.infer<typeof generationJobErrorSchema>;

export const contextSourceTypeSchema = z.enum([
  "story_bible",
  "setting",
  "chapter_brief",
  "chapter_version",
  "style",
]);
export type ContextSourceType = z.infer<typeof contextSourceTypeSchema>;

export const contextSourceRefSchema = z.object({
  sourceType: contextSourceTypeSchema,
  sourceId: uuidV7Schema,
  label: z.string().min(1),
  citation: z.string().min(1),
});
export type ContextSourceRef = z.infer<typeof contextSourceRefSchema>;

export const contextSourcePrioritySchema = z.enum(["required", "high", "normal"]);
export type ContextSourcePriority = z.infer<typeof contextSourcePrioritySchema>;

export const contextPackSelectedSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  priority: contextSourcePrioritySchema,
  content: z.string().min(1),
  tokenCount: z.number().int().positive(),
  sourceRefs: z.array(contextSourceRefSchema).min(1),
});
export type ContextPackSelected = z.infer<typeof contextPackSelectedSchema>;

export const contextPackEvictionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  reason: z.literal("token_budget"),
  tokenCount: z.number().int().positive(),
});
export type ContextPackEviction = z.infer<typeof contextPackEvictionSchema>;

export const contextPackVersionSchema = z.object({
  id: uuidV7Schema,
  jobId: uuidV7Schema,
  version: z.number().int().positive(),
  compilerVersion: z.string().min(1),
  tokenBudget: z.number().int().positive(),
  tokenUsed: z.number().int().nonnegative(),
  selected: z.array(contextPackSelectedSchema),
  evicted: z.array(contextPackEvictionSchema),
  sourceRefs: z.array(contextSourceRefSchema),
  createdAt: z.string().datetime(),
});
export type ContextPackVersion = z.infer<typeof contextPackVersionSchema>;

export const contextPackPreviewSchema = z.object({
  compilerVersion: z.string().min(1),
  tokenBudget: z.number().int().positive(),
  tokenUsed: z.number().int().nonnegative(),
  selected: z.array(contextPackSelectedSchema),
  evicted: z.array(contextPackEvictionSchema),
  sourceRefs: z.array(contextSourceRefSchema),
});
export type ContextPackPreview = z.infer<typeof contextPackPreviewSchema>;

export const generationJobSchema = z.object({
  id: uuidV7Schema,
  type: z.literal(GENERATE_CHAPTER_JOB),
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  status: generationJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  currentStep: workerJobStepSchema,
  budget: generationBudgetSchema,
  cost: generationCostSchema,
  checkpoint: generationCheckpointSchema,
  error: generationJobErrorSchema.nullable(),
  contextPack: contextPackVersionSchema.nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type GenerationJob = z.infer<typeof generationJobSchema>;

export const generateChapterRequestSchema = z
  .object({
    budget: generationBudgetSchema.default({
      maxCostCny: 2.5,
      maxTokens: 30_000,
      maxRevisionRounds: 2,
    }),
  })
  .strict();
export type GenerateChapterRequest = z.infer<typeof generateChapterRequestSchema>;

export const jobEventTypeSchema = z.enum([
  "job.created",
  "job.preparing",
  "job.step.started",
  "job.step.succeeded",
  "job.step.failed",
  "job.progress",
  "job.waiting_review",
  "job.paused",
  "job.resumed",
  "job.canceled",
  "job.completed",
  "job.failed",
]);
export type JobEventType = z.infer<typeof jobEventTypeSchema>;

export const jobEventSchema = z.object({
  eventId: uuidV7Schema,
  type: jobEventTypeSchema,
  occurredAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()),
});
export type JobEvent = z.infer<typeof jobEventSchema>;

export const generationJobResponseSchema = apiEnvelopeSchema(generationJobSchema);
export const generationJobListResponseSchema = apiEnvelopeSchema(z.array(generationJobSchema));
export const contextPackResponseSchema = apiEnvelopeSchema(contextPackVersionSchema.nullable());
export const contextPackPreviewResponseSchema = apiEnvelopeSchema(contextPackPreviewSchema);

export const agentRoleSchema = z.enum([
  "planner",
  "context_curator",
  "writer",
  "critic",
  "reviser",
  "fact_extractor",
  "canon_curator",
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const toolSideEffectLevelSchema = z.enum(["S0", "S1", "S2", "S3", "S4"]);
export type ToolSideEffectLevel = z.infer<typeof toolSideEffectLevelSchema>;

export const toolCategorySchema = z.enum([
  "read_story",
  "read_context",
  "write_draft",
  "write_review",
  "propose_fact",
  "commit_canon",
  "external_irreversible",
]);
export type ToolCategory = z.infer<typeof toolCategorySchema>;

export const toolNameSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Expected a namespaced tool name");
export type ToolName = z.infer<typeof toolNameSchema>;

export const jsonSchemaDocumentSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => typeof schema.type === "string", "JSON Schema must declare a root type");
export type JsonSchemaDocument = z.infer<typeof jsonSchemaDocumentSchema>;

export const agentToolDeclarationSchema = z
  .object({
    name: toolNameSchema,
    required: z.boolean(),
  })
  .strict();
export type AgentToolDeclaration = z.infer<typeof agentToolDeclarationSchema>;

export const agentFailureSemanticsSchema = z
  .object({
    invalidOutput: z.literal("fail_run"),
    toolDenied: z.literal("fail_run"),
    budgetExceeded: z.literal("pause_task"),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(5),
        retryableCodes: z.array(z.string().min(1).max(100)).max(8),
        exhaustedAction: z.enum(["fail_run", "pause_task", "escalate_to_author"]),
        preserveCheckpoint: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type AgentFailureSemantics = z.infer<typeof agentFailureSemanticsSchema>;

export const agentContractSchema = z
  .object({
    key: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Expected a namespaced contract key"),
    version: z.number().int().positive(),
    role: agentRoleSchema,
    description: z.string().trim().min(1).max(2_000),
    inputSchema: jsonSchemaDocumentSchema,
    outputSchema: jsonSchemaDocumentSchema,
    tools: z.array(agentToolDeclarationSchema).max(32),
    failureSemantics: agentFailureSemanticsSchema,
  })
  .strict()
  .superRefine((contract, context) => {
    const names = contract.tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["tools"],
        message: "Tool declarations must be unique",
      });
    }
  });
export type AgentContract = z.infer<typeof agentContractSchema>;

export const toolRegistryEntrySchema = z
  .object({
    name: toolNameSchema,
    category: toolCategorySchema,
    sideEffect: toolSideEffectLevelSchema,
    description: z.string().trim().min(1).max(2_000),
    inputSchema: jsonSchemaDocumentSchema,
    agentCallable: z.boolean(),
    approval: z.enum(["none", "human"]),
  })
  .strict();
export type ToolRegistryEntry = z.infer<typeof toolRegistryEntrySchema>;

export const agentGrantStateSchema = z.enum(["active", "revoked", "expired"]);
export type AgentGrantState = z.infer<typeof agentGrantStateSchema>;

export const agentResourceScopeSchema = z
  .object({
    chapterIds: z.array(uuidV7Schema).max(500),
    settingIds: z.array(uuidV7Schema).max(500),
    includeCanon: z.boolean(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (new Set(scope.chapterIds).size !== scope.chapterIds.length) {
      context.addIssue({
        code: "custom",
        path: ["chapterIds"],
        message: "Chapter scope entries must be unique",
      });
    }
    if (new Set(scope.settingIds).size !== scope.settingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["settingIds"],
        message: "Setting scope entries must be unique",
      });
    }
  });
export type AgentResourceScope = z.infer<typeof agentResourceScopeSchema>;

export const agentGrantBudgetLimitsSchema = z
  .object({
    maxCostCny: z.number().positive().max(1_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    maxCalls: z.number().int().positive().max(10_000),
  })
  .strict();
export type AgentGrantBudgetLimits = z.infer<typeof agentGrantBudgetLimitsSchema>;

export const agentGrantBudgetSchema = agentGrantBudgetLimitsSchema
  .extend({
    spentCostCny: z.number().nonnegative(),
    spentTokens: z.number().int().nonnegative(),
    callCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.spentCostCny > budget.maxCostCny) {
      context.addIssue({ code: "custom", path: ["spentCostCny"], message: "Cost budget exceeded" });
    }
    if (budget.spentTokens > budget.maxTokens) {
      context.addIssue({
        code: "custom",
        path: ["spentTokens"],
        message: "Token budget exceeded",
      });
    }
    if (budget.callCount > budget.maxCalls) {
      context.addIssue({ code: "custom", path: ["callCount"], message: "Call budget exceeded" });
    }
  });
export type AgentGrantBudget = z.infer<typeof agentGrantBudgetSchema>;

export const agentGrantMaxImpactSchema = z
  .object({
    maxSideEffect: toolSideEffectLevelSchema,
    maxAffectedResources: z.number().int().positive().max(5_000),
  })
  .strict();
export type AgentGrantMaxImpact = z.infer<typeof agentGrantMaxImpactSchema>;

export const agentGrantCreateRequestSchema = z
  .object({
    taskId: uuidV7Schema,
    role: agentRoleSchema,
    tools: z.array(toolNameSchema).min(1).max(32),
    resourceScope: agentResourceScopeSchema,
    budget: agentGrantBudgetLimitsSchema,
    maxImpact: agentGrantMaxImpactSchema,
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.tools).size !== request.tools.length) {
      context.addIssue({
        code: "custom",
        path: ["tools"],
        message: "Grant tools must be unique",
      });
    }
  });
export type AgentGrantCreateRequest = z.infer<typeof agentGrantCreateRequestSchema>;

export const agentGrantSchema = z
  .object({
    id: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    taskId: uuidV7Schema,
    userId: uuidV7Schema,
    role: agentRoleSchema,
    state: agentGrantStateSchema,
    tools: z.array(toolNameSchema).min(1).max(32),
    resourceScope: agentResourceScopeSchema,
    budget: agentGrantBudgetSchema,
    maxImpact: agentGrantMaxImpactSchema,
    expiresAt: z.string().datetime(),
    issuedBy: uuidV7Schema,
    revokedAt: z.string().datetime().nullable(),
    revokedBy: uuidV7Schema.nullable(),
    revocationReason: z.string().min(1).max(500).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.state === "revoked") {
      if (!grant.revokedAt || !grant.revokedBy || !grant.revocationReason) {
        context.addIssue({
          code: "custom",
          path: ["revokedAt"],
          message: "Revoked grants require revocation evidence",
        });
      }
    } else if (grant.revokedAt || grant.revokedBy || grant.revocationReason) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Only revoked grants may carry revocation evidence",
      });
    }
  });
export type AgentGrant = z.infer<typeof agentGrantSchema>;

export const agentGrantRevokeRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type AgentGrantRevokeRequest = z.infer<typeof agentGrantRevokeRequestSchema>;

export const agentToolApprovalSchema = z
  .object({
    approvalId: uuidV7Schema,
    approvedBy: uuidV7Schema,
    approvedSideEffect: toolSideEffectLevelSchema,
  })
  .strict();
export type AgentToolApproval = z.infer<typeof agentToolApprovalSchema>;

export const agentToolResourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), id: uuidV7Schema }).strict(),
  z.object({ type: z.literal("chapter"), id: uuidV7Schema }).strict(),
  z.object({ type: z.literal("setting"), id: uuidV7Schema }).strict(),
  z.object({ type: z.literal("canon"), id: uuidV7Schema.nullable() }).strict(),
]);
export type AgentToolResource = z.infer<typeof agentToolResourceSchema>;

export const agentToolCallRequestSchema = z
  .object({
    grantId: uuidV7Schema,
    taskId: uuidV7Schema,
    toolName: toolNameSchema,
    resource: agentToolResourceSchema,
    input: z.record(z.string(), z.unknown()),
    estimatedCostCny: z.number().nonnegative().max(1_000),
    estimatedTokens: z.number().int().nonnegative().max(10_000_000),
    affectedResources: z.number().int().positive().max(5_000),
    approval: agentToolApprovalSchema.nullable(),
  })
  .strict();
export type AgentToolCallRequest = z.infer<typeof agentToolCallRequestSchema>;

export const agentGrantResponseSchema = apiEnvelopeSchema(agentGrantSchema);
export const agentGrantListResponseSchema = apiEnvelopeSchema(z.array(agentGrantSchema));
export const agentGrantRevokeResponseSchema = agentGrantResponseSchema;
