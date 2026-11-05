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
  "SETTING_LOCKED",
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

export const storyBibleCardSchema = z.object({
  key: storyBibleCardKeySchema,
  title: z.string().min(1),
  content: z.string().max(20_000),
  complete: z.boolean(),
});
export type StoryBibleCard = z.infer<typeof storyBibleCardSchema>;

export const storyBibleMissingCardSchema = z.object({
  key: storyBibleCardKeySchema,
  title: z.string().min(1),
});
export type StoryBibleMissingCard = z.infer<typeof storyBibleMissingCardSchema>;

export const storyBibleReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().min(0).max(9),
  total: z.literal(9),
  canLock: z.boolean(),
  missingCards: z.array(storyBibleMissingCardSchema).max(9),
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
    cards: z
      .array(
        z.object({
          key: storyBibleCardKeySchema,
          content: z.string().max(20_000),
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
  });
export type StoryBiblePatchRequest = z.infer<typeof storyBiblePatchRequestSchema>;

export const storyBibleGenerateRequestSchema = z.object({}).strict();
export type StoryBibleGenerateRequest = z.infer<typeof storyBibleGenerateRequestSchema>;

export const storyBibleLockRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type StoryBibleLockRequest = z.infer<typeof storyBibleLockRequestSchema>;

export const storyBibleResponseSchema = apiEnvelopeSchema(storyBibleSchema);
export const storyBibleReadinessResponseSchema = apiEnvelopeSchema(storyBibleReadinessSchema);
export const storyBibleDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

export const settingEntityTypeSchema = z.enum(["world_rule", "character", "golden_finger"]);
export type SettingEntityType = z.infer<typeof settingEntityTypeSchema>;

export const settingStatusSchema = z.enum(["draft", "proposed", "locked", "discarded"]);
export type SettingStatus = z.infer<typeof settingStatusSchema>;

export const settingSourceSchema = z.enum(["author", "import", "ai", "canon"]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

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

const settingEntityBaseShape = {
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  summary: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
};

export const settingEntityCreateRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("world_rule"),
    ...settingEntityBaseShape,
    data: worldRuleDataSchema,
  }),
  z.object({
    type: z.literal("character"),
    ...settingEntityBaseShape,
    data: characterDataSchema,
  }),
  z.object({
    type: z.literal("golden_finger"),
    ...settingEntityBaseShape,
    data: goldenFingerDataSchema,
  }),
]);
export type SettingEntityCreateRequest = z.infer<typeof settingEntityCreateRequestSchema>;

export const settingEntityPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: settingEntityBaseShape.name.optional(),
    aliases: settingEntityBaseShape.aliases.optional(),
    summary: settingEntityBaseShape.summary.optional(),
    description: settingEntityBaseShape.description.optional(),
    tags: settingEntityBaseShape.tags.optional(),
    data: z
      .union([
        worldRuleDataSchema.partial(),
        characterDataSchema.partial(),
        goldenFingerDataSchema.partial(),
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
      input.data !== undefined,
    { message: "At least one setting field is required" },
  );
export type SettingEntityPatchRequest = z.infer<typeof settingEntityPatchRequestSchema>;

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
    type: z.literal("golden_finger"),
    data: goldenFingerDataSchema,
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

export const confirmedSettingSchema = z.object({
  id: uuidV7Schema,
  type: settingEntityTypeSchema,
  name: z.string(),
  summary: z.string(),
  source: settingSourceSchema,
  status: z.literal("locked"),
  version: z.number().int().positive(),
  lockedAt: z.string().datetime(),
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
  order: z.number().int().positive(),
  title: z.string(),
  status: chapterStatusSchema,
  version: z.number().int().positive(),
  wordCount: z.number().int().nonnegative(),
  currentVersionId: uuidV7Schema,
});
export type Chapter = z.infer<typeof chapterSchema>;

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
